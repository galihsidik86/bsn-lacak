import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res) => {
  const list = await prisma.pembayaran.findMany({
    include: { nasabah: { include: { petugas: true } } },
    orderBy: { tanggal: 'desc' },
    take: 200,
  });
  res.json(list);
});

router.get('/payflow', async (_req, res) => {
  // 14-day rolling daily sums
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const rows = await prisma.$queryRaw<Array<{ hari: Date; nominal: bigint; masuk: bigint }>>`
    SELECT date_trunc('day', "tanggal") AS hari,
           COALESCE(SUM("nominal"), 0) AS nominal,
           COUNT(*)::bigint AS masuk
    FROM "Pembayaran"
    WHERE "tanggal" >= ${since}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  res.json(rows.map(r => ({
    hari: String(r.hari).slice(8, 10),
    nominal: Number(r.nominal),
    masuk: Number(r.masuk),
    target: 60_000_000,
  })));
});

export default router;
