import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

// Petugas certification tracker (AV). SUPERVISOR/ADMIN can CRUD records.
// PETUGAS may GET their own list (so the profile screen can show it).

const router = Router();
router.use(requireAuth);

// Helper — limit operations to certs owned by a petugas in the requester's
// branch scope. Returns the petugas row or null when out of scope.
async function petugasInScope(req: any, petugasId: string) {
  const branchId = scopedBranchId(req);
  return prisma.petugas.findFirst({
    where: { id: petugasId, ...(branchId ? { branchId } : {}) },
    select: { id: true, branchId: true },
  });
}

// GET /api/certifications?petugasId=... — list for one petugas. PETUGAS
// can only request their own; SUPERVISOR/ADMIN can query any in scope.
router.get('/', async (req, res) => {
  const petugasId = String(req.query.petugasId ?? '');
  if (!petugasId) return res.status(400).json({ error: 'bad_request' });
  if (req.user?.role === 'PETUGAS' && req.user.petugasId !== petugasId) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const p = await petugasInScope(req, petugasId);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const rows = await prisma.petugasCertification.findMany({
    where: { petugasId },
    orderBy: [{ validUntil: 'asc' }, { issuedAt: 'desc' }],
    include: { createdBy: { select: { username: true, nama: true } } },
  });
  res.json(rows);
});

// Aging summary across the branch — count of certs expiring in 30/60/90
// days. Drives the supervisor dashboard chip.
router.get('/expiring', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const branchId = scopedBranchId(req);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60_000);
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60_000);

  const rows = await prisma.petugasCertification.findMany({
    where: {
      status: 'aktif',
      validUntil: { not: null, lte: in90 },
      petugas: { active: true, ...(branchId ? { branchId } : {}) },
    },
    include: {
      petugas: { select: { kode: true, nama: true, branch: { select: { kode: true } } } },
    },
    orderBy: { validUntil: 'asc' },
    take: 200,
  });

  const summary = { expired: 0, days30: 0, days60: 0, days90: 0 };
  for (const c of rows) {
    if (!c.validUntil) continue;
    if (c.validUntil < now) summary.expired++;
    else if (c.validUntil <= in30) summary.days30++;
    else if (c.validUntil <= in60) summary.days60++;
    else if (c.validUntil <= in90) summary.days90++;
  }
  res.json({ summary, rows });
});

const createSchema = z.object({
  petugasId: z.string().min(1).max(64),
  nama: z.string().min(1).max(200),
  penerbit: z.string().max(200).optional().nullable(),
  noSertifikat: z.string().max(120).optional().nullable(),
  issuedAt: z.coerce.date(),
  validUntil: z.coerce.date().optional().nullable(),
  status: z.enum(['aktif', 'dicabut', 'expired']).default('aktif'),
  catatan: z.string().max(2000).optional().nullable(),
});

router.post('/', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  const p = await petugasInScope(req, parsed.data.petugasId);
  if (!p) return res.status(404).json({ error: 'not_found' });

  const row = await prisma.petugasCertification.create({
    data: { ...parsed.data, createdById: req.user!.sub },
  });
  await audit({
    action: 'cert.create', target: row.id, ...fromReq(req),
    meta: { petugasId: parsed.data.petugasId, nama: parsed.data.nama },
  });
  res.status(201).json(row);
});

const patchSchema = createSchema.partial().omit({ petugasId: true });

router.patch('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const id = String(req.params.id);
  const existing = await prisma.petugasCertification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const p = await petugasInScope(req, existing.petugasId);
  if (!p) return res.status(403).json({ error: 'forbidden' });

  const updated = await prisma.petugasCertification.update({
    where: { id },
    data: parsed.data,
  });
  await audit({
    action: 'cert.update', target: id, ...fromReq(req),
    meta: { fields: Object.keys(parsed.data) },
  });
  res.json(updated);
});

router.delete('/:id', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const id = String(req.params.id);
  const existing = await prisma.petugasCertification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const p = await petugasInScope(req, existing.petugasId);
  if (!p) return res.status(403).json({ error: 'forbidden' });

  await prisma.petugasCertification.delete({ where: { id } });
  await audit({ action: 'cert.delete', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
