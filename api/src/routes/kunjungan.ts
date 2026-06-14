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
import { evalGps, evalPhotoExif, merge } from '../lib/antiFraud.js';
import { watermarkPhoto } from '../lib/watermark.js';

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

router.post('/', upload.array('photos', 5), async (req, res) => {
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
  const petugasInfo = await prisma.petugas.findUnique({
    where: { id: parsed.data.petugasId }, select: { nama: true },
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

  // Run anti-fraud rules (A + C).
  const risk = merge(
    evalGps({
      reportedLat: parsed.data.lat, reportedLng: parsed.data.lng,
      nasabahLat: nasabahRow?.lat, nasabahLng: nasabahRow?.lng,
    }),
    ...photoEvals,
  );

  const jam = new Date().toTimeString().slice(0, 5);

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
      fotos: { create: savedPaths.map(p => ({ path: p })) },
    },
    include: { fotos: true },
  });

  // Surface every flagged report in the audit trail (lapis F).
  if (risk.flags.length > 0) {
    await audit({
      action: 'kunjungan.risk_flagged', target: k.id, ...fromReq(req),
      meta: { flags: risk.flags, score: risk.score, nasabahId: k.nasabahId },
    });
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

  res.status(201).json(k);
});

// PDF for one kunjungan. Branch scope applied — supervisors can only print
// their own branch's reports; ADMIN can print across branches.
router.get('/:id/pdf', async (req, res) => {
  const id = String(req.params.id);
  const k = await prisma.kunjungan.findFirst({
    where: { id, ...scope(req) },
    include: { petugas: true, nasabah: true, fotos: true, branch: true },
  });
  if (!k) return res.status(404).json({ error: 'not_found' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="laporan-kunjungan-${k.id}.pdf"`);

  await audit({ action: 'kunjungan.pdf_export', target: k.id, ...fromReq(req) });

  const pdf = renderKunjunganPdf({
    kunjungan: k, petugas: k.petugas, nasabah: k.nasabah, branch: k.branch,
  });
  pdf.pipe(res);
});

export default router;
