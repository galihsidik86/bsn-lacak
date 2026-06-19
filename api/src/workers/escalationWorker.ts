import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';
import { pushToUsers } from '../lib/webPush.js';

// CK — escalation matrix sweep. For every active nasabah in kol K3..K5
// whose last successful payment is older than the kol-tiered threshold,
// open a ticket (skipping nasabah that already have an open one) and ping
// the branch supervisors. Tickets stay open until a supervisor closes
// them via the UI.
//
// Cadence (days since last 'berhasil' Pembayaran):
//   K3 → 30, severity 'medium'
//   K4 → 14, severity 'high'
//   K5 →  7, severity 'critical'

const KOL_RULES = [
  { kol: 'K3' as const, days: 30, severity: 'medium' },
  { kol: 'K4' as const, days: 14, severity: 'high' },
  { kol: 'K5' as const, days: 7, severity: 'critical' },
];

let timer: NodeJS.Timeout | null = null;

export async function runEscalationSweep(opts?: { now?: Date }): Promise<{ opened: number }> {
  const now = opts?.now ?? new Date();
  let opened = 0;

  for (const rule of KOL_RULES) {
    const cutoff = new Date(now.getTime() - rule.days * 24 * 60 * 60_000);

    // Candidates: active nasabah with this kol, last Pembayaran older than
    // cutoff (or none ever). We use a raw exists for "no payment newer
    // than cutoff" because Prisma's NOT relation filter on a non-related
    // aggregate is awkward.
    const candidates = await prisma.$queryRaw<Array<{
      id: string; nama: string; kode: string; branchId: string; dpd: number;
    }>>`
      SELECT n."id", n."nama", n."kode", n."branchId", n."dpd"
      FROM "Nasabah" n
      WHERE n."active" = true
        AND n."kol"::text = ${rule.kol}
        AND NOT EXISTS (
          SELECT 1 FROM "Pembayaran" p
          WHERE p."nasabahId" = n."id"
            AND p."status" = 'berhasil'
            AND p."tanggal" >= ${cutoff}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "EscalationTicket" t
          WHERE t."nasabahId" = n."id"
            AND t."status" IN ('open', 'in_progress')
        )
    `;
    if (candidates.length === 0) continue;

    // Group by branch so we ping each supervisor once with a count.
    const byBranch = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const arr = byBranch.get(c.branchId) ?? [];
      arr.push(c);
      byBranch.set(c.branchId, arr);
    }

    for (const [branchId, rows] of byBranch) {
      // Create the tickets first.
      const created = await prisma.escalationTicket.createMany({
        data: rows.map(r => ({
          nasabahId: r.id, branchId,
          severity: rule.severity,
          reason: `${rule.kol} — ${rule.days}+ hari tanpa bayar (DPD ${r.dpd})`,
        })),
      });
      opened += created.count;

      // Notify supervisors of that branch.
      const supervisors = await prisma.user.findMany({
        where: { role: 'SUPERVISOR', branchId, active: true },
        select: { id: true },
      });
      const userIds = supervisors.map(u => u.id);
      if (userIds.length === 0) continue;

      const title = `${rows.length} escalation ${rule.severity.toUpperCase()}`;
      const body = rows.length === 1
        ? `${rows[0].nama} (${rows[0].kode}) — ${rule.kol}, ${rule.days}+ hari tanpa bayar.`
        : `${rows.slice(0, 3).map(r => r.kode).join(', ')}${rows.length > 3 ? '…' : ''} — ${rule.kol}.`;

      await enqueueNotification({
        userIds, type: 'escalation.opened',
        title, body, severity: rule.severity === 'critical' ? 'CRIT' : 'WARN',
        link: 'escalation',
      }).catch(() => undefined);

      void pushToUsers(userIds, {
        title, body,
        link: '/#escalation', tag: `escalation-${branchId}-${rule.kol}`,
      });
    }
  }

  if (opened > 0) {
    await audit({
      action: 'escalation.sweep_opened',
      meta: { opened, generatedAt: now.toISOString() },
    });
    logger.info({ opened }, 'escalation_sweep_completed');
  }
  return { opened };
}

export function startEscalationWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ pollMs: env.ESCALATION_POLL_MS }, 'escalation_worker_started');
  // First sweep after 3 minutes so server boot stays unblocked.
  timer = setTimeout(function loop() {
    runEscalationSweep().catch(e =>
      logger.warn({ err: String(e) }, 'escalation_sweep_failed'));
    timer = setTimeout(loop, env.ESCALATION_POLL_MS);
  }, 3 * 60 * 1000);
}

export function stopEscalationWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
