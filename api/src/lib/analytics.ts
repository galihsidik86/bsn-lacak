import { prisma } from '../db.js';
import { Prisma } from '@prisma/client';

// HQ + branch-level analytics. ADMIN sees everything; SUPERVISOR sees just
// their branch by passing the branch id through. Everything here is computed
// from existing tables — no separate materialized views, so it stays in
// sync without an ETL story for now.

export interface MonthlyRevenuePoint {
  month: string;        // YYYY-MM
  branchId: string;
  branchKode: string;
  branchNama: string;
  amount: number;       // sum of Pembayaran.nominal in the month
  paymentCount: number;
}

// Returns one row per (branch × month) over the last N months including
// current. ADMIN: all branches; SUPERVISOR: only their branch.
export async function monthlyRevenueByBranch(opts: {
  branchId?: string | null;
  months?: number;
}): Promise<MonthlyRevenuePoint[]> {
  const months = opts.months ?? 6;
  const start = new Date();
  start.setMonth(start.getMonth() - (months - 1));
  start.setDate(1); start.setHours(0, 0, 0, 0);

  const branchFilter = opts.branchId
    ? Prisma.sql`AND b."id" = ${opts.branchId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{
    month: string; branchId: string; branchKode: string; branchNama: string;
    amount: bigint; paymentCount: bigint;
  }>>`
    SELECT
      to_char(date_trunc('month', p."tanggal"), 'YYYY-MM') as "month",
      b."id"   as "branchId",
      b."kode" as "branchKode",
      b."nama" as "branchNama",
      COALESCE(SUM(p."nominal"), 0) as "amount",
      COUNT(p."id") as "paymentCount"
    FROM "Branch" b
    LEFT JOIN "Pembayaran" p
      ON p."branchId" = b."id"
      AND p."tanggal" >= ${start}
      AND p."status" = 'berhasil'
    WHERE 1=1 ${branchFilter}
    GROUP BY "month", b."id", b."kode", b."nama"
    ORDER BY "month" ASC, b."kode" ASC
  `;
  return rows.map(r => ({
    month: r.month,
    branchId: r.branchId,
    branchKode: r.branchKode,
    branchNama: r.branchNama,
    amount: Number(r.amount),
    paymentCount: Number(r.paymentCount),
  }));
}

export interface LeaderboardRow {
  petugasId: string;
  kode: string;
  nama: string;
  branchNama: string;
  totalCollected: number;
  visits: number;
  uniqueNasabah: number;
}

export async function topPetugasLeaderboard(opts: {
  branchId?: string | null;
  days?: number;
  limit?: number;
}): Promise<LeaderboardRow[]> {
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const limit = opts.limit ?? 20;
  const branchFilter = opts.branchId
    ? Prisma.sql`AND p."branchId" = ${opts.branchId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{
    petugasId: string; kode: string; nama: string; branchNama: string;
    totalCollected: bigint; visits: bigint; uniqueNasabah: bigint;
  }>>`
    SELECT
      p."id"   as "petugasId",
      p."kode",
      p."nama",
      b."nama" as "branchNama",
      COALESCE(SUM(pay."nominal"), 0) as "totalCollected",
      COUNT(DISTINCT k."id")           as "visits",
      COUNT(DISTINCT n."id")           as "uniqueNasabah"
    FROM "Petugas" p
    JOIN "Branch" b ON b."id" = p."branchId"
    LEFT JOIN "Kunjungan" k ON k."petugasId" = p."id" AND k."tanggal" >= ${since}
    LEFT JOIN "Nasabah" n   ON n."petugasId" = p."id" AND n."active" = true
    LEFT JOIN "Pembayaran" pay
      ON pay."nasabahId" = n."id"
      AND pay."tanggal" >= ${since}
      AND pay."status" = 'berhasil'
    WHERE p."active" = true ${branchFilter}
    GROUP BY p."id", p."kode", p."nama", b."nama"
    ORDER BY "totalCollected" DESC
    LIMIT ${limit}
  `;
  return rows.map(r => ({
    petugasId: r.petugasId,
    kode: r.kode,
    nama: r.nama,
    branchNama: r.branchNama,
    totalCollected: Number(r.totalCollected),
    visits: Number(r.visits),
    uniqueNasabah: Number(r.uniqueNasabah),
  }));
}

export interface KolPosturePoint {
  kol: 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
  count: number;
  outstanding: number;
}

export async function kolPosture(branchId?: string | null): Promise<KolPosturePoint[]> {
  const rows = await prisma.nasabah.groupBy({
    by: ['kol'],
    where: { active: true, ...(branchId ? { branchId } : {}) },
    _count: { _all: true },
    _sum: { sisa: true },
  });
  return rows
    .map(r => ({
      kol: r.kol,
      count: r._count._all,
      outstanding: Number(r._sum.sisa ?? 0n),
    }))
    .sort((a, b) => a.kol.localeCompare(b.kol));
}

// Monthly closing rows: one row per (branch × petugas) summarizing the
// month. Drives the CSV closing export.
export interface ClosingRow {
  month: string;
  branchKode: string;
  branchNama: string;
  petugasKode: string;
  petugasNama: string;
  visits: number;
  approved: number;
  rejected: number;
  pending: number;
  collected: number;
  uniqueNasabahVisited: number;
}

export async function monthlyClosing(opts: {
  branchId?: string | null;
  year: number;
  month: number;     // 1-12
}): Promise<ClosingRow[]> {
  const start = new Date(opts.year, opts.month - 1, 1);
  const end = new Date(opts.year, opts.month, 1);
  const branchFilter = opts.branchId
    ? Prisma.sql`AND p."branchId" = ${opts.branchId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{
    branchKode: string; branchNama: string;
    petugasKode: string; petugasNama: string;
    visits: bigint; approved: bigint; rejected: bigint; pending: bigint;
    collected: bigint; uniqueNasabahVisited: bigint;
  }>>`
    SELECT
      b."kode" as "branchKode", b."nama" as "branchNama",
      p."kode" as "petugasKode", p."nama" as "petugasNama",
      COUNT(DISTINCT k."id") as "visits",
      COUNT(DISTINCT k."id") FILTER (WHERE k."reviewStatus" = 'APPROVED') as "approved",
      COUNT(DISTINCT k."id") FILTER (WHERE k."reviewStatus" = 'REJECTED') as "rejected",
      COUNT(DISTINCT k."id") FILTER (WHERE k."reviewStatus" = 'PENDING')  as "pending",
      COALESCE(SUM(pay."nominal") FILTER (WHERE pay."status" = 'berhasil'), 0) as "collected",
      COUNT(DISTINCT k."nasabahId") as "uniqueNasabahVisited"
    FROM "Petugas" p
    JOIN "Branch" b ON b."id" = p."branchId"
    LEFT JOIN "Kunjungan" k
      ON k."petugasId" = p."id" AND k."tanggal" >= ${start} AND k."tanggal" < ${end}
    LEFT JOIN "Pembayaran" pay
      ON pay."nasabahId" = k."nasabahId"
      AND pay."tanggal" >= ${start} AND pay."tanggal" < ${end}
    WHERE 1=1 ${branchFilter}
    GROUP BY b."kode", b."nama", p."kode", p."nama"
    ORDER BY b."kode", p."kode"
  `;
  const month = `${opts.year}-${String(opts.month).padStart(2, '0')}`;
  return rows.map(r => ({
    month,
    branchKode: r.branchKode, branchNama: r.branchNama,
    petugasKode: r.petugasKode, petugasNama: r.petugasNama,
    visits: Number(r.visits),
    approved: Number(r.approved),
    rejected: Number(r.rejected),
    pending: Number(r.pending),
    collected: Number(r.collected),
    uniqueNasabahVisited: Number(r.uniqueNasabahVisited),
  }));
}

// CSV with UTF-8 BOM so Indonesian accented names render in Excel.
export function toClosingCsv(rows: ClosingRow[]): string {
  const headers = [
    'Bulan', 'Kode Cabang', 'Cabang', 'Kode Petugas', 'Petugas',
    'Kunjungan', 'Disetujui', 'Pending', 'Ditolak',
    'Nasabah Unik', 'Tertagih (Rp)',
  ];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.month, r.branchKode, r.branchNama, r.petugasKode, r.petugasNama,
      r.visits, r.approved, r.pending, r.rejected,
      r.uniqueNasabahVisited, r.collected,
    ].map(esc).join(','));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
