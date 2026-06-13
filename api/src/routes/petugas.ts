import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';
import { bus } from '../lib/events.js';
import { computeStatsFor } from '../lib/petugasStats.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const list = await prisma.petugas.findMany({
    where: branchId ? { branchId } : {},
    orderBy: { kode: 'asc' },
  });
  const stats = await computeStatsFor(list.map(p => p.id));
  res.json(list.map(p => ({ ...p, ...(stats.get(p.id) ?? {}) })));
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
  const pos = await prisma.petugasPosition.create({
    data: { petugasId: id, lat, lng, accuracy: accuracy ?? null },
  });
  bus.publish('petugas.position', { petugasId: id, lat, lng, accuracy, ts: pos.recordedAt });
  res.status(201).json(pos);
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

export default router;
