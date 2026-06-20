import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';
import { isWorkingDay, getHolidayOn } from '../lib/holidays.js';

// DW — contract expiry alert. Daily at CONTRACT_EXPIRY_HOUR. For each
// active nasabah whose kontrakMulai is set, compute kontrakEnd =
// kontrakMulai + tenor*30 days (approximation, banks use 30/30 anyway).
// If kontrakEnd is between today and today + CONTRACT_EXPIRY_DAYS, alert
// the branch's supervisors so they can plan renew/pelunasan.
//
// Per-nasabah dedup keyed on the audit log target so re-runs on the same
// day no-op.

const ACTION = 'nasabah.contract_expiry_alerted';

let timer: NodeJS.Timeout | null = null;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addMonths(d: Date, m: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + m);
  return r;
}

export async function runContractExpirySweep(opts?: { now?: Date; force?: boolean }):
  Promise<{ ok: boolean; reason?: string; alerted?: number; day?: string }>
{
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  const day = dateKey(now);

  if (!force && now.getHours() !== env.CONTRACT_EXPIRY_HOUR) {
    return { ok: false, reason: 'not_hour' };
  }
  if (!force && !isWorkingDay(now)) {
    const h = getHolidayOn(now);
    return { ok: false, reason: h ? `holiday:${h.name}` : 'weekend' };
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const horizon = new Date(startOfToday.getTime() + env.CONTRACT_EXPIRY_DAYS * 86400_000);

  const candidates = await prisma.nasabah.findMany({
    where: { active: true, kontrakMulai: { not: null } },
    select: {
      id: true, kode: true, nama: true, tenor: true,
      kontrakMulai: true, branchId: true,
    },
  });

  const expiring = candidates.filter(n => {
    if (!n.kontrakMulai) return false;
    const end = addMonths(n.kontrakMulai, n.tenor);
    return end >= startOfToday && end <= horizon;
  });
  if (expiring.length === 0) return { ok: true, alerted: 0, day };

  const recent = await prisma.auditLog.findMany({
    where: {
      action: ACTION,
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
    },
    select: { target: true },
  });
  const already = new Set(recent.map(r => r.target!).filter(Boolean));

  // Group per branch so supervisors get one summary.
  const perBranch = new Map<string, typeof expiring>();
  for (const n of expiring) {
    if (already.has(n.id)) continue;
    const arr = perBranch.get(n.branchId) ?? [];
    arr.push(n);
    perBranch.set(n.branchId, arr);
  }
  if (perBranch.size === 0) return { ok: true, alerted: 0, day };

  let alerted = 0;
  for (const [branchId, rows] of perBranch) {
    const supervisors = await prisma.user.findMany({
      where: { role: 'SUPERVISOR', branchId, active: true },
      select: { id: true },
    });
    if (supervisors.length === 0) continue;
    const userIds = supervisors.map(u => u.id);
    const sample = rows.slice(0, 5).map(r => r.kode).join(', ');
    const title = rows.length === 1
      ? `Kontrak ${rows[0].kode} ekspirasi < ${env.CONTRACT_EXPIRY_DAYS} hari`
      : `${rows.length} kontrak ekspirasi < ${env.CONTRACT_EXPIRY_DAYS} hari`;
    const body = rows.length === 1
      ? `${rows[0].nama} (${rows[0].kode}) — perlu follow-up renew / pelunasan.`
      : `${sample}${rows.length > 5 ? '…' : ''} — perlu follow-up renew / pelunasan.`;

    await enqueueNotification({
      userIds, type: 'nasabah.contract_expiry',
      title, body, severity: 'WARN', link: 'nasabah',
    }).catch(() => undefined);

    for (const n of rows) {
      await audit({ action: ACTION, target: n.id, meta: { day, branchId } });
      alerted++;
    }
  }

  if (alerted > 0) logger.info({ alerted, day }, 'contract_expiry_sweep_completed');
  return { ok: true, day, alerted };
}

export function startContractExpiryWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ hour: env.CONTRACT_EXPIRY_HOUR, days: env.CONTRACT_EXPIRY_DAYS },
    'contract_expiry_worker_started');
  timer = setTimeout(function loop() {
    runContractExpirySweep().catch(e =>
      logger.warn({ err: String(e) }, 'contract_expiry_sweep_failed'));
    timer = setTimeout(loop, 60 * 60 * 1000);
  }, 110 * 1000);
}

export function stopContractExpiryWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
