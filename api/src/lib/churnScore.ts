// Nasabah churn / inactivity risk score (BO). Pure function over a
// snapshot — caller is responsible for gathering the input fields.
// Score in 0..100 where higher = more concerning.
//
// Weights:
//   - days_since_last_payment   30 pts at 90+ days
//   - dpd                       25 pts at 90+ days
//   - failed_visits_30d         20 pts at 4+ TIDAKADA/TOLAK visits
//   - no_visit_30d              15 pts when no visit happened at all
//   - inactive_flag             10 pts when nasabah.active === false
//
// The exact numbers are tuned to land "moderately overdue, no recent
// outreach" cases around 50-65 so the top-N list highlights actual risk
// without burying everyone in red.

export interface ChurnInput {
  active: boolean;
  dpd: number;
  daysSinceLastPayment: number;   // Infinity when no payment yet
  failedVisits30d: number;        // TIDAKADA + TOLAK in last 30 days
  visitsLast30d: number;
}

export function churnScore(c: ChurnInput): number {
  const paymentScore = Math.min(30, (c.daysSinceLastPayment / 90) * 30);
  const dpdScore = Math.min(25, (c.dpd / 90) * 25);
  const failedVisitScore = Math.min(20, c.failedVisits30d * 5);
  const noVisitScore = c.visitsLast30d === 0 ? 15 : 0;
  const inactiveScore = c.active ? 0 : 10;
  return Math.round(paymentScore + dpdScore + failedVisitScore + noVisitScore + inactiveScore);
}

export function riskTier(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}
