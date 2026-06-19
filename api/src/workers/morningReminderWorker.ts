import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { pushToUsers } from '../lib/webPush.js';
import { enqueueNotification } from '../routes/notifications.js';
import { isWorkingDay, getHolidayOn } from '../lib/holidays.js';
import { petugasOnLeaveOn } from '../lib/leaveCheck.js';

// Once per hour, check whether (today is a weekday) AND (now.getHours() ==
// MORNING_REMINDER_HOUR) AND (we haven't already fired today). When all
// three match, push a "selamat pagi" reminder to every active PETUGAS with
// a notification record + web push subscription, then write an AuditLog
// entry that acts as the dedup marker.

let timer: NodeJS.Timeout | null = null;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function alreadySent(day: string): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: { action: 'morning_reminder.sent', meta: { path: ['day'], equals: day } },
    select: { id: true },
  });
  return !!row;
}

export async function runMorningReminderSweep(opts?: {
  now?: Date; force?: boolean;
}): Promise<{ ok: boolean; reason?: string; recipients?: number; day?: string }> {
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  const day = localDateKey(now);

  if (!force) {
    if (!env.MORNING_REMINDER_ENABLED) return { ok: false, reason: 'disabled' };
    if (now.getHours() !== env.MORNING_REMINDER_HOUR) return { ok: false, reason: 'not_hour' };
    // Skip when not a working day — covers weekend AND Indonesian national
    // holidays from the static calendar.
    if (!isWorkingDay(now)) {
      const h = getHolidayOn(now);
      return { ok: false, reason: h ? 'holiday' : 'weekend', day };
    }
    if (await alreadySent(day)) return { ok: false, reason: 'already_sent', day };
  }

  const petugas = await prisma.user.findMany({
    where: { role: 'PETUGAS', active: true },
    select: { id: true, petugasId: true },
  });
  // CS — skip petugas who are on approved leave today.
  const onLeave = await petugasOnLeaveOn(now);
  const userIds = petugas
    .filter(p => !p.petugasId || !onLeave.has(p.petugasId))
    .map(p => p.id);
  if (userIds.length === 0) return { ok: false, reason: 'no_recipients', day };

  const title = 'Selamat pagi 👋';
  const body = 'Mulai hari dengan klik clock-in, lalu buka tab Rute untuk daftar kunjungan.';

  await enqueueNotification({
    userIds, type: 'morning.reminder',
    title, body, severity: 'INFO', link: 'mobile',
  }).catch(() => undefined);

  const pushResult = await pushToUsers(userIds, {
    title, body,
    link: '/#mobile', tag: `morning-${day}`,
  }).catch(() => ({ sent: 0, pruned: 0 }));

  await audit({
    action: 'morning_reminder.sent',
    meta: { day, recipients: userIds.length, pushSent: pushResult.sent },
  });
  logger.info({ day, recipients: userIds.length, pushSent: pushResult.sent }, 'morning_reminder_sent');
  return { ok: true, day, recipients: userIds.length };
}

export function startMorningReminderWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (!env.MORNING_REMINDER_ENABLED) return;
  if (timer) return;
  logger.info({ hour: env.MORNING_REMINDER_HOUR }, 'morning_reminder_worker_started');
  const tick = () => {
    runMorningReminderSweep().catch(e =>
      logger.warn({ err: String(e) }, 'morning_reminder_sweep_failed'));
  };
  // First tick after 60s so boot is unblocked, then hourly.
  timer = setTimeout(function loop() {
    tick();
    timer = setTimeout(loop, 60 * 60 * 1000);
  }, 60 * 1000);
}

export function stopMorningReminderWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
