import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

// DL — restructure / pelunasan dipercepat workflow. Anyone in branch
// scope can propose. SUPERVISOR/ADMIN can approve/reject. Cancelling is
// allowed for the original proposer if still PENDING. On approve, the
// Nasabah row's sisa/angsuran/tenor are updated and the change is
// audit-logged via the action 'nasabah.restructure_apply'.

const router = Router();
router.use(requireAuth);

function scope(req: any) {
  const branchId = scopedBranchId(req);
  return branchId ? { branchId } : {};
}

async function nasabahInScope(req: any, nasabahId: string) {
  return prisma.nasabah.findFirst({
    where: { id: nasabahId, ...scope(req) },
    select: { id: true, branchId: true, sisa: true, angsuran: true, tenor: true },
  });
}

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const status = String(req.query.status ?? '').trim().toUpperCase();
  const allow = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
  const where: any = branchId ? { nasabah: { branchId } } : {};
  if (allow.includes(status)) where.status = status;
  const rows = await prisma.nasabahRestructure.findMany({
    where,
    include: {
      nasabah: { select: { id: true, kode: true, nama: true, branch: { select: { kode: true } } } },
      proposedBy: { select: { username: true, nama: true, role: true } },
      decidedBy: { select: { username: true, nama: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(rows);
});

router.get('/nasabah/:nasabahId', async (req, res) => {
  const n = await nasabahInScope(req, String(req.params.nasabahId));
  if (!n) return res.status(404).json({ error: 'not_found' });
  const rows = await prisma.nasabahRestructure.findMany({
    where: { nasabahId: n.id },
    include: {
      proposedBy: { select: { username: true, nama: true, role: true } },
      decidedBy: { select: { username: true, nama: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

const proposeSchema = z.object({
  nasabahId: z.string().min(1).max(64),
  newSisa: z.coerce.number().nonnegative(),
  newAngsuran: z.coerce.number().nonnegative(),
  newTenor: z.coerce.number().int().min(1).max(360),
  reason: z.string().min(1).max(2000),
});

router.post('/', async (req, res) => {
  const parsed = proposeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  const n = await nasabahInScope(req, parsed.data.nasabahId);
  if (!n) return res.status(404).json({ error: 'not_found' });

  // Reject if there's already a pending proposal — UI should ask to
  // cancel that one first.
  const existingPending = await prisma.nasabahRestructure.findFirst({
    where: { nasabahId: n.id, status: 'PENDING' },
    select: { id: true },
  });
  if (existingPending) return res.status(409).json({ error: 'pending_exists' });

  const row = await prisma.nasabahRestructure.create({
    data: {
      nasabahId: n.id,
      reason: parsed.data.reason,
      oldSisa: n.sisa,
      newSisa: BigInt(Math.round(parsed.data.newSisa)),
      oldAngsuran: n.angsuran,
      newAngsuran: BigInt(Math.round(parsed.data.newAngsuran)),
      oldTenor: n.tenor,
      newTenor: parsed.data.newTenor,
      proposedById: req.user!.sub,
    },
  });
  await audit({ action: 'nasabah.restructure_propose', target: n.id, ...fromReq(req), meta: { restructureId: row.id } });
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
  const existing = await prisma.nasabahRestructure.findUnique({
    where: { id },
    include: { nasabah: { select: { id: true, branchId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status !== 'PENDING') return res.status(409).json({ error: 'not_pending' });

  // Branch scope on the underlying nasabah.
  const branchId = scopedBranchId(req);
  if (branchId && existing.nasabah.branchId !== branchId) return res.status(403).json({ error: 'forbidden' });

  // On approve, apply the change atomically — the audit row + nasabah
  // update must move together or neither.
  if (parsed.data.decision === 'APPROVED') {
    await prisma.$transaction([
      prisma.nasabahRestructure.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedById: req.user!.sub,
          decidedAt: new Date(),
          decisionNote: parsed.data.note ?? null,
        },
      }),
      prisma.nasabah.update({
        where: { id: existing.nasabah.id },
        data: {
          sisa: existing.newSisa,
          angsuran: existing.newAngsuran,
          tenor: existing.newTenor,
        },
      }),
    ]);
    await audit({
      action: 'nasabah.restructure_apply', target: existing.nasabah.id,
      ...fromReq(req),
      meta: {
        restructureId: id,
        oldSisa: existing.oldSisa.toString(), newSisa: existing.newSisa.toString(),
        oldAngsuran: existing.oldAngsuran.toString(), newAngsuran: existing.newAngsuran.toString(),
        oldTenor: existing.oldTenor, newTenor: existing.newTenor,
      },
    });
  } else {
    await prisma.nasabahRestructure.update({
      where: { id },
      data: {
        status: 'REJECTED',
        decidedById: req.user!.sub,
        decidedAt: new Date(),
        decisionNote: parsed.data.note ?? null,
      },
    });
    await audit({ action: 'nasabah.restructure_reject', target: existing.nasabah.id, ...fromReq(req), meta: { restructureId: id } });
  }

  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.nasabahRestructure.findUnique({
    where: { id },
    include: { nasabah: { select: { id: true, branchId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status !== 'PENDING') return res.status(409).json({ error: 'not_pending' });
  // Only the original proposer or an ADMIN can cancel.
  if (req.user?.role !== 'ADMIN' && existing.proposedById !== req.user!.sub) {
    return res.status(403).json({ error: 'forbidden' });
  }
  await prisma.nasabahRestructure.update({
    where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() },
  });
  await audit({ action: 'nasabah.restructure_cancel', target: existing.nasabah.id, ...fromReq(req), meta: { restructureId: id } });
  res.json({ ok: true });
});

export default router;
