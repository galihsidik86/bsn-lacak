import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const screenParam = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/);

// List own filters for a screen (or all if screen omitted).
router.get('/', async (req, res) => {
  const screen = typeof req.query.screen === 'string' ? req.query.screen : null;
  if (screen && !screenParam.safeParse(screen).success) {
    return res.status(400).json({ error: 'bad_screen' });
  }
  const rows = await prisma.savedFilter.findMany({
    where: {
      userId: req.user!.sub,
      ...(screen ? { screen } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(rows);
});

const createSchema = z.object({
  screen: screenParam,
  name: z.string().min(1).max(120),
  payload: z.any(),
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  const row = await prisma.savedFilter.create({
    data: {
      userId: req.user!.sub,
      screen: parsed.data.screen,
      name: parsed.data.name,
      payload: parsed.data.payload,
    },
  });
  res.status(201).json(row);
});

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  payload: z.any().optional(),
});

router.patch('/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const existing = await prisma.savedFilter.findFirst({
    where: { id: String(req.params.id), userId: req.user!.sub },
  });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const row = await prisma.savedFilter.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name ?? existing.name,
      payload: parsed.data.payload ?? (existing.payload as any),
    },
  });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const existing = await prisma.savedFilter.findFirst({
    where: { id: String(req.params.id), userId: req.user!.sub },
  });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  await prisma.savedFilter.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

export default router;
