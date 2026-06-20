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

// Cross-branch comparison stats. ADMIN-only; one row per active branch with
// the rollups the dashboard "Performance per Cabang" card needs.
router.get('/comparison', requireRole('ADMIN'), async (_req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const branches = await prisma.branch.findMany({
    where: { active: true },
    orderBy: { kode: 'asc' },
    select: { id: true, kode: true, nama: true },
  });

  const outstandingByKol = await prisma.nasabah.groupBy({
    by: ['branchId', 'kol'],
    _sum: { sisa: true },
  });

  const nasabahCount = await prisma.nasabah.groupBy({
    by: ['branchId'],
    _count: { _all: true },
  });

  const petugasAgg = await prisma.petugas.groupBy({
    by: ['branchId'],
    _count: { _all: true },
    _sum: { target: true },
  });

  const todaysPay = await prisma.pembayaran.groupBy({
    by: ['branchId'],
    where: { tanggal: { gte: start } },
    _sum: { nominal: true },
  });

  const out = branches.map(b => {
    let outstanding = 0n;
    let nplNom = 0n;
    for (const r of outstandingByKol.filter(x => x.branchId === b.id)) {
      const v = r._sum.sisa ?? 0n;
      outstanding += v;
      if (r.kol === 'K3' || r.kol === 'K4' || r.kol === 'K5') nplNom += v;
    }
    const npl = outstanding > 0n
      ? Number(nplNom) / Number(outstanding) * 100
      : 0;
    return {
      id: b.id, kode: b.kode, nama: b.nama,
      outstanding: Number(outstanding),
      nplNom: Number(nplNom),
      npl,
      nasabah: nasabahCount.find(x => x.branchId === b.id)?._count._all ?? 0,
      petugas: petugasAgg.find(x => x.branchId === b.id)?._count._all ?? 0,
      target: Number(petugasAgg.find(x => x.branchId === b.id)?._sum.target ?? 0n),
      terkumpul: Number(todaysPay.find(x => x.branchId === b.id)?._sum.nominal ?? 0n),
    };
  });

  res.json(out);
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
  // Monthly KPI targets — drive the Scorecard screen. Stored on Branch so
  // ADMIN can override per-cabang without a separate config table.
  targetCollection: z.coerce.bigint().nonnegative().optional(),
  targetVisits: z.coerce.number().int().nonnegative().optional(),
  targetApprovalRate: z.coerce.number().int().min(0).max(100).optional(),
  // CV — monthly budget pots. Stored as bigint so we don't lose precision
  // on large branches; the UI renders them as Rp.
  budgetOperational: z.coerce.bigint().nonnegative().optional(),
  budgetCommission: z.coerce.bigint().nonnegative().optional(),
  // DP — default commission rate (bps) seeded onto new petugas in this
  // branch when their create call omits commissionBps. Null = use the
  // hard-coded 150 system floor.
  defaultCommissionBps: z.coerce.number().int().min(0).max(10_000).nullable().optional(),
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
