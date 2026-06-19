import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';
import { pushToUsers } from '../lib/webPush.js';
import { petugasOnLeaveOn } from '../lib/leaveCheck.js';

// CO — petugas inactivity detector. Once a day at the configured hour,
// find every active petugas whose latest Kunjungan tanggal is older than
// INACTIVITY_DAYS (default 3). Notify the branch's supervisors so they
// can intervene.
//
// Dedup: audit row `petugas.inactivity_alerted` keyed on
// `${petugasId}-${dateKey}`. A petugas can be alerted again on a later
// day if they remain inactive.

const ACTION = 'petugas.inactivity_alerted';

let timer: NodeJS.Timeout | null = null;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function runInactivitySweep(opts?: { now?: Date; force?: boolean }):
  Promise<{ ok: boolean; reason?: string; alerted?: number; day?: string }>
{
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  const day = dateKey(now);

  if (!force) {
    if (now.getHours() !== env.INACTIVITY_CHECK_HOUR) return { ok: false, reason: 'not_hour' };
  }

  const cutoff = new Date(now.getTime() - env.INACTIVITY_DAYS * 24 * 60 * 60_000);

  // Active petugas + last kunjungan tanggal in one query.
  const petugas = await prisma.petugas.findMany({
    where: { active: true },
    select: {
      id: true, kode: true, nama: true, branchId: true,
      kunjungan: {
        orderBy: { tanggal: 'desc' },
        take: 1,
        select: { tanggal: true },
      },
    },
  });
  // CS — petugas on approved leave today are not "inactive" in a way
  // supervisors care about; skip them.
  const onLeave = await petugasOnLeaveOn(now);
  const inactive = petugas.filter(p => {
    if (onLeave.has(p.id)) return false;
    const latest = p.kunjungan[0]?.tanggal;
    return !latest || latest < cutoff;
  });
  if (inactive.length === 0) return { ok: true, alerted: 0, day };

  // Dedup against existing audit rows from earlier this same day.
  const recent = await prisma.auditLog.findMany({
    where: {
      action: ACTION,
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
    },
    select: { target: true },
  });
  const alreadyAlerted = new Set(recent.map(r => r.target!).filter(Boolean));

  // Group by branch — one notification per (branch, batch).
  const byBranch = new Map<string, typeof inactive>();
  for (const p of inactive) {
    if (alreadyAlerted.has(p.id)) continue;
    const arr = byBranch.get(p.branchId) ?? [];
    arr.push(p);
    byBranch.set(p.branchId, arr);
  }

  let alerted = 0;
  for (const [branchId, batch] of byBranch) {
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISOR', branchId, active: true },
      select: { id: true },
    });
    const userIds = supervisors.map(u => u.id);
    if (userIds.length === 0) continue;

    const title = `${batch.length} petugas tidak aktif > ${env.INACTIVITY_DAYS}h`;
    const sample = batch.slice(0, 3).map(p => p.kode).join(', ');
    const body = batch.length === 1
      ? `${batch[0].nama} (${batch[0].kode}) tidak ada kunjungan > ${env.INACTIVITY_DAYS} hari.`
      : `${sample}${batch.length > 3 ? '…' : ''} — tidak ada kunjungan > ${env.INACTIVITY_DAYS} hari.`;

    await enqueueNotification({
      userIds, type: 'petugas.inactivity',
      title, body, severity: 'WARN', link: 'petugas',
    }).catch(() => undefined);

    void pushToUsers(userIds, {
      title, body, link: '/#petugas', tag: `inactivity-${branchId}-${day}`,
    });

    for (const p of batch) {
      await audit({ action: ACTION, target: p.id, meta: { day, branchId } });
      alerted++;
    }
  }

  logger.info({ alerted, day }, 'inactivity_sweep_completed');
  return { ok: true, day, alerted };
}

export function startInactivityWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ days: env.INACTIVITY_DAYS, hour: env.INACTIVITY_CHECK_HOUR },
    'inactivity_worker_started');
  timer = setTimeout(function loop() {
    runInactivitySweep().catch(e =>
      logger.warn({ err: String(e) }, 'inactivity_sweep_failed'));
    timer = setTimeout(loop, 60 * 60 * 1000); // hourly
  }, 90 * 1000);
}

export function stopInactivityWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
