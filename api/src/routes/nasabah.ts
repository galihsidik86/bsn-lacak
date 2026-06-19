import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { enqueueNotification } from './notifications.js';
import { renderNasabahExportPdf } from '../lib/pdfNasabahExport.js';

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
  const tagId = str(req.query.tagId);
  const includeInactive = str(req.query.includeInactive) === '1';

  const list = await prisma.nasabah.findMany({
    where: {
      ...scope(req),
      ...(includeInactive ? {} : { active: true }),
      ...(q ? { OR: [{ nama: { contains: q, mode: 'insensitive' } }, { kode: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(kol ? { kol: kol as any } : {}),
      ...(petugasId ? { petugasId } : {}),
      ...(akad ? { akad: akad as any } : {}),
      ...(tagId ? { tags: { some: { tagId } } } : {}),
    },
    include: {
      petugas: true,
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
    orderBy: { kode: 'asc' },
    take: 500,
  });
  res.json(list.map(n => ({
    ...n,
    tags: n.tags.map(t => t.tag),
  })));
});

// Mounted BEFORE the /:id catch-all so the segment isn't consumed as an ID.
router.get('/due-soon', async (req, res) => {
  const days = Number.parseInt(String(req.query.days ?? '7'), 10);
  const window = Number.isFinite(days) && days > 0 && days <= 60 ? days : 7;
  const cutoff = new Date(Date.now() + window * 24 * 60 * 60 * 1000);
  const rows = await prisma.nasabah.findMany({
    where: {
      ...scope(req), active: true,
      nextVisitAt: { not: null, lte: cutoff },
    },
    include: {
      petugas: { select: { id: true, kode: true, nama: true, hue: true, inisial: true } },
      branch: { select: { kode: true, nama: true } },
    },
    orderBy: { nextVisitAt: 'asc' },
    take: 200,
  });
  res.json({ windowDays: window, rows });
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
    include: {
      petugas: true,
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
  });
  if (!n) return res.status(404).json({ error: 'not_found' });
  res.json({ ...n, tags: n.tags.map(t => t.tag) });
});

// CX — apply / remove a tag on a nasabah. SUPERVISOR/ADMIN only.
router.post('/:id/tags', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const tagId = String((req.body ?? {}).tagId ?? '');
  if (!tagId) return res.status(400).json({ error: 'bad_request' });
  const n = await prisma.nasabah.findFirst({ where: { id, ...scope(req) }, select: { id: true, branchId: true } });
  if (!n) return res.status(404).json({ error: 'not_found' });
  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true, branchId: true } });
  if (!tag) return res.status(404).json({ error: 'tag_not_found' });
  // Branch-scoped tags can only go on nasabah in that same branch. Global
  // tags (branchId null) are usable everywhere.
  if (tag.branchId && tag.branchId !== n.branchId) {
    return res.status(403).json({ error: 'tag_branch_mismatch' });
  }
  try {
    await prisma.nasabahTag.create({ data: { nasabahId: id, tagId } });
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;     // already applied → idempotent
  }
  await audit({ action: 'tag.apply', target: id, ...fromReq(req), meta: { tagId } });
  res.status(201).json({ ok: true });
});

router.delete('/:id/tags/:tagId', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const tagId = String(req.params.tagId);
  const n = await prisma.nasabah.findFirst({ where: { id, ...scope(req) }, select: { id: true } });
  if (!n) return res.status(404).json({ error: 'not_found' });
  await prisma.nasabahTag.deleteMany({ where: { nasabahId: id, tagId } });
  await audit({ action: 'tag.remove', target: id, ...fromReq(req), meta: { tagId } });
  res.json({ ok: true });
});

// Aggregated 360° payload — one endpoint to populate the supervisor's
// "everything about this nasabah" screen so the UI doesn't fan out into
// six parallel queries. Branch + role scoping uses the same `scope()` as
// the list view, so a SUPERVISOR can only open nasabah dalam cabangnya.
router.get('/:id/360', async (req, res) => {
  const id = String(req.params.id);
  const nasabah = await prisma.nasabah.findFirst({
    where: { id, ...scope(req) },
    include: {
      petugas: { include: { branch: { select: { kode: true, nama: true } } } },
      branch: { select: { kode: true, nama: true, alamat: true } },
    },
  });
  if (!nasabah) return res.status(404).json({ error: 'not_found' });

  const [kunjungan, pembayaran, feedback] = await Promise.all([
    prisma.kunjungan.findMany({
      where: { nasabahId: id },
      include: {
        fotos: { select: { path: true } },
        petugas: { select: { kode: true, nama: true, inisial: true, hue: true } },
        reviewer: { select: { username: true, nama: true } },
      },
      orderBy: { tanggal: 'desc' },
      take: 50,
    }),
    prisma.pembayaran.findMany({
      where: { nasabahId: id },
      orderBy: { tanggal: 'desc' },
      take: 50,
    }),
    prisma.customerFeedback.findMany({
      where: { nasabahId: id, repliedAt: { not: null } },
      orderBy: { repliedAt: 'desc' },
      take: 20,
    }),
  ]);

  // Roll up the headline stats once on the server so the frontend can
  // render summary chips without re-aggregating the lists.
  const totalCollected = pembayaran
    .filter(p => p.status === 'berhasil')
    .reduce((s, p) => s + Number(p.nominal), 0);
  const avgRating = feedback.length === 0 ? null
    : feedback.reduce((s, f) => s + (f.rating ?? 0), 0) / feedback.length;

  res.json({
    nasabah,
    kunjungan,
    pembayaran,
    feedback,
    stats: {
      totalKunjungan: kunjungan.length,
      lastVisit: kunjungan[0]?.tanggal ?? null,
      totalCollected,
      paymentCount: pembayaran.length,
      feedbackCount: feedback.length,
      avgRating,
    },
  });
});

// CL — chronological timeline merging kunjungan, pembayaran, feedback,
// reassign audit, and escalation tickets into one event stream. Each
// item carries its own type + payload so the UI can render variants
// without re-fetching anything.
router.get('/:id/timeline', async (req, res) => {
  const id = String(req.params.id);
  const n = await prisma.nasabah.findFirst({
    where: { id, ...scope(req) },
    select: { id: true },
  });
  if (!n) return res.status(404).json({ error: 'not_found' });

  const [kunjungan, pembayaran, feedback, reassigns, escalations] = await Promise.all([
    prisma.kunjungan.findMany({
      where: { nasabahId: id },
      orderBy: { tanggal: 'desc' }, take: 200,
      select: {
        id: true, tanggal: true, jam: true, hasil: true, nominal: true,
        reviewStatus: true, riskFlags: true, catatan: true,
        petugas: { select: { kode: true, nama: true } },
      },
    }),
    prisma.pembayaran.findMany({
      where: { nasabahId: id },
      orderBy: { tanggal: 'desc' }, take: 200,
      select: { id: true, tanggal: true, jam: true, nominal: true, metode: true, status: true },
    }),
    prisma.customerFeedback.findMany({
      where: { nasabahId: id, repliedAt: { not: null } },
      orderBy: { repliedAt: 'desc' }, take: 50,
      select: { id: true, repliedAt: true, rating: true, comment: true },
    }),
    prisma.auditLog.findMany({
      where: { action: 'nasabah.reassign', target: id },
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, createdAt: true, actor: true, meta: true },
    }),
    prisma.escalationTicket.findMany({
      where: { nasabahId: id },
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, createdAt: true, resolvedAt: true, severity: true, reason: true, status: true },
    }),
  ]);

  interface Event {
    ts: string; type: string; data: unknown;
  }
  const items: Event[] = [];

  for (const k of kunjungan) {
    items.push({
      ts: k.tanggal.toISOString(),
      type: 'kunjungan',
      data: {
        id: k.id, jam: k.jam, hasil: k.hasil, nominal: String(k.nominal),
        reviewStatus: k.reviewStatus, riskFlags: k.riskFlags,
        catatan: k.catatan,
        petugas: k.petugas,
      },
    });
  }
  for (const p of pembayaran) {
    items.push({
      ts: p.tanggal.toISOString(),
      type: 'pembayaran',
      data: {
        id: p.id, jam: p.jam, nominal: String(p.nominal),
        metode: p.metode, status: p.status,
      },
    });
  }
  for (const f of feedback) {
    items.push({
      ts: f.repliedAt!.toISOString(),
      type: 'feedback',
      data: { id: f.id, rating: f.rating, comment: f.comment },
    });
  }
  for (const r of reassigns) {
    items.push({
      ts: r.createdAt.toISOString(),
      type: 'reassign',
      data: { id: r.id, actor: r.actor, meta: r.meta },
    });
  }
  for (const e of escalations) {
    items.push({
      ts: e.createdAt.toISOString(),
      type: 'escalation',
      data: {
        id: e.id, severity: e.severity, reason: e.reason, status: e.status,
        resolvedAt: e.resolvedAt,
      },
    });
  }

  items.sort((a, b) => b.ts.localeCompare(a.ts));
  res.json({ items });
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

// Bulk reassign — admin/supervisor selects N nasabah and moves them all to
// one petugas. Source ids are filtered against scope so SUPERVISOR can only
// touch their own branch's nasabah; target petugas branch is checked once.
// Per-row outcomes returned so the UI can show partial failures.
const bulkReassignBody = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(500),
  petugasId: z.string().min(1).max(64),
});

router.post('/bulk-reassign', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = bulkReassignBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const target = await prisma.petugas.findUnique({
    where: { id: parsed.data.petugasId },
    select: { id: true, branchId: true, active: true },
  });
  if (!target || !target.active) return res.status(400).json({ error: 'unknown_petugas' });

  const candidates = await prisma.nasabah.findMany({
    where: { id: { in: parsed.data.ids }, ...scope(req) },
    select: { id: true, branchId: true, petugasId: true },
  });
  const map = new Map(candidates.map(c => [c.id, c]));
  const supervisorBranch = req.user?.role === 'SUPERVISOR' ? req.user.branchId : null;

  const outcomes: Array<{ id: string; status: 'reassigned' | 'not_found' | 'cross_branch' | 'noop' }> = [];
  const okIds: string[] = [];

  for (const id of parsed.data.ids) {
    const c = map.get(id);
    if (!c) { outcomes.push({ id, status: 'not_found' }); continue; }
    // SUPERVISOR cannot move nasabah to a petugas outside their branch.
    if (supervisorBranch && target.branchId !== supervisorBranch) {
      outcomes.push({ id, status: 'cross_branch' }); continue;
    }
    if (c.petugasId === target.id) {
      outcomes.push({ id, status: 'noop' }); continue;
    }
    okIds.push(id);
    outcomes.push({ id, status: 'reassigned' });
  }

  if (okIds.length > 0) {
    await prisma.nasabah.updateMany({
      where: { id: { in: okIds } },
      data: { petugasId: target.id, branchId: target.branchId },
    });
    await audit({
      action: 'nasabah.bulk_reassign', ...fromReq(req),
      meta: { count: okIds.length, toPetugasId: target.id },
    });
    for (const id of okIds) {
      bus.publish('nasabah.reassign', { nasabahId: id, to: target.id });
    }
    const targetUser = await prisma.user.findFirst({ where: { petugasId: target.id } });
    if (targetUser) {
      await enqueueNotification({
        userIds: [targetUser.id],
        type: 'nasabah.reassigned_to_you',
        title: `${okIds.length} nasabah baru ditugaskan`,
        body: 'Cek tab Kolektabilitas / Distribusi untuk daftar lengkap.',
        severity: 'INFO',
        link: 'kolektabilitas',
      }).catch(() => undefined);
    }
  }

  res.status(200).json({ reassigned: okIds.length, total: parsed.data.ids.length, outcomes });
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

// --- Next-visit manual override (BN) ------------------------------------
//
// Supervisor/admin pins a specific date; null body clears the field so the
// cadence rule re-populates it after the next kunjungan. We bypass zod's
// coercion for null (z.coerce.date() would turn it into 1970-01-01).
router.patch('/:id/next-visit', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const raw = req.body?.nextVisitAt;
  let nextVisitAt: Date | null;
  if (raw === null || raw === undefined) {
    nextVisitAt = null;
  } else {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'bad_request' });
    nextVisitAt = d;
  }

  const id = String(req.params.id);
  const before = await prisma.nasabah.findFirst({ where: { id, ...scope(req) } });
  if (!before) return res.status(404).json({ error: 'not_found' });

  const updated = await prisma.nasabah.update({
    where: { id },
    data: { nextVisitAt },
  });
  await audit({
    action: 'nasabah.next_visit', target: id, ...fromReq(req),
    meta: { nextVisitAt: nextVisitAt?.toISOString() ?? null },
  });
  res.json(updated);
});

// --- Per-nasabah data export (BK / GDPR-style) --------------------------
//
// Pulls profile + payment + visit history into a single JSON document or a
// printable A4 PDF. SUPERVISOR/ADMIN only — PETUGAS would otherwise have a
// channel to dump their own assignments. Audit-logged every time.

async function buildExportBundle(id: string, scopeWhere: Record<string, unknown>) {
  const n = await prisma.nasabah.findFirst({
    where: { id, ...scopeWhere },
    include: {
      petugas: { select: { kode: true, nama: true } },
      branch: { select: { kode: true, nama: true } },
    },
  });
  if (!n) return null;

  const [pembayaran, kunjungan] = await Promise.all([
    prisma.pembayaran.findMany({
      where: { nasabahId: id },
      orderBy: { tanggal: 'desc' },
      take: 500,
    }),
    prisma.kunjungan.findMany({
      where: { nasabahId: id },
      orderBy: { tanggal: 'desc' },
      take: 500,
    }),
  ]);
  return { n, pembayaran, kunjungan };
}

router.get('/:id/export.json', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const bundle = await buildExportBundle(id, scope(req));
  if (!bundle) return res.status(404).json({ error: 'not_found' });

  await audit({
    action: 'nasabah.export.json', target: id, ...fromReq(req),
    meta: { pembayaran: bundle.pembayaran.length, kunjungan: bundle.kunjungan.length },
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="nasabah-${bundle.n.kode}.json"`);
  res.json({
    generatedAt: new Date().toISOString(),
    nasabah: {
      ...bundle.n,
      // BigInt serializes as string by default in our setup; pre-stringify
      // monetary columns so consumers don't have to special-case.
      plafon: String(bundle.n.plafon),
      angsuran: String(bundle.n.angsuran),
      sisa: String(bundle.n.sisa),
    },
    pembayaran: bundle.pembayaran.map(p => ({ ...p, nominal: String(p.nominal) })),
    kunjungan: bundle.kunjungan.map(k => ({ ...k, nominal: String(k.nominal) })),
  });
});

router.get('/:id/export.pdf', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const bundle = await buildExportBundle(id, scope(req));
  if (!bundle) return res.status(404).json({ error: 'not_found' });

  await audit({
    action: 'nasabah.export.pdf', target: id, ...fromReq(req),
    meta: { pembayaran: bundle.pembayaran.length, kunjungan: bundle.kunjungan.length },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="nasabah-${bundle.n.kode}.pdf"`);

  const pdf = renderNasabahExportPdf({
    generatedAt: new Date(),
    nasabah: bundle.n,
    petugas: bundle.n.petugas,
    branch: bundle.n.branch,
    pembayaran: bundle.pembayaran,
    kunjungan: bundle.kunjungan,
  });
  pdf.pipe(res);
});

export default router;
