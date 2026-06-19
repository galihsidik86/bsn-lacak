import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('SUPERVISOR', 'ADMIN'));

// List tickets — supervisor sees only their branch via scope; admin sees
// all. Status filter optional (defaults to non-closed).
router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const statusRaw = String(req.query.status ?? '');
  let where: Record<string, any> = {
    ...(branchId ? { branchId } : {}),
  };
  if (statusRaw === 'all') {
    // No status filter.
  } else if (statusRaw && ['open', 'in_progress', 'resolved', 'dismissed'].includes(statusRaw)) {
    where.status = statusRaw;
  } else {
    where.status = { in: ['open', 'in_progress'] };
  }
  const rows = await prisma.escalationTicket.findMany({
    where,
    include: {
      nasabah: { select: { kode: true, nama: true, kol: true, dpd: true, sisa: true, hp: true } },
      branch: { select: { kode: true, nama: true } },
      assignedTo: { select: { username: true, nama: true } },
    },
    orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  });
  res.json(rows);
});

const patchSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']).optional(),
  note: z.string().max(2000).optional(),
  assignedToId: z.string().min(1).max(64).nullable().optional(),
});

router.patch('/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const id = String(req.params.id);
  const branchId = scopedBranchId(req);
  const existing = await prisma.escalationTicket.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
  });
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Auto-stamp resolvedAt when moving into terminal status.
  const data: Record<string, unknown> = { ...parsed.data };
  if (
    parsed.data.status &&
    (parsed.data.status === 'resolved' || parsed.data.status === 'dismissed') &&
    !existing.resolvedAt
  ) {
    data.resolvedAt = new Date();
  }
  if (parsed.data.status === 'open' || parsed.data.status === 'in_progress') {
    data.resolvedAt = null;
  }

  const updated = await prisma.escalationTicket.update({ where: { id }, data });
  await audit({
    action: `escalation.${parsed.data.status ?? 'patch'}`, target: id, ...fromReq(req),
    meta: { fields: Object.keys(parsed.data) },
  });
  res.json(updated);
});

// Per-branch summary chip used by the sidebar badge + dashboard tile.
router.get('/summary', async (req, res) => {
  const branchId = scopedBranchId(req);
  const where = branchId ? { branchId } : {};
  const rows = await prisma.escalationTicket.groupBy({
    by: ['severity', 'status'],
    where,
    _count: { _all: true },
  });
  const summary = { open: 0, inProgress: 0, critical: 0, high: 0, medium: 0 };
  for (const r of rows) {
    if (r.status === 'open') summary.open += r._count._all;
    if (r.status === 'in_progress') summary.inProgress += r._count._all;
    if (r.status === 'open' || r.status === 'in_progress') {
      if (r.severity === 'critical') summary.critical += r._count._all;
      else if (r.severity === 'high') summary.high += r._count._all;
      else if (r.severity === 'medium') summary.medium += r._count._all;
    }
  }
  res.json(summary);
});

export default router;
