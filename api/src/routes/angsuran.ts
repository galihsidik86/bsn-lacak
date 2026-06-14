import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const list = await prisma.pembayaran.findMany({
    where: branchId ? { branchId } : {},
    include: { nasabah: { include: { petugas: true } } },
    orderBy: { tanggal: 'desc' },
    take: 200,
  });
  res.json(list);
});

router.get('/payflow', async (req, res) => {
  // 14-day rolling daily sums. The branch filter is conditional — Prisma's
  // tagged-template SQL can't easily inline an optional WHERE clause without
  // ternary, so two parameterised variants is the cleanest.
  const since = new Date();
  since.setDate(since.getDate() - 14);
  const branchId = scopedBranchId(req);
  const rows = branchId
    ? await prisma.$queryRaw<Array<{ hari: Date; nominal: bigint; masuk: bigint }>>`
        SELECT date_trunc('day', "tanggal") AS hari,
               COALESCE(SUM("nominal"), 0) AS nominal,
               COUNT(*)::bigint AS masuk
        FROM "Pembayaran"
        WHERE "tanggal" >= ${since} AND "branchId" = ${branchId}
        GROUP BY 1
        ORDER BY 1 ASC
      `
    : await prisma.$queryRaw<Array<{ hari: Date; nominal: bigint; masuk: bigint }>>`
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

// CSV export of the ledger. Range optional via ?since=&until= (ISO strings).
// Streamed line-by-line so even large branches don't buffer in memory.
router.get('/export.csv', async (req, res) => {
  const branchId = scopedBranchId(req);
  const since = typeof req.query.since === 'string' ? new Date(req.query.since) : undefined;
  const until = typeof req.query.until === 'string' ? new Date(req.query.until) : undefined;

  const rows = await prisma.pembayaran.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(since || until
        ? { tanggal: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
    },
    include: { nasabah: { include: { petugas: true } } },
    orderBy: { tanggal: 'desc' },
    take: 10_000,
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="angsuran-ledger-${stamp}.csv"`);

  // BOM so Excel auto-detects UTF-8.
  res.write('\uFEFF');
  res.write([
    'id', 'tanggal', 'jam', 'nasabah_kode', 'nasabah_nama',
    'petugas_kode', 'petugas_nama', 'metode', 'status', 'nominal',
  ].join(',') + '\n');

  for (const r of rows) {
    const cells = [
      r.id,
      r.tanggal.toISOString().slice(0, 10),
      r.jam,
      r.nasabah.kode,
      r.nasabah.nama,
      r.nasabah.petugas.kode,
      r.nasabah.petugas.nama,
      r.metode,
      r.status,
      Number(r.nominal).toString(),
    ].map(csvCell);
    res.write(cells.join(',') + '\n');
  }
  res.end();

  await audit({ action: 'angsuran.csv_export', ...fromReq(req), meta: { rows: rows.length } });
});

// Escape according to RFC 4180: wrap in quotes if cell contains comma, quote,
// or newline; double up internal quotes.
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default router;
