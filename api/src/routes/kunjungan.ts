import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';
import { env } from '../env.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { logger } from '../lib/logger.js';

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
  if (req.user?.role === 'PETUGAS') return { petugasId: req.user.petugasId ?? '__none__' };
  return {};
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

  const photos = (req.files as Express.Multer.File[] | undefined) ?? [];

  // Magic-byte check + persist
  const savedPaths: string[] = [];
  for (const f of photos) {
    const detected = await fileTypeFromBuffer(f.buffer).catch(() => null);
    if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
      logger.warn({ original: f.originalname, declared: f.mimetype, detected: detected?.mime }, 'upload_rejected_magic_byte');
      return res.status(400).json({ error: 'invalid_file_type' });
    }
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${detected.ext}`;
    const full = path.join(env.UPLOAD_DIR, filename);
    await fs.promises.writeFile(full, f.buffer);
    savedPaths.push(path.relative(process.cwd(), full).replace(/\\/g, '/'));
  }

  const jam = new Date().toTimeString().slice(0, 5);

  const k = await prisma.kunjungan.create({
    data: {
      ...parsed.data,
      jam,
      fotos: { create: savedPaths.map(p => ({ path: p })) },
    },
    include: { fotos: true },
  });

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

export default router;
