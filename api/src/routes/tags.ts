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

// DH — auto-tagging rules.
const KOL_VALUES = ['K1', 'K2', 'K3', 'K4', 'K5'] as const;
const ruleSchema = z.object({
  tagId: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  type: z.enum(['DPD_ABOVE', 'DAYS_SINCE_PAYMENT_ABOVE', 'KOL_IN']),
  threshold: z.number().int().min(0).max(3650).nullable().optional(),
  kolValues: z.array(z.enum(KOL_VALUES)).optional(),
  active: z.boolean().optional(),
});

async function tagInScopeForWrite(req: any, tagId: string) {
  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) return null;
  if (req.user?.role === 'SUPERVISOR') {
    const branchId = scopedBranchId(req);
    if (tag.branchId !== branchId) return null;
  }
  return tag;
}

router.get('/rules', async (req, res) => {
  const branchId = scopedBranchId(req);
  const rows = await prisma.tagRule.findMany({
    where: branchId
      ? { tag: { OR: [{ branchId: null }, { branchId }] } }
      : {},
    include: { tag: { select: { id: true, name: true, color: true, branchId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

router.post('/rules', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const tag = await tagInScopeForWrite(req, parsed.data.tagId);
  if (!tag) return res.status(404).json({ error: 'tag_not_found' });

  if ((parsed.data.type === 'DPD_ABOVE' || parsed.data.type === 'DAYS_SINCE_PAYMENT_ABOVE')
      && (parsed.data.threshold == null)) {
    return res.status(400).json({ error: 'threshold_required' });
  }
  if (parsed.data.type === 'KOL_IN' && (!parsed.data.kolValues || parsed.data.kolValues.length === 0)) {
    return res.status(400).json({ error: 'kol_values_required' });
  }

  const row = await prisma.tagRule.create({
    data: {
      tagId: parsed.data.tagId,
      name: parsed.data.name.trim(),
      type: parsed.data.type,
      threshold: parsed.data.threshold ?? null,
      kolValues: parsed.data.kolValues ?? [],
      active: parsed.data.active ?? true,
      createdById: req.user!.sub,
    },
  });
  await audit({ action: 'tag_rule.create', target: row.id, ...fromReq(req), meta: { tagId: parsed.data.tagId, type: parsed.data.type } });
  res.status(201).json(row);
});

router.patch('/rules/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.tagRule.findUnique({ where: { id }, include: { tag: true } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (req.user?.role === 'SUPERVISOR') {
    const branchId = scopedBranchId(req);
    if (existing.tag.branchId !== branchId) return res.status(403).json({ error: 'forbidden' });
  }
  const patchSchema = z.object({ active: z.boolean().optional(), name: z.string().min(1).max(80).optional() });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const row = await prisma.tagRule.update({ where: { id }, data: parsed.data });
  await audit({ action: 'tag_rule.update', target: id, ...fromReq(req), meta: parsed.data });
  res.json(row);
});

router.delete('/rules/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.tagRule.findUnique({ where: { id }, include: { tag: true } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (req.user?.role === 'SUPERVISOR') {
    const branchId = scopedBranchId(req);
    if (existing.tag.branchId !== branchId) return res.status(403).json({ error: 'forbidden' });
  }
  await prisma.tagRule.delete({ where: { id } });
  await audit({ action: 'tag_rule.delete', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
