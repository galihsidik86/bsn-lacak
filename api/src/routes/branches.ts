// Branch CRUD. All authenticated users can list (frontend uses this for
// dropdowns and the ADMIN x-branch-id switcher). Only ADMIN can mutate.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res) => {
  const list = await prisma.branch.findMany({
    orderBy: { kode: 'asc' },
    include: { _count: { select: { petugas: true, nasabah: true, users: true } } },
  });
  res.json(list);
});

router.get('/:id', async (req, res) => {
  const b = await prisma.branch.findUnique({ where: { id: String(req.params.id) } });
  if (!b) return res.status(404).json({ error: 'not_found' });
  res.json(b);
});

const upsert = z.object({
  kode: z.string().min(3).max(20).regex(/^[A-Z0-9]+$/, 'Hanya huruf besar + angka'),
  nama: z.string().min(1).max(200),
  alamat: z.string().max(500).optional().nullable(),
  kepalaCabang: z.string().max(200).optional().nullable(),
  active: z.boolean().optional(),
});

router.post('/', requireRole('ADMIN'), async (req, res) => {
  const parsed = upsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  try {
    const b = await prisma.branch.create({ data: parsed.data });
    await audit({ action: 'branch.create', target: b.id, ...fromReq(req), meta: { kode: b.kode } });
    res.status(201).json(b);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'duplicate_kode' });
    throw err;
  }
});

const patch = upsert.partial().extend({
  // Allow toggling kode/nama/etc individually — partial — but kode still must
  // pass the format rule when provided.
  kode: upsert.shape.kode.optional(),
});

router.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const parsed = patch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  const id = String(req.params.id);
  try {
    const b = await prisma.branch.update({ where: { id }, data: parsed.data });
    await audit({ action: 'branch.update', target: b.id, ...fromReq(req), meta: parsed.data });
    res.json(b);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    if (err?.code === 'P2002') return res.status(409).json({ error: 'duplicate_kode' });
    throw err;
  }
});

// Soft-delete only — never hard-delete a branch that has dependent rows.
// Sets active=false so the dropdowns can hide it without losing history.
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  try {
    const b = await prisma.branch.update({ where: { id }, data: { active: false } });
    await audit({ action: 'branch.deactivate', target: b.id, ...fromReq(req) });
    res.json({ ok: true, branch: b });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'not_found' });
    throw err;
  }
});

export default router;
