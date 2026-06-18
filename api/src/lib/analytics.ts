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

// SLA dashboard (BX) — supervisor review response time over the configurable
// window. Aggregate avg/median/p95 latency per reviewer + reviewed count.
// Population per supervisor is small (10s-100s) so we compute percentiles
// in TypeScript instead of pulling raw percentile_cont via SQL.
export interface SlaSupervisorRow {
  reviewerId: string;
  reviewerNama: string;
  reviewerUsername: string;
  branchKode: string;
  reviewed: number;
  avgMinutes: number;
  medianMinutes: number;
  p95Minutes: number;
}

export async function supervisorSlaStats(opts: {
  branchId?: string | null;
  days?: number;
}): Promise<{ since: string; rows: SlaSupervisorRow[] }> {
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.kunjungan.findMany({
    where: {
      reviewedAt: { not: null, gte: since },
      reviewerId: { not: null },
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
    },
    select: {
      createdAt: true, reviewedAt: true,
      reviewerId: true,
      reviewer: { select: { nama: true, username: true, branch: { select: { kode: true } } } },
    },
    take: 10_000,
  });

  const byReviewer = new Map<string, number[]>();
  const meta = new Map<string, { nama: string; username: string; branchKode: string }>();
  for (const r of rows) {
    if (!r.reviewerId || !r.reviewedAt || !r.reviewer) continue;
    const ms = r.reviewedAt.getTime() - r.createdAt.getTime();
    const arr = byReviewer.get(r.reviewerId) ?? [];
    arr.push(ms);
    byReviewer.set(r.reviewerId, arr);
    if (!meta.has(r.reviewerId)) {
      meta.set(r.reviewerId, {
        nama: r.reviewer.nama,
        username: r.reviewer.username,
        branchKode: r.reviewer.branch?.kode ?? '—',
      });
    }
  }

  const out: SlaSupervisorRow[] = [];
  for (const [id, samples] of byReviewer) {
    samples.sort((a, b) => a - b);
    const m = meta.get(id)!;
    const toMin = (ms: number) => Math.round(ms / 60_000);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
    out.push({
      reviewerId: id,
      reviewerNama: m.nama, reviewerUsername: m.username, branchKode: m.branchKode,
      reviewed: samples.length,
      avgMinutes: toMin(avg),
      medianMinutes: toMin(median),
      p95Minutes: toMin(p95),
    });
  }
  out.sort((a, b) => a.medianMinutes - b.medianMinutes);
  return { since: since.toISOString(), rows: out };
}

// Monthly leaderboard (BU) — petugas ranked by tertagih in the selected
// month (default = current). Returns enough rows for a podium UI + the
// rest as a list. SUPERVISOR auto-scoped to their branch.
export interface MonthlyLeaderRow {
  rank: number;
  petugasId: string;
  kode: string;
  nama: string;
  inisial: string;
  hue: number;
  branchKode: string;
  collected: number;
  visits: number;
}

export async function monthlyLeaderboard(opts: {
  branchId?: string | null;
  year?: number;
  month?: number;
  limit?: number;
}): Promise<{ year: number; month: number; rows: MonthlyLeaderRow[] }> {
  const now = new Date();
  const year = opts.year ?? now.getFullYear();
  const month = opts.month ?? now.getMonth() + 1;
  const limit = opts.limit ?? 20;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const branchFilter = opts.branchId
    ? Prisma.sql`AND p."branchId" = ${opts.branchId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{
    petugasId: string; kode: string; nama: string; inisial: string; hue: number;
    branchKode: string; collected: bigint; visits: bigint;
  }>>`
    SELECT
      p."id" as "petugasId", p."kode", p."nama", p."inisial", p."hue",
      b."kode" as "branchKode",
      COALESCE(SUM(pay."nominal") FILTER (WHERE pay."status" = 'berhasil'), 0) as "collected",
      COUNT(DISTINCT k."id") as "visits"
    FROM "Petugas" p
    JOIN "Branch" b ON b."id" = p."branchId"
    LEFT JOIN "Nasabah" n ON n."petugasId" = p."id"
    LEFT JOIN "Pembayaran" pay
      ON pay."nasabahId" = n."id" AND pay."tanggal" >= ${start} AND pay."tanggal" < ${end}
    LEFT JOIN "Kunjungan" k
      ON k."petugasId" = p."id" AND k."tanggal" >= ${start} AND k."tanggal" < ${end}
    WHERE p."active" = true ${branchFilter}
    GROUP BY p."id", p."kode", p."nama", p."inisial", p."hue", b."kode"
    ORDER BY "collected" DESC, "visits" DESC, p."kode" ASC
    LIMIT ${limit}
  `;

  return {
    year, month,
    rows: rows.map((r, i) => ({
      rank: i + 1,
      petugasId: r.petugasId, kode: r.kode, nama: r.nama,
      inisial: r.inisial, hue: r.hue, branchKode: r.branchKode,
      collected: Number(r.collected), visits: Number(r.visits),
    })),
  };
}

// Branch radar metrics (BP). Five axes normalized 0..100 so they share a
// single radial scale on the chart: collection_rate, approval_rate,
// kunjungan_density, dpd_health (inverted DPD), petugas_utilization.
//
// ADMIN-only — supervisor would just see their own single branch, which
// is a degenerate radar. The lib helper itself is unscoped; the route
// blocks SUPERVISOR.
export interface RadarBranch {
  branchId: string; branchKode: string; branchNama: string;
  metrics: {
    collectionRate: number;     // 0..100, actual / target this month
    approvalRate: number;       // 0..100, APPROVED / (APPROVED + REJECTED)
    visitDensity: number;       // 0..100, visits this month / (target visits)
    dpdHealth: number;          // 0..100, 100 - avg(DPD/90 * 100)
    petugasUtilization: number; // 0..100, petugas active in last 30d / total
  };
  // Raw values so the UI can show "actual / target" tooltips.
  raw: {
    collected: number; targetCollection: number;
    visits: number; targetVisits: number;
    approved: number; rejected: number;
    avgDpd: number;
    activePetugas: number; totalPetugas: number;
  };
}

export async function branchRadar(): Promise<RadarBranch[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const branches = await prisma.branch.findMany({
    where: { active: true },
    select: { id: true, kode: true, nama: true, targetCollection: true, targetVisits: true },
    orderBy: { kode: 'asc' },
  });
  if (branches.length === 0) return [];
  const branchIds = branches.map(b => b.id);

  const [collected, visits, reviews, dpdAgg, petugasAll, petugasActive] = await Promise.all([
    prisma.pembayaran.groupBy({
      by: ['branchId'],
      where: { branchId: { in: branchIds }, status: 'berhasil', tanggal: { gte: monthStart, lt: monthEnd } },
      _sum: { nominal: true },
    }),
    prisma.kunjungan.groupBy({
      by: ['branchId'],
      where: { branchId: { in: branchIds }, tanggal: { gte: monthStart, lt: monthEnd } },
      _count: { _all: true },
    }),
    prisma.kunjungan.groupBy({
      by: ['branchId', 'reviewStatus'],
      where: { branchId: { in: branchIds }, tanggal: { gte: monthStart, lt: monthEnd } },
      _count: { _all: true },
    }),
    prisma.nasabah.groupBy({
      by: ['branchId'],
      where: { branchId: { in: branchIds }, active: true },
      _avg: { dpd: true },
    }),
    prisma.petugas.groupBy({
      by: ['branchId'],
      where: { branchId: { in: branchIds }, active: true },
      _count: { _all: true },
    }),
    prisma.petugasPosition.findMany({
      where: { recordedAt: { gte: since30 }, petugas: { branchId: { in: branchIds }, active: true } },
      distinct: ['petugasId'],
      select: { petugasId: true, petugas: { select: { branchId: true } } },
    }),
  ]);

  const collectedMap = new Map(collected.map(r => [r.branchId, Number(r._sum.nominal ?? 0n)]));
  const visitsMap = new Map(visits.map(r => [r.branchId, r._count._all]));
  const dpdMap = new Map(dpdAgg.map(r => [r.branchId, Number(r._avg.dpd ?? 0)]));
  const petugasMap = new Map(petugasAll.map(r => [r.branchId, r._count._all]));

  const reviewByBranch = new Map<string, { approved: number; rejected: number }>();
  for (const r of reviews) {
    if (r.reviewStatus === 'PENDING') continue;
    const cur = reviewByBranch.get(r.branchId) ?? { approved: 0, rejected: 0 };
    if (r.reviewStatus === 'APPROVED') cur.approved += r._count._all;
    else if (r.reviewStatus === 'REJECTED') cur.rejected += r._count._all;
    reviewByBranch.set(r.branchId, cur);
  }

  const activeByBranch = new Map<string, number>();
  for (const row of petugasActive) {
    const bId = row.petugas.branchId;
    activeByBranch.set(bId, (activeByBranch.get(bId) ?? 0) + 1);
  }

  return branches.map(b => {
    const c = collectedMap.get(b.id) ?? 0;
    const targetC = Number(b.targetCollection);
    const v = visitsMap.get(b.id) ?? 0;
    const targetV = b.targetVisits;
    const rev = reviewByBranch.get(b.id) ?? { approved: 0, rejected: 0 };
    const reviewDenom = rev.approved + rev.rejected;
    const avgDpd = dpdMap.get(b.id) ?? 0;
    const totalP = petugasMap.get(b.id) ?? 0;
    const activeP = activeByBranch.get(b.id) ?? 0;

    return {
      branchId: b.id, branchKode: b.kode, branchNama: b.nama,
      metrics: {
        collectionRate: targetC === 0 ? 0 : Math.min(100, Math.round((c / targetC) * 100)),
        approvalRate: reviewDenom === 0 ? 100 : Math.round((rev.approved / reviewDenom) * 100),
        visitDensity: targetV === 0 ? 0 : Math.min(100, Math.round((v / targetV) * 100)),
        dpdHealth: Math.max(0, Math.round(100 - Math.min(100, (avgDpd / 90) * 100))),
        petugasUtilization: totalP === 0 ? 0 : Math.round((activeP / totalP) * 100),
      },
      raw: {
        collected: c, targetCollection: targetC,
        visits: v, targetVisits: targetV,
        approved: rev.approved, rejected: rev.rejected,
        avgDpd: Math.round(avgDpd),
        activePetugas: activeP, totalPetugas: totalP,
      },
    };
  });
}

// Churn risk listing (BO) — top-N nasabah sorted by churnScore descending.
// Score is computed in TypeScript from a per-nasabah aggregation rather
// than as a stored column so it always reflects the latest payment +
// visit history.
import { churnScore, riskTier, type ChurnInput } from './churnScore.js';

export interface ChurnRow {
  nasabahId: string;
  kode: string;
  nama: string;
  petugasKode: string;
  petugasNama: string;
  branchKode: string;
  kol: 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
  sisa: number;
  dpd: number;
  daysSinceLastPayment: number | null;
  visitsLast30d: number;
  failedVisits30d: number;
  score: number;
  tier: ReturnType<typeof riskTier>;
}

export async function churnRiskList(opts: {
  branchId?: string | null;
  limit?: number;
}): Promise<ChurnRow[]> {
  const limit = opts.limit ?? 50;
  // Load all active nasabah in scope. The branch is small enough that
  // 1k-2k rows in-memory is fine; we score in TS rather than SQL because
  // the weights are easier to tune that way.
  const nasabahRows = await prisma.nasabah.findMany({
    where: {
      active: true,
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
    },
    include: {
      petugas: { select: { kode: true, nama: true } },
      branch: { select: { kode: true } },
    },
  });
  if (nasabahRows.length === 0) return [];

  const ids = nasabahRows.map(n => n.id);
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Latest successful payment per nasabah.
  const lastPayments = await prisma.pembayaran.groupBy({
    by: ['nasabahId'],
    where: { nasabahId: { in: ids }, status: 'berhasil' },
    _max: { tanggal: true },
  });
  const lastPaymentMap = new Map(lastPayments.map(r => [r.nasabahId, r._max.tanggal]));

  // Visit counts in the last 30 days, split by hasil.
  const visits = await prisma.kunjungan.groupBy({
    by: ['nasabahId', 'hasil'],
    where: { nasabahId: { in: ids }, tanggal: { gte: since30 } },
    _count: { _all: true },
  });
  const visitsByNasabah = new Map<string, { total: number; failed: number }>();
  for (const v of visits) {
    const cur = visitsByNasabah.get(v.nasabahId) ?? { total: 0, failed: 0 };
    cur.total += v._count._all;
    if (v.hasil === 'TIDAKADA' || v.hasil === 'TOLAK') cur.failed += v._count._all;
    visitsByNasabah.set(v.nasabahId, cur);
  }

  const out: ChurnRow[] = nasabahRows.map(n => {
    const last = lastPaymentMap.get(n.id);
    const daysSince = last
      ? Math.max(0, Math.floor((Date.now() - last.getTime()) / (24 * 60 * 60 * 1000)))
      : Infinity;
    const v = visitsByNasabah.get(n.id) ?? { total: 0, failed: 0 };
    const input: ChurnInput = {
      active: n.active,
      dpd: n.dpd,
      daysSinceLastPayment: daysSince === Infinity ? 365 : daysSince,
      failedVisits30d: v.failed,
      visitsLast30d: v.total,
    };
    const score = churnScore(input);
    return {
      nasabahId: n.id,
      kode: n.kode,
      nama: n.nama,
      petugasKode: n.petugas.kode,
      petugasNama: n.petugas.nama,
      branchKode: n.branch.kode,
      kol: n.kol,
      sisa: Number(n.sisa),
      dpd: n.dpd,
      daysSinceLastPayment: daysSince === Infinity ? null : daysSince,
      visitsLast30d: v.total,
      failedVisits30d: v.failed,
      score,
      tier: riskTier(score),
    };
  });

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Petugas race chart: per-petugas monthly tertagih over the last N months.
// Drives BM. Capped at top-N petugas by total collected so the line chart
// doesn't melt with 100+ lines on the ADMIN view.
export interface PetugasRacePoint {
  month: string;
  petugasId: string;
  petugasKode: string;
  petugasNama: string;
  hue: number;
  branchKode: string;
  collected: number;
}

export interface PetugasRaceResponse {
  months: string[];
  petugas: Array<{ id: string; kode: string; nama: string; hue: number; branchKode: string; total: number }>;
  points: PetugasRacePoint[];
}

export async function petugasRace(opts: {
  branchId?: string | null;
  months?: number;
  topN?: number;
}): Promise<PetugasRaceResponse> {
  const months = opts.months ?? 6;
  const topN = opts.topN ?? 20;
  const start = new Date();
  start.setMonth(start.getMonth() - (months - 1));
  start.setDate(1); start.setHours(0, 0, 0, 0);

  const branchFilter = opts.branchId
    ? Prisma.sql`AND p."branchId" = ${opts.branchId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{
    month: string | null; petugasId: string; petugasKode: string; petugasNama: string;
    hue: number; branchKode: string; collected: bigint;
  }>>`
    SELECT
      to_char(date_trunc('month', pay."tanggal"), 'YYYY-MM') as "month",
      p."id" as "petugasId", p."kode" as "petugasKode", p."nama" as "petugasNama",
      p."hue", b."kode" as "branchKode",
      COALESCE(SUM(pay."nominal"), 0) as "collected"
    FROM "Petugas" p
    JOIN "Branch" b ON b."id" = p."branchId"
    LEFT JOIN "Nasabah" n ON n."petugasId" = p."id"
    LEFT JOIN "Pembayaran" pay
      ON pay."nasabahId" = n."id"
      AND pay."tanggal" >= ${start}
      AND pay."status" = 'berhasil'
    WHERE p."active" = true ${branchFilter}
    GROUP BY "month", p."id", p."kode", p."nama", p."hue", b."kode"
    ORDER BY "month" ASC, p."kode" ASC
  `;

  // Build the month axis explicitly so months with zero collected still
  // appear on the chart x-axis.
  const monthAxis: string[] = [];
  const cur = new Date(start);
  for (let i = 0; i < months; i++) {
    monthAxis.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }

  const totalByPet = new Map<string, number>();
  for (const r of rows) {
    if (!r.month) continue;
    totalByPet.set(r.petugasId, (totalByPet.get(r.petugasId) ?? 0) + Number(r.collected));
  }
  const topIds = new Set(
    Array.from(totalByPet.entries()).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([id]) => id),
  );

  const petugasMeta = new Map<string, { id: string; kode: string; nama: string; hue: number; branchKode: string; total: number }>();
  for (const r of rows) {
    if (!topIds.has(r.petugasId)) continue;
    if (!petugasMeta.has(r.petugasId)) {
      petugasMeta.set(r.petugasId, {
        id: r.petugasId, kode: r.petugasKode, nama: r.petugasNama,
        hue: r.hue, branchKode: r.branchKode,
        total: totalByPet.get(r.petugasId) ?? 0,
      });
    }
  }

  return {
    months: monthAxis,
    petugas: Array.from(petugasMeta.values()).sort((a, b) => b.total - a.total),
    points: rows
      .filter(r => r.month && topIds.has(r.petugasId))
      .map(r => ({
        month: r.month as string,
        petugasId: r.petugasId,
        petugasKode: r.petugasKode,
        petugasNama: r.petugasNama,
        hue: r.hue,
        branchKode: r.branchKode,
        collected: Number(r.collected),
      })),
  };
}

// Aging report: PENDING kunjungan grouped into age buckets so supervisors
// can see how many laporan have been waiting too long. Per-branch counts
// plus per-petugas top offenders. Age is measured from createdAt, not
// tanggal, so backdated laporan don't appear instantly stale.
export type AgingBucket = '0_1d' | '1_3d' | '3_7d' | '7d_plus';

export interface AgingReport {
  buckets: Record<AgingBucket, number>;
  branches: Array<{
    branchId: string; branchKode: string; branchNama: string;
    buckets: Record<AgingBucket, number>;
    total: number;
  }>;
  petugas: Array<{
    petugasId: string; petugasKode: string; petugasNama: string;
    branchKode: string;
    oldest: Date; days: number;
    count: number;
  }>;
}

function bucketFor(ageMs: number): AgingBucket {
  const days = ageMs / (24 * 60 * 60 * 1000);
  if (days < 1) return '0_1d';
  if (days < 3) return '1_3d';
  if (days < 7) return '3_7d';
  return '7d_plus';
}

const EMPTY_BUCKETS = (): Record<AgingBucket, number> => ({
  '0_1d': 0, '1_3d': 0, '3_7d': 0, '7d_plus': 0,
});

export async function pendingAgingReport(branchId?: string | null): Promise<AgingReport> {
  const now = Date.now();
  const rows = await prisma.kunjungan.findMany({
    where: {
      reviewStatus: 'PENDING',
      ...(branchId ? { branchId } : {}),
    },
    select: {
      id: true, createdAt: true,
      petugas: { select: { id: true, kode: true, nama: true } },
      branch: { select: { id: true, kode: true, nama: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 5000,
  });

  const buckets = EMPTY_BUCKETS();
  const byBranch = new Map<string, { branchId: string; branchKode: string; branchNama: string; buckets: Record<AgingBucket, number>; total: number }>();
  const byPetugas = new Map<string, { petugasId: string; petugasKode: string; petugasNama: string; branchKode: string; oldest: Date; count: number }>();

  for (const r of rows) {
    const ageMs = now - r.createdAt.getTime();
    const b = bucketFor(ageMs);
    buckets[b]++;

    const bk = byBranch.get(r.branch.id) ?? {
      branchId: r.branch.id, branchKode: r.branch.kode, branchNama: r.branch.nama,
      buckets: EMPTY_BUCKETS(), total: 0,
    };
    bk.buckets[b]++;
    bk.total++;
    byBranch.set(r.branch.id, bk);

    const pk = byPetugas.get(r.petugas.id) ?? {
      petugasId: r.petugas.id, petugasKode: r.petugas.kode, petugasNama: r.petugas.nama,
      branchKode: r.branch.kode, oldest: r.createdAt, count: 0,
    };
    if (r.createdAt < pk.oldest) pk.oldest = r.createdAt;
    pk.count++;
    byPetugas.set(r.petugas.id, pk);
  }

  // Cap petugas list to top 20 oldest-first so the UI table stays scannable.
  const petugasArr = Array.from(byPetugas.values())
    .map(p => ({
      ...p,
      days: Math.round((now - p.oldest.getTime()) / (24 * 60 * 60 * 1000) * 10) / 10,
    }))
    .sort((a, b) => a.oldest.getTime() - b.oldest.getTime())
    .slice(0, 20);

  return {
    buckets,
    branches: Array.from(byBranch.values()).sort((a, b) => a.branchKode.localeCompare(b.branchKode)),
    petugas: petugasArr,
  };
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
