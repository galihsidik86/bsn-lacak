import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// GeoJSON Polygon schema. A Polygon has at least one ring (outer); each
// ring is a closed list of [lng, lat] pairs (≥4 points; first === last).
const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(
    z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(4),
  ).min(1),
}).refine(p => {
  // Check ring closure (first vertex equals last) for every ring.
  return p.coordinates.every(ring => {
    const a = ring[0]; const b = ring[ring.length - 1];
    return a[0] === b[0] && a[1] === b[1];
  });
}, { message: 'every ring must close (first === last vertex)' });

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const includeInactive = String(req.query.includeInactive) === '1';
  const rows = await prisma.wilayah.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(includeInactive ? {} : { active: true }),
    },
    include: { petugas: { select: { id: true, kode: true, nama: true } } },
    orderBy: { nama: 'asc' },
  });
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const branchId = scopedBranchId(req);
  const row = await prisma.wilayah.findFirst({
    where: { id: String(req.params.id), ...(branchId ? { branchId } : {}) },
    include: { petugas: { select: { id: true, kode: true, nama: true } } },
  });
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

const createSchema = z.object({
  nama: z.string().min(1).max(200),
  polygon: polygonSchema,
  petugasIds: z.array(z.string().min(1).max(64)).default([]),
});

async function guardBranchAccess(req: any, targetBranchId?: string): Promise<{ ok: boolean; error?: string; branchId?: string }> {
  if (req.user?.role === 'PETUGAS') return { ok: false, error: 'forbidden' };
  if (req.user?.role === 'SUPERVISOR') {
    if (targetBranchId && targetBranchId !== req.user.branchId) {
      return { ok: false, error: 'cross_branch_forbidden' };
    }
    return { ok: true, branchId: req.user.branchId };
  }
  // ADMIN: prefer branch override; else require explicit on create.
  const override = scopedBranchId(req);
  if (override) return { ok: true, branchId: override };
  return { ok: true, branchId: targetBranchId };
}

router.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const guard = await guardBranchAccess(req);
  if (!guard.ok) return res.status(403).json({ error: guard.error });
  if (!guard.branchId) return res.status(400).json({ error: 'branch_required' });

  // All target petugas must live in the same branch.
  if (parsed.data.petugasIds.length > 0) {
    const petugas = await prisma.petugas.findMany({
      where: { id: { in: parsed.data.petugasIds } },
      select: { id: true, branchId: true },
    });
    if (petugas.some(p => p.branchId !== guard.branchId)) {
      return res.status(400).json({ error: 'cross_branch_forbidden' });
    }
  }

  const w = await prisma.wilayah.create({
    data: {
      nama: parsed.data.nama,
      polygon: parsed.data.polygon as any,
      branchId: guard.branchId,
    },
  });

  if (parsed.data.petugasIds.length > 0) {
    await prisma.petugas.updateMany({
      where: { id: { in: parsed.data.petugasIds } },
      data: { wilayahZoneId: w.id },
    });
  }

  await audit({
    action: 'wilayah.create', target: w.id, ...fromReq(req),
    meta: { nama: w.nama, petugasIds: parsed.data.petugasIds },
  });
  res.status(201).json(w);
});

const patchSchema = createSchema.partial();

router.patch('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const branchId = scopedBranchId(req);
  const before = await prisma.wilayah.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
  });
  if (!before) return res.status(404).json({ error: 'not_found' });

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const updated = await prisma.wilayah.update({
    where: { id },
    data: {
      nama: parsed.data.nama ?? before.nama,
      polygon: (parsed.data.polygon ?? (before.polygon as any)),
    },
  });

  if (parsed.data.petugasIds) {
    // Replace assignment set atomically: clear current then set new.
    await prisma.petugas.updateMany({
      where: { wilayahZoneId: id, id: { notIn: parsed.data.petugasIds } },
      data: { wilayahZoneId: null },
    });
    if (parsed.data.petugasIds.length > 0) {
      // Branch guard for new assignees.
      const petugas = await prisma.petugas.findMany({
        where: { id: { in: parsed.data.petugasIds } },
        select: { id: true, branchId: true },
      });
      if (petugas.some(p => p.branchId !== before.branchId)) {
        return res.status(400).json({ error: 'cross_branch_forbidden' });
      }
      await prisma.petugas.updateMany({
        where: { id: { in: parsed.data.petugasIds } },
        data: { wilayahZoneId: id },
      });
    }
  }

  await audit({ action: 'wilayah.update', target: id, ...fromReq(req) });
  res.json(updated);
});

router.delete('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const branchId = scopedBranchId(req);
  const before = await prisma.wilayah.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
  });
  if (!before) return res.status(404).json({ error: 'not_found' });

  await prisma.$transaction([
    prisma.petugas.updateMany({ where: { wilayahZoneId: id }, data: { wilayahZoneId: null } }),
    prisma.wilayah.update({ where: { id }, data: { active: false } }),
  ]);
  await audit({ action: 'wilayah.deactivate', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

// Read-only endpoint for the petugas mobile: their own current zone (if any).
router.get('/mine/zone', async (req, res) => {
  if (req.user?.role !== 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const petugasId = req.user.petugasId;
  if (!petugasId) return res.json({ zone: null });
  const p = await prisma.petugas.findUnique({
    where: { id: petugasId },
    include: { wilayahZone: true },
  });
  res.json({ zone: p?.wilayahZone ?? null });
});

export default router;
