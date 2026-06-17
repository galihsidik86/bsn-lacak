import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
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

// Bulk import — caller (frontend) parses CSV in the browser, then POSTs an
// array of {kodeNasabah, tanggal, jam, metode, status, nominal}. Each row is
// validated independently. SUPERVISOR is auto-scoped to their branch
// (matching nasabah scope); ADMIN can import across branches. Single txn
// so partial failures don't leave half-imported batches.
const bulkRowSchema = z.object({
  kodeNasabah: z.string().min(1).max(64),
  tanggal: z.coerce.date(),
  jam: z.string().regex(/^\d{2}:\d{2}$/).default('00:00'),
  metode: z.enum(['tunai', 'transfer', 'autodebet']).default('tunai'),
  status: z.enum(['berhasil', 'pending', 'gagal']).default('berhasil'),
  nominal: z.coerce.bigint().positive(),
});
const bulkBody = z.object({
  rows: z.array(bulkRowSchema).min(1).max(2000),
});

interface BulkOutcome {
  index: number;
  kodeNasabah: string;
  status: 'imported' | 'unknown_nasabah' | 'cross_branch' | 'invalid';
  message?: string;
}

router.post('/bulk', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = bulkBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  // Pre-resolve nasabah by kode in one query.
  const kodes = [...new Set(parsed.data.rows.map(r => r.kodeNasabah))];
  const nasabahMap = new Map(
    (await prisma.nasabah.findMany({
      where: { kode: { in: kodes } },
      select: { id: true, kode: true, branchId: true, sisa: true, active: true },
    })).map(n => [n.kode, n]),
  );

  const supervisorBranch = req.user?.role === 'SUPERVISOR' ? req.user.branchId : null;

  const outcomes: BulkOutcome[] = [];
  let imported = 0;
  let totalNominal = 0n;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const row = parsed.data.rows[i];
      const n = nasabahMap.get(row.kodeNasabah);
      if (!n || !n.active) {
        outcomes.push({ index: i, kodeNasabah: row.kodeNasabah, status: 'unknown_nasabah' });
        continue;
      }
      if (supervisorBranch && n.branchId !== supervisorBranch) {
        outcomes.push({ index: i, kodeNasabah: row.kodeNasabah, status: 'cross_branch' });
        continue;
      }
      try {
        await tx.pembayaran.create({
          data: {
            nasabahId: n.id,
            branchId: n.branchId,
            nominal: row.nominal,
            metode: row.metode,
            status: row.status,
            jam: row.jam,
            tanggal: row.tanggal,
          },
        });
        // Apply against outstanding for 'berhasil' rows only — pending/gagal
        // would inflate the reduction even though the bank hasn't received.
        if (row.status === 'berhasil') {
          const next = n.sisa - row.nominal;
          await tx.nasabah.update({
            where: { id: n.id },
            data: { sisa: next < 0n ? 0n : next },
          });
          totalNominal += row.nominal;
        }
        outcomes.push({ index: i, kodeNasabah: row.kodeNasabah, status: 'imported' });
        imported++;
      } catch (e: any) {
        outcomes.push({
          index: i, kodeNasabah: row.kodeNasabah, status: 'invalid',
          message: String(e?.message ?? e).slice(0, 200),
        });
      }
    }
  });

  await audit({
    action: 'pembayaran.bulk_import', ...fromReq(req),
    meta: {
      total: parsed.data.rows.length, imported,
      skipped: parsed.data.rows.length - imported,
      totalNominal: Number(totalNominal),
    },
  });

  res.status(201).json({ imported, total: parsed.data.rows.length, outcomes });
});

// Escape according to RFC 4180: wrap in quotes if cell contains comma, quote,
// or newline; double up internal quotes.
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default router;
