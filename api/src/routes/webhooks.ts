import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { generateWebhookSecret } from '../lib/webhookDispatcher.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('ADMIN'));

const VALID_EVENTS = [
  'kunjungan.created', 'kunjungan.reviewed',
  'nasabah.reassign', 'blast.completed',
] as const;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().max(2048),
  events: z.array(z.enum(VALID_EVENTS)).max(20).default([]),
  branchId: z.string().optional(),
});

router.get('/', async (_req, res) => {
  const rows = await prisma.webhookSubscription.findMany({
    select: {
      id: true, name: true, url: true, events: true, branchId: true,
      active: true, lastDeliveryAt: true, createdAt: true,
      createdBy: { select: { username: true, nama: true } },
      branch: { select: { kode: true, nama: true } },
      _count: { select: { deliveries: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  if (parsed.data.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: parsed.data.branchId } });
    if (!b) return res.status(400).json({ error: 'unknown_branch' });
  }

  const secret = generateWebhookSecret();
  const row = await prisma.webhookSubscription.create({
    data: {
      name: parsed.data.name,
      url: parsed.data.url,
      events: parsed.data.events,
      secret,
      branchId: parsed.data.branchId ?? null,
      createdById: req.user!.sub,
    },
  });
  await audit({
    action: 'webhook.create', target: row.id, ...fromReq(req),
    meta: { name: row.name, url: row.url, events: row.events },
  });
  res.status(201).json({ ...row, secret });   // secret only on creation
});

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().url().max(2048).optional(),
  events: z.array(z.enum(VALID_EVENTS)).max(20).optional(),
  active: z.boolean().optional(),
});

router.patch('/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const id = String(req.params.id);
  const existing = await prisma.webhookSubscription.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const row = await prisma.webhookSubscription.update({
    where: { id },
    data: parsed.data,
  });
  await audit({ action: 'webhook.update', target: id, ...fromReq(req) });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.webhookSubscription.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  await prisma.webhookSubscription.delete({ where: { id } });
  await audit({ action: 'webhook.delete', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

// Recent delivery log for a subscription.
router.get('/:id/deliveries', async (req, res) => {
  const id = String(req.params.id);
  const limitNum = Number.parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(limitNum) && limitNum > 0 && limitNum <= 200 ? limitNum : 50;
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhookId: id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(rows);
});

export default router;
