import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

// Petugas leave/cuti (CS). Anyone in scope can list their petugas's
// leaves; only SUPERVISOR/ADMIN can create + decide. PETUGAS can also
// list their own.

const router = Router();
router.use(requireAuth);

async function petugasInScope(req: any, petugasId: string) {
  const branchId = scopedBranchId(req);
  return prisma.petugas.findFirst({
    where: { id: petugasId, ...(branchId ? { branchId } : {}) },
    select: { id: true, branchId: true },
  });
}

router.get('/', async (req, res) => {
  const petugasIdQ = String(req.query.petugasId ?? '');
  if (petugasIdQ) {
    if (req.user?.role === 'PETUGAS' && req.user.petugasId !== petugasIdQ) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const p = await petugasInScope(req, petugasIdQ);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const rows = await prisma.petugasLeave.findMany({
      where: { petugasId: petugasIdQ },
      include: { approvedBy: { select: { username: true, nama: true } } },
      orderBy: { startDate: 'desc' },
    });
    return res.json(rows);
  }

  // Branch listing (supervisor/admin) — pending + approved-in-future.
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const upcomingOnly = String(req.query.upcomingOnly ?? '1') === '1';
  const rows = await prisma.petugasLeave.findMany({
    where: {
      ...(branchId ? { petugas: { branchId } } : {}),
      ...(upcomingOnly ? { endDate: { gte: new Date() } } : {}),
    },
    include: {
      petugas: { select: { kode: true, nama: true, branch: { select: { kode: true } } } },
      approvedBy: { select: { username: true, nama: true } },
    },
    orderBy: { startDate: 'asc' },
    take: 200,
  });
  res.json(rows);
});

// CW — calendar view. Approved (+ optional pending) leaves whose window
// overlaps [today, today+days]. ADMIN sees all branches; SUPERVISOR scoped.
router.get('/calendar', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const daysRaw = Number.parseInt(String(req.query.days ?? '30'), 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 180 ? daysRaw : 30;
  const includePending = String(req.query.includePending ?? '0') === '1';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + days * 86400_000);

  const rows = await prisma.petugasLeave.findMany({
    where: {
      ...(branchId ? { petugas: { branchId } } : {}),
      startDate: { lte: horizon },
      endDate: { gte: today },
      ...(includePending ? {} : { status: 'approved' }),
    },
    include: {
      petugas: {
        select: {
          id: true, kode: true, nama: true,
          branch: { select: { id: true, kode: true, nama: true } },
        },
      },
    },
    orderBy: { startDate: 'asc' },
    take: 500,
  });

  // Resolve substitute petugas in one extra query so the UI can show their
  // name + coverage state per row.
  const subIds = Array.from(new Set(rows.map(r => r.substitutePetugasId).filter((x): x is string => !!x)));
  const subs = subIds.length === 0
    ? []
    : await prisma.petugas.findMany({
        where: { id: { in: subIds } },
        select: { id: true, kode: true, nama: true },
      });
  const subMap = new Map(subs.map(s => [s.id, s]));

  res.json({
    rangeStart: today.toISOString(),
    rangeEnd: horizon.toISOString(),
    days,
    rows: rows.map(r => ({
      id: r.id,
      petugas: r.petugas,
      type: r.type,
      status: r.status,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      substitute: r.substitutePetugasId ? subMap.get(r.substitutePetugasId) ?? null : null,
      covered: !!r.substitutePetugasId,
    })),
  });
});

const createSchema = z.object({
  petugasId: z.string().min(1).max(64),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  type: z.enum(['cuti_tahunan', 'sakit', 'dinas_luar', 'lain']),
  reason: z.string().max(2000).optional().nullable(),
  status: z.enum(['pending', 'approved']).default('pending'),
  substitutePetugasId: z.string().min(1).max(64).optional().nullable(),
});

router.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  if (parsed.data.endDate < parsed.data.startDate) {
    return res.status(400).json({ error: 'date_range_invalid' });
  }
  const p = await petugasInScope(req, parsed.data.petugasId);
  if (!p) return res.status(404).json({ error: 'not_found' });

  const row = await prisma.petugasLeave.create({
    data: {
      ...parsed.data,
      ...(parsed.data.status === 'approved'
        ? { approvedById: req.user!.sub, decisionAt: new Date() }
        : {}),
    },
  });
  await audit({
    action: 'leave.create', target: row.id, ...fromReq(req),
    meta: {
      petugasId: parsed.data.petugasId,
      range: `${parsed.data.startDate.toISOString()}..${parsed.data.endDate.toISOString()}`,
      type: parsed.data.type,
    },
  });
  res.status(201).json(row);
});

const patchSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  reason: z.string().max(2000).nullable().optional(),
  type: z.enum(['cuti_tahunan', 'sakit', 'dinas_luar', 'lain']).optional(),
  substitutePetugasId: z.string().min(1).max(64).nullable().optional(),
});

router.patch('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const id = String(req.params.id);
  const existing = await prisma.petugasLeave.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const p = await petugasInScope(req, existing.petugasId);
  if (!p) return res.status(403).json({ error: 'forbidden' });

  const data: Record<string, unknown> = { ...parsed.data };
  if (
    parsed.data.status &&
    parsed.data.status !== existing.status &&
    (parsed.data.status === 'approved' || parsed.data.status === 'rejected')
  ) {
    data.approvedById = req.user!.sub;
    data.decisionAt = new Date();
  }

  const updated = await prisma.petugasLeave.update({ where: { id }, data });
  await audit({
    action: `leave.${parsed.data.status ?? 'patch'}`, target: id, ...fromReq(req),
    meta: { fields: Object.keys(parsed.data) },
  });
  res.json(updated);
});

router.delete('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.petugasLeave.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const p = await petugasInScope(req, existing.petugasId);
  if (!p) return res.status(403).json({ error: 'forbidden' });
  await prisma.petugasLeave.delete({ where: { id } });
  await audit({ action: 'leave.delete', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
