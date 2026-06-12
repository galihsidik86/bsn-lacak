import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/workload', async (_req, res) => {
  const rows = await prisma.nasabah.groupBy({
    by: ['petugasId'],
    _count: { _all: true },
    _sum: { sisa: true },
  });
  res.json(rows);
});

const balance = z.object({ targetPerPetugas: z.coerce.number().int().positive().optional() });

router.post('/auto-balance', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = balance.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const petugas = await prisma.petugas.findMany({ orderBy: { kode: 'asc' } });
  if (petugas.length === 0) return res.status(400).json({ error: 'no_petugas' });

  const nasabah = await prisma.nasabah.findMany({ orderBy: { dpd: 'desc' } });

  await prisma.$transaction(
    nasabah.map((n, i) =>
      prisma.nasabah.update({
        where: { id: n.id },
        data: { petugasId: petugas[i % petugas.length].id },
      })
    )
  );

  await audit({ action: 'distribusi.auto_balance', ...fromReq(req), meta: { reassigned: nasabah.length } });

  res.json({ ok: true, reassigned: nasabah.length });
});

export default router;
