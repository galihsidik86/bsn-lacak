import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { enqueueNotification } from './notifications.js';

// DT — petugas-to-petugas nasabah swap.
//
// Workflow:
//   1. PETUGAS A proposes: their own Nasabah (proposer's nasabah) traded
//      for one of Petugas B's nasabah (counterpart's nasabah). Reason
//      mandatory.
//   2. Counterpart sees the proposal in their queue; supervisor of the
//      branch (or ADMIN) decides. PETUGAS counterpart cannot self-approve.
//   3. On APPROVED: both nasabah rows' petugasId fields swap inside one
//      tx; audit row records the swap.
//   4. Cancel allowed by proposer or counterpart while PENDING.
//
// Cross-branch swaps are allowed only when both petugas share a branch.
// Otherwise reject with cross_branch_forbidden — the org's transfer
// workflow (CC) handles cross-branch moves intentionally.

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const status = String(req.query.status ?? '').trim().toUpperCase();
  const allow = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
  const where: any = {};
  if (allow.includes(status)) where.status = status;

  if (req.user?.role === 'PETUGAS') {
    where.OR = [
      { proposerId: req.user.petugasId ?? '__none__' },
      { counterpartId: req.user.petugasId ?? '__none__' },
    ];
  } else if (branchId) {
    // Supervisor sees only swaps where both legs are in their branch.
    // Avoid a where filter on relation OR — denormalize via Petugas.branchId.
    where.proposer = { branchId };
    where.counterpart = { branchId };
  }

  const rows = await prisma.petugasSwapRequest.findMany({
    where,
    include: {
      proposer: { select: { id: true, kode: true, nama: true, branchId: true } },
      counterpart: { select: { id: true, kode: true, nama: true, branchId: true } },
      proposerNasabah: { select: { id: true, kode: true, nama: true } },
      counterpartNasabah: { select: { id: true, kode: true, nama: true } },
      decidedBy: { select: { username: true, nama: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(rows);
});

const createSchema = z.object({
  proposerNasabahId: z.string().min(1).max(64),
  counterpartNasabahId: z.string().min(1).max(64),
  reason: z.string().min(1).max(2000),
});

router.post('/', async (req, res) => {
  if (req.user?.role !== 'PETUGAS') {
    return res.status(403).json({ error: 'petugas_only' });
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const myPetugasId = req.user.petugasId;
  if (!myPetugasId) return res.status(400).json({ error: 'no_petugas_linked' });

  const [proposerNas, counterpartNas] = await Promise.all([
    prisma.nasabah.findUnique({
      where: { id: parsed.data.proposerNasabahId },
      select: { id: true, petugasId: true, branchId: true, active: true },
    }),
    prisma.nasabah.findUnique({
      where: { id: parsed.data.counterpartNasabahId },
      select: { id: true, petugasId: true, branchId: true, active: true },
    }),
  ]);
  if (!proposerNas || !counterpartNas) return res.status(404).json({ error: 'not_found' });
  if (!proposerNas.active || !counterpartNas.active) return res.status(400).json({ error: 'nasabah_inactive' });
  if (proposerNas.petugasId !== myPetugasId) return res.status(403).json({ error: 'not_owner' });
  if (counterpartNas.petugasId === myPetugasId) return res.status(400).json({ error: 'same_petugas' });
  if (proposerNas.branchId !== counterpartNas.branchId) {
    return res.status(403).json({ error: 'cross_branch_forbidden' });
  }

  const existing = await prisma.petugasSwapRequest.findFirst({
    where: {
      status: 'PENDING',
      OR: [
        { proposerNasabahId: proposerNas.id },
        { counterpartNasabahId: proposerNas.id },
        { proposerNasabahId: counterpartNas.id },
        { counterpartNasabahId: counterpartNas.id },
      ],
    },
    select: { id: true },
  });
  if (existing) return res.status(409).json({ error: 'pending_exists' });

  const row = await prisma.petugasSwapRequest.create({
    data: {
      proposerId: myPetugasId,
      counterpartId: counterpartNas.petugasId,
      proposerNasabahId: proposerNas.id,
      counterpartNasabahId: counterpartNas.id,
      reason: parsed.data.reason,
    },
  });
  await audit({
    action: 'petugas.swap_propose', target: row.id, ...fromReq(req),
    meta: {
      proposer: myPetugasId, counterpart: counterpartNas.petugasId,
      proposerNasabahId: proposerNas.id, counterpartNasabahId: counterpartNas.id,
    },
  });

  // Notify supervisors of the branch so they can decide quickly.
  const supervisors = await prisma.user.findMany({
    where: { role: 'SUPERVISOR', branchId: proposerNas.branchId, active: true },
    select: { id: true },
  });
  if (supervisors.length > 0) {
    await enqueueNotification({
      userIds: supervisors.map(u => u.id), type: 'petugas.swap_pending',
      title: 'Pengajuan tukar nasabah baru',
      body: 'Ada pengajuan tukar nasabah menunggu persetujuan.',
      severity: 'INFO', link: 'distribusi',
    }).catch(() => undefined);
  }

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
  const existing = await prisma.petugasSwapRequest.findUnique({
    where: { id },
    include: {
      proposer: { select: { branchId: true } },
      counterpart: { select: { branchId: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status !== 'PENDING') return res.status(409).json({ error: 'not_pending' });

  const branchId = scopedBranchId(req);
  if (branchId && existing.proposer.branchId !== branchId) return res.status(403).json({ error: 'forbidden' });

  if (parsed.data.decision === 'APPROVED') {
    await prisma.$transaction([
      prisma.petugasSwapRequest.update({
        where: { id },
        data: {
          status: 'APPROVED', decidedById: req.user!.sub,
          decidedAt: new Date(), decisionNote: parsed.data.note ?? null,
        },
      }),
      // Swap petugasId on both nasabah rows.
      prisma.nasabah.update({
        where: { id: existing.proposerNasabahId },
        data: { petugasId: existing.counterpartId },
      }),
      prisma.nasabah.update({
        where: { id: existing.counterpartNasabahId },
        data: { petugasId: existing.proposerId },
      }),
    ]);
    await audit({
      action: 'petugas.swap_apply', target: id, ...fromReq(req),
      meta: {
        proposerNasabahId: existing.proposerNasabahId,
        counterpartNasabahId: existing.counterpartNasabahId,
      },
    });
  } else {
    await prisma.petugasSwapRequest.update({
      where: { id },
      data: {
        status: 'REJECTED', decidedById: req.user!.sub,
        decidedAt: new Date(), decisionNote: parsed.data.note ?? null,
      },
    });
    await audit({ action: 'petugas.swap_reject', target: id, ...fromReq(req) });
  }
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.petugasSwapRequest.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status !== 'PENDING') return res.status(409).json({ error: 'not_pending' });

  if (req.user?.role === 'PETUGAS') {
    const me = req.user.petugasId;
    if (existing.proposerId !== me && existing.counterpartId !== me) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  await prisma.petugasSwapRequest.update({
    where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() },
  });
  await audit({ action: 'petugas.swap_cancel', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
