import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { enqueueNotification } from './notifications.js';

const router = Router();
router.use(requireAuth);

// Build a `where` clause combining branch-tenancy + role scoping.
// ADMIN: no branch filter; SUPERVISOR/PETUGAS: filter to token's branchId.
// PETUGAS also pinned to their own assignments.
function scope(req: any) {
  const w: Record<string, unknown> = {};
  if (req.user?.role === 'PETUGAS') w.petugasId = req.user.petugasId ?? '__none__';
  const branchId = scopedBranchId(req);
  if (branchId !== null && branchId !== undefined) w.branchId = branchId;
  return w;
}

router.get('/', async (req, res) => {
  const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
  const q = str(req.query.q)?.trim();
  const kol = str(req.query.kol);
  const petugasId = str(req.query.petugasId);
  const akad = str(req.query.akad);
  const includeInactive = str(req.query.includeInactive) === '1';

  const list = await prisma.nasabah.findMany({
    where: {
      ...scope(req),
      ...(includeInactive ? {} : { active: true }),
      ...(q ? { OR: [{ nama: { contains: q, mode: 'insensitive' } }, { kode: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(kol ? { kol: kol as any } : {}),
      ...(petugasId ? { petugasId } : {}),
      ...(akad ? { akad: akad as any } : {}),
    },
    include: { petugas: true },
    orderBy: { kode: 'asc' },
    take: 500,
  });
  res.json(list);
});

router.get('/postur', async (req, res) => {
  const rows = await prisma.nasabah.groupBy({
    by: ['kol'],
    where: scope(req),
    _count: { _all: true },
    _sum: { sisa: true },
  });
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const n = await prisma.nasabah.findFirst({
    where: { id: String(req.params.id), ...scope(req) },
    include: { petugas: true },
  });
  if (!n) return res.status(404).json({ error: 'not_found' });
  res.json(n);
});

const reassign = z.object({ petugasId: z.string().min(1).max(64) });
router.patch('/:id/petugas', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = reassign.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const id = String(req.params.id);

  // Source nasabah must be inside the requester's branch scope.
  const before = await prisma.nasabah.findFirst({ where: { id, ...scope(req) } });
  if (!before) return res.status(404).json({ error: 'not_found' });

  // Target petugas must live in the same branch unless requester is ADMIN.
  const targetPetugas = await prisma.petugas.findUnique({ where: { id: parsed.data.petugasId } });
  if (!targetPetugas) return res.status(400).json({ error: 'unknown_petugas' });
  if (req.user?.role !== 'ADMIN' && targetPetugas.branchId !== before.branchId) {
    return res.status(403).json({ error: 'cross_branch_forbidden' });
  }

  const updated = await prisma.nasabah.update({
    where: { id },
    // When ADMIN moves nasabah across branches, branchId follows the new petugas.
    data: { petugasId: parsed.data.petugasId, branchId: targetPetugas.branchId },
  });
  await audit({
    action: 'nasabah.reassign', target: id,
    ...fromReq(req),
    meta: { from: before.petugasId, to: parsed.data.petugasId },
  });
  bus.publish('nasabah.reassign', { nasabahId: id, from: before.petugasId, to: parsed.data.petugasId });

  // Notify the receiving petugas so they see "Nasabah baru ditugaskan" in their bell.
  const targetUser = await prisma.user.findFirst({ where: { petugasId: parsed.data.petugasId } });
  if (targetUser) {
    await enqueueNotification({
      userIds: [targetUser.id],
      type: 'nasabah.reassigned_to_you',
      title: 'Nasabah baru ditugaskan',
      body: `${updated.nama} (${updated.kode}) sekarang ada di binaan Anda.`,
      severity: 'INFO',
      link: 'kolektabilitas',
    }).catch(() => undefined);
  }

  res.json(updated);
});

// ---- Nasabah CRUD (SUPERVISOR + ADMIN) ---------------------------------
//
// SUPERVISOR can create/edit/deactivate only within their own branch; the
// receiving petugas must also live in that branch. ADMIN ranges freely but
// any nasabah is forced to inherit the petugas's branch.

const createSchema = z.object({
  kode: z.string().min(2).max(20).regex(/^N[A-Z0-9]+$/, 'Awali dengan N (huruf besar + angka)'),
  nama: z.string().min(1).max(200),
  alamat: z.string().min(1).max(500),
  hp: z.string().min(1).max(40),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  kol: z.enum(['K1', 'K2', 'K3', 'K4', 'K5']).default('K1'),
  akad: z.enum(['MURABAHAH', 'MUSYARAKAH', 'IJARAH', 'MUSYARAKAH_MUTANAQISAH', 'ISTISHNA']).default('MURABAHAH'),
  plafon: z.coerce.bigint().nonnegative(),
  tenor: z.number().int().min(1).max(360),
  angsuran: z.coerce.bigint().nonnegative(),
  sisa: z.coerce.bigint().nonnegative(),
  dpd: z.number().int().min(0).max(3650).default(0),
  dueIn: z.number().int().min(-3650).max(3650).default(0),
  petugasId: z.string().min(1).max(64),
});

async function canManageNasabah(req: any, targetPetugasId: string): Promise<{ ok: boolean; branchId?: string; error?: string }> {
  if (req.user?.role === 'PETUGAS') return { ok: false, error: 'forbidden' };
  const petugas = await prisma.petugas.findUnique({
    where: { id: targetPetugasId },
    select: { id: true, branchId: true, active: true },
  });
  if (!petugas) return { ok: false, error: 'unknown_petugas' };
  if (req.user?.role === 'SUPERVISOR' && petugas.branchId !== req.user.branchId) {
    return { ok: false, error: 'cross_branch_forbidden' };
  }
  if (!petugas.active) return { ok: false, error: 'petugas_inactive' };
  return { ok: true, branchId: petugas.branchId };
}

router.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const guard = await canManageNasabah(req, parsed.data.petugasId);
  if (!guard.ok) return res.status(guard.error === 'forbidden' ? 403 : 400).json({ error: guard.error });

  const exists = await prisma.nasabah.findUnique({ where: { kode: parsed.data.kode } });
  if (exists) return res.status(409).json({ error: 'kode_taken' });

  const n = await prisma.nasabah.create({
    data: { ...parsed.data, branchId: guard.branchId! },
  });
  await audit({
    action: 'nasabah.create', target: n.id, ...fromReq(req),
    meta: { kode: n.kode, petugasId: n.petugasId },
  });
  res.status(201).json(n);
});

const patchSchema = createSchema.partial().extend({
  kode: z.string().optional(), // kode immutable
  active: z.boolean().optional(),
});

router.patch('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const before = await prisma.nasabah.findFirst({ where: { id, ...scope(req) } });
  if (!before) return res.status(404).json({ error: 'not_found' });

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  // kode is immutable.
  const { kode: _kode, ...patch } = parsed.data;

  // If petugasId changes, re-run the branch guard so nasabah follows the
  // new petugas's branch (cross-branch only allowed for ADMIN).
  let nextBranchId = before.branchId;
  if (patch.petugasId && patch.petugasId !== before.petugasId) {
    const guard = await canManageNasabah(req, patch.petugasId);
    if (!guard.ok) return res.status(guard.error === 'forbidden' ? 403 : 400).json({ error: guard.error });
    nextBranchId = guard.branchId!;
  }

  const updated = await prisma.nasabah.update({
    where: { id },
    data: { ...patch, branchId: nextBranchId },
  });

  await audit({
    action: 'nasabah.update', target: id, ...fromReq(req),
    meta: { changes: Object.keys(patch) },
  });
  res.json(updated);
});

// Bulk import — CSV uploads from legacy systems land here as a JSON
// array. Each row is validated independently and a per-row result is
// returned so the UI can show "X imported / Y skipped (duplicate) /
// Z failed". One DB transaction so a mid-batch failure doesn't leave
// partial state.
const bulkRowSchema = createSchema;
const bulkBody = z.object({
  rows: z.array(bulkRowSchema).min(1).max(2000),
});

interface BulkOutcome {
  index: number;
  kode: string;
  status: 'imported' | 'duplicate' | 'invalid' | 'cross_branch' | 'unknown_petugas';
  message?: string;
}

router.post('/bulk', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = bulkBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  // Pre-resolve all distinct petugasIds in one query for the branch guard
  // so we don't N+1 a 2000-row import.
  const petugasIds = [...new Set(parsed.data.rows.map(r => r.petugasId))];
  const petugasMap = new Map(
    (await prisma.petugas.findMany({
      where: { id: { in: petugasIds } },
      select: { id: true, branchId: true, active: true },
    })).map(p => [p.id, p]),
  );

  // Pre-check duplicate kodes so we can short-circuit before opening a txn.
  const existingKodes = new Set(
    (await prisma.nasabah.findMany({
      where: { kode: { in: parsed.data.rows.map(r => r.kode) } },
      select: { kode: true },
    })).map(n => n.kode),
  );

  const outcomes: BulkOutcome[] = [];
  let imported = 0;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const row = parsed.data.rows[i];
      if (existingKodes.has(row.kode)) {
        outcomes.push({ index: i, kode: row.kode, status: 'duplicate' });
        continue;
      }
      const pet = petugasMap.get(row.petugasId);
      if (!pet || !pet.active) {
        outcomes.push({ index: i, kode: row.kode, status: 'unknown_petugas' });
        continue;
      }
      if (req.user?.role === 'SUPERVISOR' && pet.branchId !== req.user.branchId) {
        outcomes.push({ index: i, kode: row.kode, status: 'cross_branch' });
        continue;
      }
      try {
        await tx.nasabah.create({ data: { ...row, branchId: pet.branchId } });
        outcomes.push({ index: i, kode: row.kode, status: 'imported' });
        imported++;
      } catch (e: any) {
        outcomes.push({ index: i, kode: row.kode, status: 'invalid', message: String(e?.message ?? e).slice(0, 200) });
      }
    }
  });

  await audit({
    action: 'nasabah.bulk_import', ...fromReq(req),
    meta: { total: parsed.data.rows.length, imported, skipped: parsed.data.rows.length - imported },
  });

  res.status(201).json({ imported, total: parsed.data.rows.length, outcomes });
});

// Soft-delete via active flag. We never hard-delete a nasabah because their
// kunjungan + pembayaran FKs would orphan; the ledger has to stay intact.
router.delete('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const before = await prisma.nasabah.findFirst({ where: { id, ...scope(req) } });
  if (!before) return res.status(404).json({ error: 'not_found' });

  await prisma.nasabah.update({ where: { id }, data: { active: false } });
  await audit({ action: 'nasabah.deactivate', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
