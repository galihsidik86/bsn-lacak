import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (_req, res) => {
  const list = await prisma.petugas.findMany({ orderBy: { kode: 'asc' } });
  res.json(list);
});

router.get('/:id', async (req, res) => {
  const p = await prisma.petugas.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(p);
});

router.post('/:id/position', async (req, res) => {
  const { lat, lng, accuracy } = req.body ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'bad_request' });
  }
  const pos = await prisma.petugasPosition.create({
    data: { petugasId: req.params.id, lat, lng, accuracy: accuracy ?? null },
  });
  res.status(201).json(pos);
});

router.get('/:id/route', async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 3600 * 1000);
  const route = await prisma.petugasPosition.findMany({
    where: { petugasId: req.params.id, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'asc' },
  });
  res.json(route);
});

export default router;
