import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const list = await prisma.blast.findMany({
    where: branchId ? { branchId } : {},
    orderBy: { createdAt: 'desc' }, take: 100,
  });
  res.json(list);
});

const create = z.object({
  judul: z.string().min(1).max(200).default('Blast'),
  kanal: z.enum(['WA', 'SMS']),
  template: z.string().min(1).max(2000),
  recipientIds: z.array(z.string().min(1).max(64)).min(1).max(5000),
  scheduledAt: z.string().datetime().optional(),
});

router.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = create.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  // Recipients must live in the requester's branch unless they're an ADMIN.
  const branchId = scopedBranchId(req);
  const recipients = await prisma.nasabah.findMany({
    where: {
      id: { in: parsed.data.recipientIds },
      ...(branchId ? { branchId } : {}),
    },
    select: { id: true, hp: true, branchId: true },
  });
  if (recipients.length === 0) return res.status(400).json({ error: 'no_recipients' });
  if (recipients.length !== parsed.data.recipientIds.length) {
    return res.status(403).json({ error: 'cross_branch_forbidden' });
  }
  // All recipients share a branch (enforced above) — use it for the Blast row.
  const blastBranchId = recipients[0].branchId;

  const blast = await prisma.blast.create({
    data: {
      judul: parsed.data.judul,
      kanal: parsed.data.kanal,
      template: parsed.data.template,
      status: parsed.data.scheduledAt ? 'TERJADWAL' : 'BERJALAN',
      target: recipients.length,
      branchId: blastBranchId,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      recipients: { create: recipients.map(r => ({ nasabahId: r.id, hp: r.hp })) },
    },
  });

  await audit({
    action: 'blast.create', target: blast.id, ...fromReq(req),
    meta: { kanal: parsed.data.kanal, recipients: recipients.length, scheduled: !!parsed.data.scheduledAt },
  });

  // Gateway dispatch goes here (Twilio / WA Business / etc).
  res.status(201).json({ jobId: blast.id });
});

// Cancel an unfired blast. Only allowed while it's still TERJADWAL — once
// the worker flips it to BERJALAN, individual recipients have already begun
// dispatching and partial cancellation is messier than we want to model.
router.patch('/:id/cancel', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const branchId = scopedBranchId(req);
  const blast = await prisma.blast.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
  });
  if (!blast) return res.status(404).json({ error: 'not_found' });
  if (blast.status !== 'TERJADWAL') {
    return res.status(409).json({ error: 'not_cancellable', currentStatus: blast.status });
  }
  const updated = await prisma.blast.update({
    where: { id },
    data: { status: 'DIBATALKAN' },
  });
  await audit({ action: 'blast.cancel', target: id, ...fromReq(req) });
  res.json(updated);
});

export default router;
