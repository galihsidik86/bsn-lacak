import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';
import { env } from '../env.js';
import { scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { renderKunjunganPdf } from '../lib/pdfKunjungan.js';
import { logger } from '../lib/logger.js';
import { evalGeofence, evalGps, evalPhotoExif, merge } from '../lib/antiFraud.js';
import { enqueueFeedbackRequest } from './feedback.js';
import { sendReceiptWa } from './receipt.js';
import { watermarkPhoto } from '../lib/watermark.js';
import { requireRole } from '../auth.js';
import { pushToUsers } from '../lib/webPush.js';
import { enqueueNotification } from './notifications.js';
import { kunjunganLimiter } from '../lib/rateLimit.js';
import { ZipArchive } from 'archiver';

const router = Router();
router.use(requireAuth);

if (!fs.existsSync(env.UPLOAD_DIR)) fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

// In-memory upload so we can magic-byte-check before writing to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic)$/i.test(file.mimetype)),
});

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

function scope(req: any) {
  const w: Record<string, unknown> = {};
  if (req.user?.role === 'PETUGAS') w.petugasId = req.user.petugasId ?? '__none__';
  const branchId = scopedBranchId(req);
  if (branchId !== null && branchId !== undefined) w.branchId = branchId;
  return w;
}

const body = z.object({
  nasabahId: z.string().min(1).max(64),
  petugasId: z.string().min(1).max(64),
  hasil: z.enum(['BAYAR', 'JANJI', 'TIDAKADA', 'TOLAK']),
  nominal: z.coerce.bigint().nonnegative().default(0n),
  catatan: z.string().max(2000).default(''),
  lokasi: z.string().max(500).default(''),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  valid: z.coerce.boolean().default(true),
});

router.get('/', async (req, res) => {
  const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
  const petugasId = str(req.query.petugasId);
  const list = await prisma.kunjungan.findMany({
    where: { ...scope(req), ...(petugasId ? { petugasId } : {}) },
    include: { fotos: true, petugas: true, nasabah: true },
    orderBy: { tanggal: 'desc' },
    take: 200,
  });
  res.json(list);
});

router.post('/', kunjunganLimiter, upload.array('photos', 5), async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  // A petugas can only file kunjungan in their own name (prevent impersonation).
  if (req.user?.role === 'PETUGAS' && parsed.data.petugasId !== req.user.petugasId) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Derive branch from the petugas; the kunjungan inherits that branch.
  const petugasRow = await prisma.petugas.findUnique({ where: { id: parsed.data.petugasId }, select: { branchId: true } });
  if (!petugasRow) return res.status(400).json({ error: 'unknown_petugas' });

  // Pull nasabah coords for GPS plausibility (lapis A) + name for watermark.
  const nasabahRow = await prisma.nasabah.findUnique({
    where: { id: parsed.data.nasabahId }, select: { lat: true, lng: true, nama: true },
  });
  // Petugas + their assigned wilayah polygon for geofence check (lapis G).
  const petugasInfo = await prisma.petugas.findUnique({
    where: { id: parsed.data.petugasId },
    select: { nama: true, wilayahZone: { select: { polygon: true } } },
  });

  const photos = (req.files as Express.Multer.File[] | undefined) ?? [];

  // Magic-byte check + per-photo EXIF freshness (lapis C) + watermark + persist.
  // Order matters: EXIF check first (on the original bytes), THEN watermark
  // (which re-encodes and would strip EXIF). The watermark is JPEG always.
  const savedPaths: string[] = [];
  const photoEvals = [];
  const now = new Date();
  for (const f of photos) {
    const detected = await fileTypeFromBuffer(f.buffer).catch(() => null);
    if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
      logger.warn({ original: f.originalname, declared: f.mimetype, detected: detected?.mime }, 'upload_rejected_magic_byte');
      return res.status(400).json({ error: 'invalid_file_type' });
    }
    photoEvals.push(await evalPhotoExif(f.buffer));

    const stamped = await watermarkPhoto(f.buffer, {
      petugasNama: petugasInfo?.nama ?? '—',
      nasabahNama: nasabahRow?.nama ?? '—',
      timestamp: now,
      lat: parsed.data.lat ?? null,
      lng: parsed.data.lng ?? null,
    });

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const full = path.join(env.UPLOAD_DIR, filename);
    await fs.promises.writeFile(full, stamped);
    savedPaths.push(path.relative(process.cwd(), full).replace(/\\/g, '/'));
  }

  // Run anti-fraud rules (A + C + geofence).
  const risk = merge(
    evalGps({
      reportedLat: parsed.data.lat, reportedLng: parsed.data.lng,
      nasabahLat: nasabahRow?.lat, nasabahLng: nasabahRow?.lng,
    }),
    evalGeofence(
      parsed.data.lat ?? null,
      parsed.data.lng ?? null,
      petugasInfo?.wilayahZone?.polygon as any ?? null,
    ),
    ...photoEvals,
  );

  const jam = new Date().toTimeString().slice(0, 5);

  // Auto-route: clean reports skip the review queue; flagged ones land
  // in PENDING until a supervisor decides.
  const reviewStatus = risk.score > 0 ? 'PENDING' as const : 'APPROVED' as const;

  const k = await prisma.kunjungan.create({
    data: {
      ...parsed.data,
      branchId: petugasRow.branchId,
      jam,
      // Flip valid to false when any anomaly fired. Supervisors see a "perlu
      // review" badge in the laporan list.
      valid: risk.score === 0 && parsed.data.valid,
      riskScore: risk.score,
      riskFlags: risk.flags,
      reviewStatus,
      fotos: { create: savedPaths.map(p => ({ path: p })) },
    },
    include: { fotos: true },
  });

  // Surface every flagged report in the audit trail (lapis F) and ping the
  // branch's supervisors so they can review without polling.
  if (risk.flags.length > 0) {
    await audit({
      action: 'kunjungan.risk_flagged', target: k.id, ...fromReq(req),
      meta: { flags: risk.flags, score: risk.score, nasabahId: k.nasabahId },
    });
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISOR', branchId: petugasRow.branchId, active: true },
      select: { id: true },
    });
    const supIds = supervisors.map(s => s.id);
    if (supIds.length > 0) {
      await enqueueNotification({
        userIds: supIds,
        type: 'kunjungan.flagged',
        title: 'Laporan perlu review',
        body: `Skor risiko ${risk.score} — ${risk.flags.length} flag terdeteksi.`,
        severity: 'WARN',
        link: 'laporan',
      }).catch(() => undefined);
      // Fire-and-forget web push so phones can wake even if tab is closed.
      void pushToUsers(supIds, {
        title: 'Laporan perlu review',
        body: `Risk score ${risk.score} · ${risk.flags.join(', ')}`,
        link: '/#laporan',
        tag: `flagged-${k.id}`,
      });
    }
  }

  await audit({
    action: 'kunjungan.create', target: k.id, ...fromReq(req),
    meta: { nasabahId: parsed.data.nasabahId, photos: savedPaths.length, hasil: parsed.data.hasil },
  });

  bus.publish('kunjungan.created', {
    kunjunganId: k.id,
    petugasId: k.petugasId,
    nasabahId: k.nasabahId,
    hasil: k.hasil,
    nominal: Number(k.nominal),
    jam: k.jam,
  });

  // Fire-and-forget customer feedback SMS. The function swallows its own
  // failures so a downed gateway never blocks the laporan submission.
  void enqueueFeedbackRequest(k.id);

  // For paid visits, push a WA bukti-bayar link to the nasabah. Same fire-
  // and-forget contract — sendReceiptWa logs + returns instead of throwing.
  if (parsed.data.hasil === 'BAYAR' && parsed.data.nominal > 0n) {
    void sendReceiptWa(k.id);
  }

  res.status(201).json(k);
});

// Bulk export — stream a zip of one PDF per matching kunjungan. Same scope
// as the rest of /kunjungan, so supervisors only get their branch. Capped
// at 500 rows to keep zip + memory bounded.
router.get('/bulk-export.zip', async (req, res) => {
  const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
  const since = str(req.query.since);
  const until = str(req.query.until);
  const petugasId = str(req.query.petugasId);

  const where: Record<string, any> = { ...scope(req) };
  if (petugasId) where.petugasId = petugasId;
  if (since || until) {
    where.tanggal = {};
    if (since) where.tanggal.gte = new Date(since);
    if (until) where.tanggal.lte = new Date(until);
  }

  const rows = await prisma.kunjungan.findMany({
    where,
    include: {
      petugas: true, nasabah: true, fotos: true, branch: true,
      reviewer: { select: { nama: true, username: true } },
    },
    orderBy: { tanggal: 'desc' },
    take: 500,
  });

  if (rows.length === 0) {
    return res.status(404).json({ error: 'empty', message: 'tidak ada laporan pada rentang yang dipilih' });
  }

  const tag = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="laporan-bsn-${tag}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('warning', (e: unknown) => logger.warn({ err: String(e) }, 'bulk_export_zip_warning'));
  archive.on('error', (e: unknown) => {
    logger.error({ err: String(e) }, 'bulk_export_zip_error');
    try { res.end(); } catch { /* already closed */ }
  });
  archive.pipe(res);

  for (const k of rows) {
    const pdf = renderKunjunganPdf({
      kunjungan: k, petugas: k.petugas, nasabah: k.nasabah, branch: k.branch,
      reviewer: k.reviewer ?? null,
    });
    archive.append(pdf as any, { name: `laporan-${k.nasabah.kode}-${k.id}.pdf` });
  }

  await audit({
    action: 'kunjungan.bulk_pdf_export', ...fromReq(req),
    meta: { count: rows.length, since, until, petugasId },
  });

  await archive.finalize();
});

// PDF for one kunjungan. Branch scope applied — supervisors can only print
// their own branch's reports; ADMIN can print across branches.
router.get('/:id/pdf', async (req, res) => {
  const id = String(req.params.id);
  const k = await prisma.kunjungan.findFirst({
    where: { id, ...scope(req) },
    include: {
      petugas: true, nasabah: true, fotos: true, branch: true,
      reviewer: { select: { nama: true, username: true } },
    },
  });
  if (!k) return res.status(404).json({ error: 'not_found' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="laporan-kunjungan-${k.id}.pdf"`);

  await audit({ action: 'kunjungan.pdf_export', target: k.id, ...fromReq(req) });

  const pdf = renderKunjunganPdf({
    kunjungan: k, petugas: k.petugas, nasabah: k.nasabah, branch: k.branch,
    reviewer: k.reviewer ?? null,
  });
  pdf.pipe(res);
});

const reviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2000).optional(),
});

// Supervisor & ADMIN may approve/reject. Petugas may not — their own
// reports stay PENDING until reviewed.
router.patch('/:id/review', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const id = String(req.params.id);
  const k = await prisma.kunjungan.findFirst({
    where: { id, ...scope(req) },
    select: { id: true, petugasId: true, nasabahId: true, reviewStatus: true },
  });
  if (!k) return res.status(404).json({ error: 'not_found' });
  if (k.reviewStatus !== 'PENDING') {
    return res.status(409).json({ error: 'already_reviewed' });
  }

  const updated = await prisma.kunjungan.update({
    where: { id },
    data: {
      reviewStatus: parsed.data.status,
      reviewerId: req.user!.sub,
      reviewedAt: new Date(),
      reviewNote: parsed.data.note ?? null,
    },
  });

  await audit({
    action: `kunjungan.review.${parsed.data.status.toLowerCase()}`,
    target: id, ...fromReq(req),
    meta: { note: parsed.data.note, riskScore: updated.riskScore },
  });

  // Tell the assigned petugas the outcome.
  const petUser = await prisma.user.findFirst({ where: { petugasId: k.petugasId } });
  if (petUser) {
    const isApproved = parsed.data.status === 'APPROVED';
    await enqueueNotification({
      userIds: [petUser.id],
      type: isApproved ? 'kunjungan.approved' : 'kunjungan.rejected',
      title: isApproved ? 'Laporan disetujui' : 'Laporan ditolak',
      body: parsed.data.note || (isApproved ? 'Laporan Anda telah disetujui supervisor.' : 'Laporan perlu diperbaiki — cek catatan supervisor.'),
      severity: isApproved ? 'INFO' : 'WARN',
      link: 'laporan',
    }).catch(() => undefined);
    void pushToUsers([petUser.id], {
      title: isApproved ? '✓ Laporan disetujui' : '⚠ Laporan ditolak',
      body: parsed.data.note ?? '',
      link: '/#riwayat',
      tag: `review-${id}`,
    });
  }

  bus.publish('kunjungan.reviewed', { kunjunganId: id, status: parsed.data.status, by: req.user!.sub });
  res.json(updated);
});

// Bulk approve/reject for supervisor productivity. Each ID is checked
// individually against the requester's branch scope — silently skip rows
// the supervisor can't touch or that are no longer PENDING, return a
// per-row outcome so the UI can show which fired and which didn't.
const bulkReviewSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(100),
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2000).optional(),
});

router.post('/bulk-review', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = bulkReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const reviewer = req.user!.sub;
  const reviewedAt = new Date();
  const outcomes: Array<{ id: string; status: 'reviewed' | 'not_pending' | 'not_found' }> = [];
  const reviewedIds: string[] = [];

  // Fetch in one shot, scoped to the branch the requester can see.
  const candidates = await prisma.kunjungan.findMany({
    where: { id: { in: parsed.data.ids }, ...scope(req) },
    select: { id: true, petugasId: true, reviewStatus: true },
  });
  const map = new Map(candidates.map(c => [c.id, c]));

  for (const id of parsed.data.ids) {
    const c = map.get(id);
    if (!c) { outcomes.push({ id, status: 'not_found' }); continue; }
    if (c.reviewStatus !== 'PENDING') { outcomes.push({ id, status: 'not_pending' }); continue; }
    reviewedIds.push(id);
    outcomes.push({ id, status: 'reviewed' });
  }

  if (reviewedIds.length > 0) {
    await prisma.kunjungan.updateMany({
      where: { id: { in: reviewedIds } },
      data: {
        reviewStatus: parsed.data.status,
        reviewerId: reviewer,
        reviewedAt,
        reviewNote: parsed.data.note ?? null,
      },
    });

    await audit({
      action: `kunjungan.bulk_review.${parsed.data.status.toLowerCase()}`,
      ...fromReq(req),
      meta: { count: reviewedIds.length, note: parsed.data.note },
    });

    // Notify each petugas whose laporan was acted on. Group to avoid
    // sending N separate notifications to the same petugas.
    const updated = await prisma.kunjungan.findMany({
      where: { id: { in: reviewedIds } },
      select: { petugasId: true },
    });
    const petugasIds = [...new Set(updated.map(u => u.petugasId))];
    const petugasUsers = await prisma.user.findMany({
      where: { petugasId: { in: petugasIds } },
      select: { id: true, petugasId: true },
    });

    const isApproved = parsed.data.status === 'APPROVED';
    for (const pu of petugasUsers) {
      const count = updated.filter(u => u.petugasId === pu.petugasId).length;
      await enqueueNotification({
        userIds: [pu.id],
        type: isApproved ? 'kunjungan.approved' : 'kunjungan.rejected',
        title: isApproved ? `${count} laporan disetujui` : `${count} laporan ditolak`,
        body: parsed.data.note ?? '',
        severity: isApproved ? 'INFO' : 'WARN',
        link: 'laporan',
      }).catch(() => undefined);
    }

    for (const id of reviewedIds) {
      bus.publish('kunjungan.reviewed', { kunjunganId: id, status: parsed.data.status, by: reviewer });
    }
  }

  res.json({
    reviewed: reviewedIds.length,
    total: parsed.data.ids.length,
    outcomes,
  });
});

export default router;
