import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

// DO — attendance dispute. Petugas can file a request to correct one
// of their own Attendance rows (e.g. forgot to clock out, wrong device
// time). SUPERVISOR/ADMIN decides; on APPROVED the proposed clockIn /
// clockOut timestamps are applied to the Attendance row inside one
// transaction.

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const status = String(req.query.status ?? '').trim().toUpperCase();
  const allow = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

  const where: any = {};
  if (allow.includes(status)) where.status = status;

  if (req.user?.role === 'PETUGAS') {
    where.petugasId = req.user.petugasId ?? '__none__';
  } else if (branchId) {
    where.petugas = { branchId };
  }

  const rows = await prisma.attendanceDispute.findMany({
    where,
    include: {
      petugas: { select: { id: true, kode: true, nama: true, branch: { select: { kode: true } } } },
      attendance: { select: { id: true, clockInAt: true, clockOutAt: true } },
      decidedBy: { select: { username: true, nama: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(rows);
});

const createSchema = z.object({
  attendanceId: z.string().min(1).max(64),
  reason: z.string().min(1).max(2000),
  proposedClockIn: z.coerce.date().optional().nullable(),
  proposedClockOut: z.coerce.date().optional().nullable(),
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  if (!parsed.data.proposedClockIn && !parsed.data.proposedClockOut) {
    return res.status(400).json({ error: 'no_proposed_time' });
  }

  const att = await prisma.attendance.findUnique({
    where: { id: parsed.data.attendanceId },
    select: { id: true, petugasId: true, branchId: true },
  });
  if (!att) return res.status(404).json({ error: 'not_found' });

  // PETUGAS can only dispute own attendance. Other roles can dispute
  // any attendance in their branch scope.
  if (req.user?.role === 'PETUGAS') {
    if (req.user.petugasId !== att.petugasId) return res.status(403).json({ error: 'forbidden' });
  } else {
    const branchId = scopedBranchId(req);
    if (branchId && att.branchId !== branchId) return res.status(403).json({ error: 'forbidden' });
  }

  const existingPending = await prisma.attendanceDispute.findFirst({
    where: { attendanceId: att.id, status: 'PENDING' },
    select: { id: true },
  });
  if (existingPending) return res.status(409).json({ error: 'pending_exists' });

  const row = await prisma.attendanceDispute.create({
    data: {
      attendanceId: att.id,
      petugasId: att.petugasId,
      reason: parsed.data.reason,
      proposedClockIn: parsed.data.proposedClockIn ?? null,
      proposedClockOut: parsed.data.proposedClockOut ?? null,
    },
  });
  await audit({ action: 'attendance.dispute_open', target: att.id, ...fromReq(req), meta: { disputeId: row.id } });
  res.status(201).json(row);
});

const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2000).optional(),
});

router.patch('/:id/decision', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const id = String(req.params.id);
  const existing = await prisma.attendanceDispute.findUnique({
    where: { id },
    include: { attendance: { select: { id: true, branchId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status !== 'PENDING') return res.status(409).json({ error: 'not_pending' });

  const branchId = scopedBranchId(req);
  if (branchId && existing.attendance.branchId !== branchId) return res.status(403).json({ error: 'forbidden' });

  if (parsed.data.decision === 'APPROVED') {
    const data: { clockInAt?: Date; clockOutAt?: Date | null } = {};
    if (existing.proposedClockIn) data.clockInAt = existing.proposedClockIn;
    if (existing.proposedClockOut) data.clockOutAt = existing.proposedClockOut;

    await prisma.$transaction([
      prisma.attendanceDispute.update({
        where: { id },
        data: {
          status: 'APPROVED', decidedById: req.user!.sub,
          decidedAt: new Date(), decisionNote: parsed.data.note ?? null,
        },
      }),
      prisma.attendance.update({ where: { id: existing.attendance.id }, data }),
    ]);
    await audit({
      action: 'attendance.dispute_apply', target: existing.attendance.id, ...fromReq(req),
      meta: {
        disputeId: id,
        clockInAt: existing.proposedClockIn?.toISOString(),
        clockOutAt: existing.proposedClockOut?.toISOString(),
      },
    });
  } else {
    await prisma.attendanceDispute.update({
      where: { id },
      data: {
        status: 'REJECTED', decidedById: req.user!.sub,
        decidedAt: new Date(), decisionNote: parsed.data.note ?? null,
      },
    });
    await audit({ action: 'attendance.dispute_reject', target: existing.attendance.id, ...fromReq(req), meta: { disputeId: id } });
  }
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.attendanceDispute.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status !== 'PENDING') return res.status(409).json({ error: 'not_pending' });

  if (req.user?.role === 'PETUGAS') {
    if (req.user.petugasId !== existing.petugasId) return res.status(403).json({ error: 'forbidden' });
  }
  await prisma.attendanceDispute.update({
    where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() },
  });
  await audit({ action: 'attendance.dispute_cancel', target: existing.attendanceId, ...fromReq(req), meta: { disputeId: id } });
  res.json({ ok: true });
});

export default router;
