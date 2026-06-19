import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import {
  monthlyRevenueByBranch, topPetugasLeaderboard, kolPosture,
  monthlyClosing, toClosingCsv, branchScorecard, portfolioHeatmap,
  pendingAgingReport, petugasRace, churnRiskList, branchRadar,
  monthlyLeaderboard, supervisorSlaStats, commissionForMonth, periodDelta,
  branchBudgetForMonth,
} from '../lib/analytics.js';

const router = Router();
router.use(requireAuth);

// PETUGAS never gets analytics. SUPERVISOR sees their branch; ADMIN sees
// everything (or a chosen branch via x-branch-id override).
function gate(req: any, res: any): { ok: boolean; branchId?: string | null } {
  if (req.user?.role === 'PETUGAS') {
    res.status(403).json({ error: 'forbidden' });
    return { ok: false };
  }
  const branchId = scopedBranchId(req);
  return { ok: true, branchId: branchId === undefined ? null : branchId };
}

router.get('/overview', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const months = Number.parseInt(String(req.query.months ?? '6'), 10);
  const days = Number.parseInt(String(req.query.days ?? '30'), 10);
  const [revenue, leaderboard, posture] = await Promise.all([
    monthlyRevenueByBranch({
      branchId: g.branchId,
      months: Number.isFinite(months) && months > 0 && months <= 24 ? months : 6,
    }),
    topPetugasLeaderboard({
      branchId: g.branchId,
      days: Number.isFinite(days) && days > 0 && days <= 365 ? days : 30,
      limit: 20,
    }),
    kolPosture(g.branchId),
  ]);
  res.json({ revenue, leaderboard, posture });
});

const closingQ = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

// Monthly closing rows as JSON (for in-app preview).
router.get('/closing', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const parsed = closingQ.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const rows = await monthlyClosing({
    branchId: g.branchId, year: parsed.data.year, month: parsed.data.month,
  });
  res.json({ year: parsed.data.year, month: parsed.data.month, rows });
});

// Same data as CSV download for Excel.
router.get('/closing.csv', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const parsed = closingQ.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const rows = await monthlyClosing({
    branchId: g.branchId, year: parsed.data.year, month: parsed.data.month,
  });
  const csv = toClosingCsv(rows);

  await audit({
    action: 'analytics.closing_export', ...fromReq(req),
    meta: { year: parsed.data.year, month: parsed.data.month, rows: rows.length },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="closing-${parsed.data.year}-${String(parsed.data.month).padStart(2, '0')}.csv"`);
  res.send(csv);
});

// Branch KPI scorecard for the configured month. ADMIN gets every active
// branch; SUPERVISOR is auto-scoped to their own. Targets are read from
// Branch.targetCollection / targetVisits / targetApprovalRate.
router.get('/scorecard', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const parsed = closingQ.safeParse({
    year: req.query.year ?? new Date().getFullYear(),
    month: req.query.month ?? (new Date().getMonth() + 1),
  });
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const rows = await branchScorecard({
    branchId: g.branchId, year: parsed.data.year, month: parsed.data.month,
  });
  res.json({ year: parsed.data.year, month: parsed.data.month, rows });
});

// Branch budget tracker (CV). Defaults to current month.
router.get('/branch-budget', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const now = new Date();
  const year = Number.parseInt(String(req.query.year ?? now.getFullYear()), 10);
  const month = Number.parseInt(String(req.query.month ?? now.getMonth() + 1), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const data = await branchBudgetForMonth({ branchId: g.branchId, year, month });
  res.json(data);
});

// Period delta (CI) — this-month vs last-month for collection, visits,
// approval-rate. SUPERVISOR auto-scoped.
router.get('/period-delta', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const data = await periodDelta({ branchId: g.branchId });
  res.json(data);
});

// Commission table (CD) — per-petugas tertagih × commissionBps for the
// configurable month. Defaults to current month. SUPERVISOR auto-scoped.
router.get('/commission', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const now = new Date();
  const year = Number.parseInt(String(req.query.year ?? now.getFullYear()), 10);
  const month = Number.parseInt(String(req.query.month ?? now.getMonth() + 1), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const data = await commissionForMonth({ branchId: g.branchId, year, month });
  res.json(data);
});

// Supervisor SLA stats — review response time aggregated per reviewer over
// the configurable window. SUPERVISOR auto-scoped to own branch.
router.get('/sla-supervisor', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const days = Number.parseInt(String(req.query.days ?? '30'), 10);
  const window = Number.isFinite(days) && days > 0 && days <= 365 ? days : 30;
  const data = await supervisorSlaStats({ branchId: g.branchId, days: window });
  res.json({ windowDays: window, ...data });
});

// Monthly leaderboard (BU). Defaults to the current month; ?year= and
// ?month= let the UI scroll back. SUPERVISOR auto-scoped.
router.get('/leaderboard-monthly', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const now = new Date();
  const year = Number.parseInt(String(req.query.year ?? now.getFullYear()), 10);
  const month = Number.parseInt(String(req.query.month ?? now.getMonth() + 1), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: 'bad_request' });
  }
  const data = await monthlyLeaderboard({ branchId: g.branchId, year, month, limit: 30 });
  res.json(data);
});

// Branch radar — 5-axis comparison across all branches. ADMIN-only since a
// supervisor's view collapses to one row. No branch override applied; the
// radar's point is cross-branch comparison.
router.get('/branch-radar', async (req, res) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'forbidden' });
  const data = await branchRadar();
  res.json({ branches: data });
});

// Churn risk listing — top-N nasabah ranked by inactivity / DPD / failed
// visits. Default limit 50, cap 200. SUPERVISOR auto-scoped.
router.get('/churn', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  const rows = await churnRiskList({ branchId: g.branchId, limit });
  res.json({ rows });
});

// Petugas race chart — per-petugas monthly tertagih over the configurable
// window (default 6 months, capped at 24). Drives BM line chart.
router.get('/petugas-race', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const months = Number.parseInt(String(req.query.months ?? '6'), 10);
  const data = await petugasRace({
    branchId: g.branchId,
    months: Number.isFinite(months) && months > 0 && months <= 24 ? months : 6,
    topN: 20,
  });
  res.json(data);
});

// PENDING-laporan aging report. Buckets: <1d, 1-3d, 3-7d, 7d+. Returns
// per-branch breakdown and top-20 worst-offender petugas. Branch-scoped.
router.get('/aging', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const report = await pendingAgingReport(g.branchId);
  res.json(report);
});

// Risk-based portfolio heatmap (branch × kol). Same scope rules as the rest
// of analytics. Dense matrix — every cell present even when count = 0.
router.get('/heatmap', async (req, res) => {
  const g = gate(req, res);
  if (!g.ok) return;
  const cells = await portfolioHeatmap(g.branchId);
  res.json({ cells });
});

export default router;
