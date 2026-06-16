import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { gateway } from '../lib/gateway/index.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Express matches routes in declaration order, so the specific
// authenticated paths (`/`, `/by-petugas`) MUST be declared before the
// public `/:token` catch-all. `requireAuth` + `requireRole` are inlined
// per-route because `router.use(requireAuth)` would also apply to the
// public token handler below.

// List recent feedback in caller's branch (or all branches for ADMIN).
router.get('/', requireAuth, requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const branchId = scopedBranchId(req);
  const onlyReplied = String(req.query.onlyReplied ?? '1') === '1';
  const minRating = Number.parseInt(String(req.query.minRating ?? ''), 10);
  const maxRating = Number.parseInt(String(req.query.maxRating ?? ''), 10);

  const rows = await prisma.customerFeedback.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(onlyReplied ? { repliedAt: { not: null } } : {}),
      ...(Number.isFinite(minRating) ? { rating: { gte: minRating } } : {}),
      ...(Number.isFinite(maxRating)
        ? { rating: { ...(Number.isFinite(minRating) ? { gte: minRating } : {}), lte: maxRating } }
        : {}),
    },
    include: {
      nasabah: { select: { kode: true, nama: true } },
      petugas: { select: { kode: true, nama: true, hue: true, inisial: true } },
      branch:  { select: { nama: true } },
    },
    orderBy: { sentAt: 'desc' },
    take: 200,
  });
  res.json(rows);
});

// Per-petugas rollup so the Performa screen can colorize low-rating petugas.
router.get('/by-petugas', requireAuth, requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const branchId = scopedBranchId(req);
  const days = Number.parseInt(String(req.query.days ?? '90'), 10);
  const since = new Date(Date.now() - (Number.isFinite(days) ? days : 90) * 24 * 60 * 60 * 1000);

  const rows = await prisma.customerFeedback.groupBy({
    by: ['petugasId'],
    where: {
      ...(branchId ? { branchId } : {}),
      repliedAt: { not: null },
      sentAt: { gte: since },
    },
    _avg: { rating: true },
    _count: { _all: true },
  });
  res.json({ since, rows });
});

// --- Public endpoints (NO auth) ------------------------------------------
//
// Nasabah opens the SMS link, lands on the public feedback page (frontend
// renders #feedback/:token), and POSTs the rating back through here. The
// 64-hex token is unguessable so the endpoint is safe to expose.

router.get('/:token', async (req, res) => {
  const token = String(req.params.token);
  if (!/^[a-f0-9]{32,128}$/.test(token)) return res.status(404).json({ error: 'not_found' });
  const fb = await prisma.customerFeedback.findUnique({
    where: { token },
    include: {
      nasabah: { select: { nama: true } },
      petugas: { select: { nama: true, kode: true } },
      branch:  { select: { nama: true } },
      kunjungan: { select: { tanggal: true, hasil: true } },
    },
  });
  if (!fb) return res.status(404).json({ error: 'not_found' });
  res.json({
    nasabahNama: fb.nasabah.nama,
    petugasNama: fb.petugas.nama,
    petugasKode: fb.petugas.kode,
    branchNama:  fb.branch.nama,
    visitDate:   fb.kunjungan.tanggal,
    visitHasil:  fb.kunjungan.hasil,
    rating:      fb.rating,
    comment:     fb.comment,
    repliedAt:   fb.repliedAt,
  });
});

const submitSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

router.post('/:token', async (req, res) => {
  const token = String(req.params.token);
  if (!/^[a-f0-9]{32,128}$/.test(token)) return res.status(404).json({ error: 'not_found' });
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const fb = await prisma.customerFeedback.findUnique({ where: { token } });
  if (!fb) return res.status(404).json({ error: 'not_found' });
  if (fb.repliedAt) return res.status(409).json({ error: 'already_submitted' });

  const updated = await prisma.customerFeedback.update({
    where: { token },
    data: {
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
      repliedAt: new Date(),
    },
  });
  await audit({
    action: 'feedback.submitted', target: updated.id,
    ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 256),
    meta: { rating: parsed.data.rating, petugasId: updated.petugasId },
  });
  res.json({ ok: true });
});

// --- Helper for kunjungan route ------------------------------------------
//
// Called from POST /api/kunjungan after the row is created. Inserts the
// feedback request and fires an SMS to the nasabah's HP via the existing
// blast gateway. Safe to fail silently — the laporan still completes.

export async function enqueueFeedbackRequest(kunjunganId: string): Promise<void> {
  try {
    const k = await prisma.kunjungan.findUnique({
      where: { id: kunjunganId },
      include: {
        nasabah: { select: { id: true, hp: true, nama: true } },
        petugas: { select: { id: true, nama: true } },
        branch: { select: { id: true, nama: true } },
      },
    });
    if (!k) return;
    const existing = await prisma.customerFeedback.findUnique({ where: { kunjunganId } });
    if (existing) return;

    const token = randomBytes(24).toString('hex');
    await prisma.customerFeedback.create({
      data: {
        token,
        kunjunganId,
        nasabahId: k.nasabahId,
        petugasId: k.petugasId,
        branchId: k.branchId,
      },
    });

    const url = `${env.WEB_ORIGIN.replace(/\/$/, '')}/#feedback/${token}`;
    const message = `BSN Lacak: Beri penilaian layanan ${k.petugas.nama} hari ini. Buka: ${url}`;
    // Don't await beyond a soft fail — gateway already swallows + logs.
    void gateway.send({ channel: 'SMS', to: k.nasabah.hp, body: message })
      .then(r => {
        if (!r.ok) logger.warn({ kunjunganId, err: r.error }, 'feedback_sms_failed');
      })
      .catch(e => logger.warn({ err: String(e) }, 'feedback_sms_threw'));
  } catch (e) {
    logger.warn({ err: String(e), kunjunganId }, 'enqueueFeedbackRequest_failed');
  }
}

export default router;
