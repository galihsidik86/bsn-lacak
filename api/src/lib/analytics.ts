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

// Branch-level scorecard: per-branch monthly KPI achievement vs target.
// Drives the Scorecard screen. SUPERVISOR sees just their branch.
export interface ScorecardRow {
  branchId: string;
  branchKode: string;
  branchNama: string;
  targetCollection: number;
  actualCollection: number;
  targetVisits: number;
  actualVisits: number;
  targetApprovalRate: number;  // percent 0..100
  actualApprovalRate: number;  // percent 0..100, NaN-safe → 0 when no reviews
}

export async function branchScorecard(opts: {
  branchId?: string | null;
  year: number;
  month: number;
}): Promise<ScorecardRow[]> {
  const start = new Date(opts.year, opts.month - 1, 1);
  const end = new Date(opts.year, opts.month, 1);

  const branches = await prisma.branch.findMany({
    where: {
      active: true,
      ...(opts.branchId ? { id: opts.branchId } : {}),
    },
    select: {
      id: true, kode: true, nama: true,
      targetCollection: true, targetVisits: true, targetApprovalRate: true,
    },
    orderBy: { kode: 'asc' },
  });
  if (branches.length === 0) return [];

  const branchIds = branches.map(b => b.id);

  // Three aggregates in parallel — collected (Rp), visit count, approved/rejected
  // counts. PENDING rows are excluded from the rate denominator so a backlog
  // doesn't drag the metric down before supervisors get to them.
  const [collectedRows, visitRows, reviewRows] = await Promise.all([
    prisma.pembayaran.groupBy({
      by: ['branchId'],
      where: {
        branchId: { in: branchIds },
        status: 'berhasil',
        tanggal: { gte: start, lt: end },
      },
      _sum: { nominal: true },
    }),
    prisma.kunjungan.groupBy({
      by: ['branchId'],
      where: { branchId: { in: branchIds }, tanggal: { gte: start, lt: end } },
      _count: { _all: true },
    }),
    prisma.kunjungan.groupBy({
      by: ['branchId', 'reviewStatus'],
      where: { branchId: { in: branchIds }, tanggal: { gte: start, lt: end } },
      _count: { _all: true },
    }),
  ]);

  const collectedMap = new Map(collectedRows.map(r => [r.branchId, Number(r._sum.nominal ?? 0n)]));
  const visitMap = new Map(visitRows.map(r => [r.branchId, r._count._all]));
  const reviewByBranch = new Map<string, { approved: number; rejected: number }>();
  for (const r of reviewRows) {
    if (r.reviewStatus === 'PENDING') continue;
    const cur = reviewByBranch.get(r.branchId) ?? { approved: 0, rejected: 0 };
    if (r.reviewStatus === 'APPROVED') cur.approved += r._count._all;
    else if (r.reviewStatus === 'REJECTED') cur.rejected += r._count._all;
    reviewByBranch.set(r.branchId, cur);
  }

  return branches.map(b => {
    const rev = reviewByBranch.get(b.id) ?? { approved: 0, rejected: 0 };
    const denom = rev.approved + rev.rejected;
    const actualApprovalRate = denom === 0 ? 0 : Math.round((rev.approved / denom) * 100);
    return {
      branchId: b.id,
      branchKode: b.kode,
      branchNama: b.nama,
      targetCollection: Number(b.targetCollection),
      actualCollection: collectedMap.get(b.id) ?? 0,
      targetVisits: b.targetVisits,
      actualVisits: visitMap.get(b.id) ?? 0,
      targetApprovalRate: b.targetApprovalRate,
      actualApprovalRate,
    };
  });
}

// Risk-based portfolio heatmap: one row per branch × kolektabilitas bucket,
// showing count + outstanding. Drives a color-graded matrix where red cells
// (high kol, high outstanding) flag concentrated risk for management.
export interface HeatmapCell {
  branchId: string;
  branchKode: string;
  branchNama: string;
  kol: 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
  count: number;
  outstanding: number;
}

export async function portfolioHeatmap(branchId?: string | null): Promise<HeatmapCell[]> {
  // Single groupBy over (branch × kol). Branch metadata joined client-side
  // so we don't double-roundtrip for kode/nama.
  const branches = await prisma.branch.findMany({
    where: { active: true, ...(branchId ? { id: branchId } : {}) },
    select: { id: true, kode: true, nama: true },
    orderBy: { kode: 'asc' },
  });
  if (branches.length === 0) return [];

  const branchIds = branches.map(b => b.id);
  const rows = await prisma.nasabah.groupBy({
    by: ['branchId', 'kol'],
    where: { active: true, branchId: { in: branchIds } },
    _count: { _all: true },
    _sum: { sisa: true },
  });

  const meta = new Map(branches.map(b => [b.id, b]));
  const KOLS: HeatmapCell['kol'][] = ['K1', 'K2', 'K3', 'K4', 'K5'];

  // Fill the matrix densely — every (branch × kol) cell present even when
  // count = 0, so the UI doesn't need to handle missing cells.
  const out: HeatmapCell[] = [];
  for (const b of branches) {
    for (const kol of KOLS) {
      const r = rows.find(x => x.branchId === b.id && x.kol === kol);
      out.push({
        branchId: b.id,
        branchKode: b.kode,
        branchNama: b.nama,
        kol,
        count: r ? r._count._all : 0,
        outstanding: r ? Number(r._sum.sisa ?? 0n) : 0,
      });
    }
  }
  return out;
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
