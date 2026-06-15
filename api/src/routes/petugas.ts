import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { computeStatsFor } from '../lib/petugasStats.js';
import { computePetugasPerformance } from '../lib/petugasPerformance.js';
import { evalSpeed } from '../lib/antiFraud.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const includeInactive = String(req.query.includeInactive) === '1';
  const list = await prisma.petugas.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(includeInactive ? {} : { active: true }),
    },
    orderBy: { kode: 'asc' },
  });
  const stats = await computeStatsFor(list.map(p => p.id));
  res.json(list.map(p => ({ ...p, ...(stats.get(p.id) ?? {}) })));
});

// Per-petugas performance rollup (SUPERVISOR + ADMIN). Returns approval /
// rejection / risk metrics over the configurable window (default 30 days).
// Mount before `/:id` so 'performance' is not consumed as an id.
router.get('/performance', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const days = Number.parseInt(String(req.query.days ?? '30'), 10);
  const window = Number.isFinite(days) && days > 0 && days <= 365 ? days : 30;
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
  const rows = await computePetugasPerformance({
    branchId: branchId === null ? null : branchId,
    since,
  });
  res.json({ since: since.toISOString(), windowDays: window, rows });
});

router.get('/:id', async (req, res) => {
  const branchId = scopedBranchId(req);
  const p = await prisma.petugas.findFirst({
    where: { id: String(req.params.id), ...(branchId ? { branchId } : {}) },
  });
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(p);
});

router.post('/:id/position', async (req, res) => {
  const { lat, lng, accuracy } = req.body ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const id = String(req.params.id);
  // A petugas can only update their own position; supervisor of the petugas's
  // branch + ADMIN can update any.
  if (req.user?.role === 'PETUGAS' && req.user.petugasId !== id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (req.user?.role === 'SUPERVISOR') {
    const target = await prisma.petugas.findUnique({ where: { id }, select: { branchId: true } });
    if (!target || target.branchId !== req.user.branchId) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  // Lapis B: deteksi lonjakan kecepatan vs ping terakhir. Tidak menolak —
  // hanya catat audit, supervisor bisa review pola.
  const prevRow = await prisma.petugasPosition.findFirst({
    where: { petugasId: id },
    orderBy: { recordedAt: 'desc' },
    select: { lat: true, lng: true, recordedAt: true },
  });
  const pos = await prisma.petugasPosition.create({
    data: { petugasId: id, lat, lng, accuracy: accuracy ?? null },
  });
  const speed = evalSpeed({
    prev: prevRow ? { lat: prevRow.lat, lng: prevRow.lng, recordedAt: prevRow.recordedAt } : null,
    next: { lat, lng, recordedAt: pos.recordedAt },
  });
  if (speed.flags.length > 0) {
    await audit({
      action: 'petugas.position.speed_jump', target: id, ...fromReq(req),
      meta: { flags: speed.flags },
    });
  }
  bus.publish('petugas.position', { petugasId: id, lat, lng, accuracy, ts: pos.recordedAt });
  res.status(201).json(pos);
});

// ---- create / patch (ADMIN + SUPERVISOR within own branch) ----
const createSchema = z.object({
  kode: z.string().min(2).max(20).regex(/^[A-Z0-9]+$/, 'Huruf besar + angka'),
  nama: z.string().min(1).max(200),
  inisial: z.string().min(1).max(8),
  wilayah: z.string().min(1).max(200),
  hp: z.string().min(4).max(40),
  branchId: z.string().min(1),
  target: z.coerce.bigint().nonnegative().default(0n),
  status: z.enum(['LAPANGAN', 'ISTIRAHAT', 'KANTOR']).default('LAPANGAN'),
  hue: z.coerce.number().int().min(0).max(360).default(156),
});

function canManagePetugas(req: any, branchId: string): boolean {
  if (req.user?.role === 'ADMIN') return true;
  if (req.user?.role === 'SUPERVISOR') return req.user.branchId === branchId;
  return false;
}

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  if (!canManagePetugas(req, parsed.data.branchId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const p = await prisma.petugas.create({ data: parsed.data });
    await audit({
      action: 'petugas.create', target: p.id, ...fromReq(req),
      meta: { kode: p.kode, branchId: p.branchId },
    });
    res.status(201).json(p);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'kode_taken' });
    throw err;
  }
});

const patchSchema = createSchema.partial().extend({
  // Kode is immutable — tying historical Kunjungan/Pembayaran to an old kode
  // and renaming it later would mismatch printed receipts in the wild.
  kode: z.never().optional(),
  active: z.boolean().optional(),
});

router.patch('/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const id = String(req.params.id);
  const before = await prisma.petugas.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: 'not_found' });
  if (!canManagePetugas(req, before.branchId)) return res.status(403).json({ error: 'forbidden' });
  if (parsed.data.branchId && !canManagePetugas(req, parsed.data.branchId)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const updated = await prisma.petugas.update({ where: { id }, data: parsed.data });
  await audit({
    action: 'petugas.update', target: id, ...fromReq(req),
    meta: parsed.data,
  });
  res.json(updated);
});

router.get('/:id/route', async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 3600 * 1000);
  const branchId = scopedBranchId(req);
  // Ensure the requester's branch contains this petugas before returning route.
  const petugas = await prisma.petugas.findFirst({
    where: { id: String(req.params.id), ...(branchId ? { branchId } : {}) },
    select: { id: true },
  });
  if (!petugas) return res.status(404).json({ error: 'not_found' });
  const route = await prisma.petugasPosition.findMany({
    where: { petugasId: req.params.id, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'asc' },
  });
  res.json(route);
});

// Soft-delete via active flag — historical kunjungan/pembayaran FKs stay
// intact. SUPERVISOR limited to their own branch.
router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });

  const branchId = scopedBranchId(req);
  const before = await prisma.petugas.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
  });
  if (!before) return res.status(404).json({ error: 'not_found' });

  await prisma.petugas.update({ where: { id }, data: { active: false } });
  await audit({ action: 'petugas.deactivate', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
