import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

// DN — nasabah document attachments. Mounted at /api/nasabah-docs since
// the existing /api/nasabah file is already large and mostly business
// data. Files written under env.UPLOAD_DIR; served by the existing
// /uploads static mount.

const router = Router();
router.use(requireAuth);

if (!fs.existsSync(env.UPLOAD_DIR)) fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const DOC_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, DOC_MIMES.has(file.mimetype)),
});

const KINDS = ['KTP', 'KONTRAK', 'AGUNAN', 'SLIP_GAJI', 'LAIN'] as const;
type Kind = (typeof KINDS)[number];

function scope(req: any) {
  const branchId = scopedBranchId(req);
  return branchId ? { branchId } : {};
}

router.get('/:nasabahId', async (req, res) => {
  const id = String(req.params.nasabahId);
  const n = await prisma.nasabah.findFirst({ where: { id, ...scope(req) }, select: { id: true } });
  if (!n) return res.status(404).json({ error: 'not_found' });
  const rows = await prisma.nasabahDocument.findMany({
    where: { nasabahId: id },
    include: { uploadedBy: { select: { username: true, nama: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

router.post('/:nasabahId', requireRole('SUPERVISOR', 'ADMIN'), upload.single('file'), async (req, res) => {
  const id = String(req.params.nasabahId);
  const n = await prisma.nasabah.findFirst({ where: { id, ...scope(req) }, select: { id: true } });
  if (!n) return res.status(404).json({ error: 'not_found' });
  if (!req.file) return res.status(400).json({ error: 'no_file' });

  const kind = String((req.body ?? {}).kind ?? '').toUpperCase() as Kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'bad_kind' });
  const notes = String((req.body ?? {}).notes ?? '').slice(0, 500) || null;
  const fileName = String(req.file.originalname).slice(0, 200) || 'file';

  const ext = path.extname(fileName) || (req.file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
  const stored = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const full = path.join(env.UPLOAD_DIR, stored);
  await fs.promises.writeFile(full, req.file.buffer);
  const filePath = path.relative(process.cwd(), full).replace(/\\/g, '/');

  const row = await prisma.nasabahDocument.create({
    data: {
      nasabahId: id,
      kind,
      fileName,
      filePath,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      notes,
      uploadedById: req.user!.sub,
    },
  });
  await audit({ action: 'nasabah.doc_upload', target: id, ...fromReq(req), meta: { docId: row.id, kind } });
  res.status(201).json(row);
});

router.delete('/:nasabahId/:docId', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.nasabahId);
  const docId = String(req.params.docId);
  const n = await prisma.nasabah.findFirst({ where: { id, ...scope(req) }, select: { id: true } });
  if (!n) return res.status(404).json({ error: 'not_found' });
  const doc = await prisma.nasabahDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.nasabahId !== id) return res.status(404).json({ error: 'not_found' });

  // Best-effort delete the file. Even if the unlink fails (e.g. file
  // already gone), drop the DB row so the listing stays honest.
  try { await fs.promises.unlink(path.resolve(doc.filePath)); }
  catch { /* swallow — DB row removal is the source of truth */ }

  await prisma.nasabahDocument.delete({ where: { id: docId } });
  await audit({ action: 'nasabah.doc_delete', target: id, ...fromReq(req), meta: { docId } });
  res.json({ ok: true });
});

export default router;
