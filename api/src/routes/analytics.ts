import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import {
  monthlyRevenueByBranch, topPetugasLeaderboard, kolPosture,
  monthlyClosing, toClosingCsv,
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

export default router;
