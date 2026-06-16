import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';

const router = Router();
router.use(requireAuth);

const qSchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

// Branch-scoped global search across the entities a SUPERVISOR / ADMIN
// commonly hops between. PETUGAS never lands here — they only see their
// own assignments anyway and the navigation lives in mobile.

router.get('/', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });

  const parsed = qSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const { q, limit } = parsed.data;

  const branchId = scopedBranchId(req);
  const branchScope = branchId ? { branchId } : {};
  const text = { contains: q, mode: 'insensitive' as const };

  // Parallel queries — one per result group. The OR clauses cover the
  // human-readable field plus the kode lookup that supervisors actually
  // type into the search.
  const [nasabah, petugas, kunjungan, blast, wilayah] = await Promise.all([
    prisma.nasabah.findMany({
      where: {
        ...branchScope,
        OR: [{ nama: text }, { kode: text }, { hp: text }, { alamat: text }],
      },
      select: { id: true, kode: true, nama: true, alamat: true, active: true },
      orderBy: { kode: 'asc' },
      take: limit,
    }),
    prisma.petugas.findMany({
      where: {
        ...branchScope,
        OR: [{ nama: text }, { kode: text }, { wilayah: text }, { hp: text }],
      },
      select: { id: true, kode: true, nama: true, wilayah: true, active: true },
      orderBy: { kode: 'asc' },
      take: limit,
    }),
    prisma.kunjungan.findMany({
      where: {
        ...branchScope,
        OR: [{ catatan: text }, { lokasi: text }],
      },
      include: {
        nasabah: { select: { kode: true, nama: true } },
        petugas: { select: { kode: true, nama: true } },
      },
      orderBy: { tanggal: 'desc' },
      take: limit,
    }),
    prisma.blast.findMany({
      where: { ...branchScope, OR: [{ judul: text }, { template: text }] },
      select: { id: true, judul: true, status: true, kanal: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.wilayah.findMany({
      where: { ...branchScope, nama: text, active: true },
      select: { id: true, nama: true },
      orderBy: { nama: 'asc' },
      take: limit,
    }),
  ]);

  res.json({
    nasabah, petugas, kunjungan, blast, wilayah,
    totalHits: nasabah.length + petugas.length + kunjungan.length + blast.length + wilayah.length,
  });
});

export default router;
