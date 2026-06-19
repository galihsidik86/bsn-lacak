import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

// CX — nasabah segmentation labels (Tag). Tags are branch-scoped (or
// HQ-global when branchId is null). SUPERVISOR creates inside their own
// branch; ADMIN may pick any branch or create global. Tag application
// onto a nasabah is open to SUPERVISOR/ADMIN; PETUGAS can read but not
// mutate.

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const rows = await prisma.tag.findMany({
    where: branchId
      ? { OR: [{ branchId: null }, { branchId }] }
      : {},
    orderBy: [{ branchId: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { nasabah: true } },
      branch: { select: { kode: true } },
    },
  });
  res.json(rows.map(r => ({
    id: r.id, name: r.name, color: r.color,
    branchId: r.branchId, branchKode: r.branch?.kode ?? null,
    usage: r._count.nasabah,
    createdAt: r.createdAt.toISOString(),
  })));
});

const createSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  branchId: z.string().min(1).max(64).nullable().optional(),
});

router.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  // SUPERVISOR is auto-scoped to their own branch and may not create global.
  let branchId: string | null;
  if (req.user?.role === 'SUPERVISOR') {
    branchId = scopedBranchId(req) ?? null;
    if (!branchId) return res.status(403).json({ error: 'no_branch' });
  } else {
    branchId = parsed.data.branchId ?? null;
  }

  try {
    const row = await prisma.tag.create({
      data: {
        name: parsed.data.name.trim(),
        color: parsed.data.color ?? '#64748b',
        branchId,
        createdById: req.user!.sub,
      },
    });
    await audit({ action: 'tag.create', target: row.id, ...fromReq(req), meta: { branchId } });
    res.status(201).json(row);
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

router.delete('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (req.user?.role === 'SUPERVISOR') {
    const branchId = scopedBranchId(req);
    if (existing.branchId !== branchId) return res.status(403).json({ error: 'forbidden' });
  }
  await prisma.tag.delete({ where: { id } });
  await audit({ action: 'tag.delete', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
