import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

const coordsSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // DR — optional odometer reading. Range guard 0..999_999 km is enough
  // for any operating life of a motor dinas.
  km: z.coerce.number().int().min(0).max(999_999).optional(),
});

// PETUGAS clocks themselves in. Reject if there's already an open session
// so we don't accumulate orphan rows.
router.post('/clock-in', async (req, res) => {
  if (req.user?.role !== 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const parsed = coordsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const petugasId = req.user.petugasId;
  if (!petugasId) return res.status(400).json({ error: 'no_petugas_linked' });

  const existing = await prisma.attendance.findFirst({
    where: { petugasId, clockOutAt: null },
  });
  if (existing) return res.status(409).json({ error: 'already_clocked_in', sessionId: existing.id });

  const petugas = await prisma.petugas.findUnique({
    where: { id: petugasId }, select: { branchId: true, active: true },
  });
  if (!petugas || !petugas.active) return res.status(400).json({ error: 'petugas_inactive' });

  const att = await prisma.attendance.create({
    data: {
      petugasId, branchId: petugas.branchId,
      clockInLat: parsed.data.lat ?? null,
      clockInLng: parsed.data.lng ?? null,
      kmStart: parsed.data.km ?? null,
    },
  });
  await audit({ action: 'attendance.clock_in', target: att.id, ...fromReq(req) });
  res.status(201).json(att);
});

router.post('/clock-out', async (req, res) => {
  if (req.user?.role !== 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const parsed = coordsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const petugasId = req.user.petugasId;
  if (!petugasId) return res.status(400).json({ error: 'no_petugas_linked' });

  const open = await prisma.attendance.findFirst({
    where: { petugasId, clockOutAt: null },
    orderBy: { clockInAt: 'desc' },
  });
  if (!open) return res.status(404).json({ error: 'not_clocked_in' });

  // Refuse if kmEnd < kmStart — protect the report from typos.
  if (parsed.data.km != null && open.kmStart != null && parsed.data.km < open.kmStart) {
    return res.status(400).json({ error: 'km_end_below_start' });
  }

  const updated = await prisma.attendance.update({
    where: { id: open.id },
    data: {
      clockOutAt: new Date(),
      clockOutLat: parsed.data.lat ?? null,
      clockOutLng: parsed.data.lng ?? null,
      kmEnd: parsed.data.km ?? null,
    },
  });
  await audit({
    action: 'attendance.clock_out', target: open.id, ...fromReq(req),
    meta: {
      durationMs: updated.clockOutAt!.getTime() - updated.clockInAt.getTime(),
      kmDelta: updated.kmStart != null && updated.kmEnd != null ? updated.kmEnd - updated.kmStart : null,
    },
  });
  res.json(updated);
});

// Petugas hits this to know if they're currently clocked in.
router.get('/mine', async (req, res) => {
  if (req.user?.role !== 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const petugasId = req.user.petugasId;
  if (!petugasId) return res.json({ current: null, today: [] });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [current, today] = await Promise.all([
    prisma.attendance.findFirst({
      where: { petugasId, clockOutAt: null },
      orderBy: { clockInAt: 'desc' },
    }),
    prisma.attendance.findMany({
      where: { petugasId, clockInAt: { gte: startOfDay } },
      orderBy: { clockInAt: 'desc' },
    }),
  ]);
  res.json({ current, today });
});

// SUPERVISOR + ADMIN: who is on-field right now in their branch (or all
// branches for ADMIN). Drives the "Kehadiran hari ini" card.
router.get('/today', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = await prisma.attendance.findMany({
    where: {
      clockInAt: { gte: startOfDay },
      ...(branchId ? { branchId } : {}),
    },
    include: {
      petugas: { select: { id: true, kode: true, nama: true, inisial: true, hue: true, wilayah: true } },
      branch: { select: { kode: true, nama: true } },
    },
    orderBy: { clockInAt: 'desc' },
  });
  res.json(rows);
});

// SUPERVISOR + ADMIN: clock-in points (and clock-out when present) over the
// last N days, scoped by branch. Drives the Peta Kehadiran screen — dots
// on the map per petugas/per day. Defaults to today only; capped at 30
// days because the underlying index is (branchId, clockInAt).
router.get('/map', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const days = Number.parseInt(String(req.query.days ?? '1'), 10);
  const windowDays = Number.isFinite(days) && days > 0 && days <= 30 ? days : 1;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (windowDays - 1));

  const rows = await prisma.attendance.findMany({
    where: {
      clockInAt: { gte: since },
      clockInLat: { not: null }, // skip rows without coords (clock-in via UI lacking GPS)
      ...(branchId ? { branchId } : {}),
    },
    include: {
      petugas: { select: { id: true, kode: true, nama: true, inisial: true, hue: true } },
      branch: { select: { kode: true, nama: true } },
    },
    orderBy: { clockInAt: 'desc' },
    take: 1000,
  });
  res.json({
    since: since.toISOString(),
    windowDays,
    points: rows.map(r => ({
      id: r.id,
      petugasId: r.petugasId,
      petugasKode: r.petugas.kode,
      petugasNama: r.petugas.nama,
      petugasInisial: r.petugas.inisial,
      petugasHue: r.petugas.hue,
      branchKode: r.branch.kode,
      branchNama: r.branch.nama,
      clockInAt: r.clockInAt,
      clockInLat: r.clockInLat,
      clockInLng: r.clockInLng,
      clockOutAt: r.clockOutAt,
      clockOutLat: r.clockOutLat,
      clockOutLng: r.clockOutLng,
    })),
  });
});

export default router;
