import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// Annotation shape — normalized [0..1] coordinates so the overlay
// renders at any display size. The frontend canvas writes/reads the
// same schema directly.
const shapeSchema = z.union([
  z.object({
    type: z.literal('circle'),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    r: z.number().min(0).max(1),
    color: z.string().max(32).optional(),
  }),
  z.object({
    type: z.literal('rect'),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    w: z.number().min(0).max(1), h: z.number().min(0).max(1),
    color: z.string().max(32).optional(),
  }),
  z.object({
    type: z.literal('arrow'),
    x1: z.number().min(0).max(1), y1: z.number().min(0).max(1),
    x2: z.number().min(0).max(1), y2: z.number().min(0).max(1),
    color: z.string().max(32).optional(),
  }),
  z.object({
    type: z.literal('note'),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    text: z.string().min(1).max(500),
    color: z.string().max(32).optional(),
  }),
]);

const annotateSchema = z.object({
  annotations: z.array(shapeSchema).max(50),
});

// Branch scope helper — the foto belongs to a kunjungan, which belongs
// to a branch. SUPERVISOR is limited to their own branch.
async function scopedFoto(req: any, fotoId: string) {
  const foto = await prisma.foto.findUnique({
    where: { id: fotoId },
    include: { kunjungan: { select: { branchId: true } } },
  });
  if (!foto) return null;
  const branchId = scopedBranchId(req);
  if (branchId !== null && branchId !== undefined && foto.kunjungan.branchId !== branchId) {
    return null;
  }
  return foto;
}

// DV — all foto for one nasabah (across kunjungan), sorted newest first.
// PETUGAS may only see foto for nasabah they own; SUPERVISOR/ADMIN see
// foto within branch scope.
router.get('/by-nasabah/:nasabahId', async (req, res) => {
  const id = String(req.params.nasabahId);
  const branchId = scopedBranchId(req);
  const nasabah = await prisma.nasabah.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
    select: { id: true, petugasId: true },
  });
  if (!nasabah) return res.status(404).json({ error: 'not_found' });
  if (req.user?.role === 'PETUGAS' && nasabah.petugasId !== req.user.petugasId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const fotos = await prisma.foto.findMany({
    where: { kunjungan: { nasabahId: id } },
    include: {
      kunjungan: {
        select: {
          id: true, tanggal: true, jam: true, hasil: true,
          petugas: { select: { kode: true, nama: true } },
        },
      },
    },
    orderBy: { kunjungan: { tanggal: 'desc' } },
    take: 200,
  });
  res.json(fotos);
});

router.get('/:id/annotations', async (req, res) => {
  const foto = await scopedFoto(req, String(req.params.id));
  if (!foto) return res.status(404).json({ error: 'not_found' });
  res.json({ annotations: foto.annotations });
});

router.patch('/:id/annotations', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = annotateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  const id = String(req.params.id);
  const foto = await scopedFoto(req, id);
  if (!foto) return res.status(404).json({ error: 'not_found' });

  await prisma.foto.update({
    where: { id },
    data: { annotations: parsed.data.annotations as any },
  });
  await audit({
    action: 'foto.annotate', target: id, ...fromReq(req),
    meta: { count: parsed.data.annotations.length, kunjunganId: foto.kunjunganId },
  });
  res.json({ ok: true });
});

export default router;
