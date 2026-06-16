import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { pushToUsers } from '../lib/webPush.js';
import { enqueueNotification } from '../routes/notifications.js';

// Poll every SLA_POLL_MS for PENDING kunjungan that have been waiting
// longer than SLA_PENDING_HOURS without being reviewed AND haven't been
// alerted yet (slaAlertedAt is null). For each batch found, fan out a
// notification to the branch's supervisors and stamp slaAlertedAt so the
// next poll cycle doesn't double-notify.

let timer: NodeJS.Timeout | null = null;

async function sweep(): Promise<void> {
  const threshold = new Date(Date.now() - env.SLA_PENDING_HOURS * 60 * 60 * 1000);
  const stale = await prisma.kunjungan.findMany({
    where: {
      reviewStatus: 'PENDING',
      tanggal: { lt: threshold },
      slaAlertedAt: null,
    },
    select: {
      id: true, branchId: true, tanggal: true, riskScore: true, riskFlags: true,
      nasabah: { select: { nama: true, kode: true } },
    },
    take: 200,
  });
  if (stale.length === 0) return;

  // Group by branch so we can fetch supervisors once per branch.
  const byBranch = new Map<string, typeof stale>();
  for (const k of stale) {
    const arr = byBranch.get(k.branchId) ?? [];
    arr.push(k);
    byBranch.set(k.branchId, arr);
  }

  for (const [branchId, rows] of byBranch) {
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISOR', branchId, active: true },
      select: { id: true },
    });
    const userIds = supervisors.map(s => s.id);
    if (userIds.length === 0) continue;

    const title = `${rows.length} laporan menunggu review > ${env.SLA_PENDING_HOURS}j`;
    const sample = rows.slice(0, 3).map(r => r.nasabah.kode).join(', ');
    const body = rows.length === 1
      ? `Laporan ${rows[0].nasabah.nama} (${rows[0].nasabah.kode}) sudah PENDING ${env.SLA_PENDING_HOURS}j tanpa review.`
      : `Termasuk ${sample}${rows.length > 3 ? '…' : ''}`;

    await enqueueNotification({
      userIds, type: 'sla.pending_breach',
      title, body, severity: 'WARN', link: 'laporan',
    }).catch(() => undefined);

    void pushToUsers(userIds, {
      title, body,
      link: '/#laporan', tag: `sla-${branchId}`,
    });

    await prisma.kunjungan.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { slaAlertedAt: new Date() },
    });
    await audit({
      action: 'sla.pending_breach',
      meta: { branchId, count: rows.length, sample },
    });
  }

  logger.info({ count: stale.length, branches: byBranch.size }, 'sla_alerts_dispatched');
}

export function startSlaWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ pollMs: env.SLA_POLL_MS, hours: env.SLA_PENDING_HOURS }, 'sla_worker_started');
  // Defer the first sweep so server boot isn't blocked by DB IO.
  timer = setTimeout(function loop() {
    sweep().catch(e => logger.warn({ err: String(e) }, 'sla_sweep_failed'));
    timer = setTimeout(loop, env.SLA_POLL_MS);
  }, 5_000);
}

export function stopSlaWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

// Exposed for tests / manual triggers (e.g. ops console).
export const __sweepForTests = sweep;
