import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { monthlyClosing, toClosingCsv } from '../lib/analytics.js';
import { emailGateway } from '../lib/emailGateway.js';

// Closing email: once per hour, check whether (today === CLOSING_EMAIL_DAY)
// and (now.getHours() === CLOSING_EMAIL_HOUR). When both match and we haven't
// already fired for this month, pull the previous month's closing rows, build
// the CSV, and email every ADMIN that has an email on file.
//
// We persist the "last sent month" via a single AuditLog row (action =
// 'closing.email_sent', meta.month = 'YYYY-MM') so worker restarts don't
// duplicate sends.

let timer: NodeJS.Timeout | null = null;

function previousMonth(now: Date): { year: number; month: number } {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11 → previous month
  if (m === 0) return { year: y - 1, month: 12 };
  return { year: y, month: m };
}

async function alreadySent(year: number, month: number): Promise<boolean> {
  const tag = `${year}-${String(month).padStart(2, '0')}`;
  const row = await prisma.auditLog.findFirst({
    where: { action: 'closing.email_sent', meta: { path: ['month'], equals: tag } },
    select: { id: true },
  });
  return !!row;
}

export async function runClosingEmailSweep(opts?: { now?: Date; force?: boolean }): Promise<{
  ok: boolean;
  reason?: string;
  recipients?: number;
  month?: string;
}> {
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;

  if (!force) {
    if (now.getDate() !== env.CLOSING_EMAIL_DAY) return { ok: false, reason: 'not_day' };
    if (now.getHours() !== env.CLOSING_EMAIL_HOUR) return { ok: false, reason: 'not_hour' };
  }

  const { year, month } = previousMonth(now);
  const tag = `${year}-${String(month).padStart(2, '0')}`;
  if (!force && await alreadySent(year, month)) {
    return { ok: false, reason: 'already_sent', month: tag };
  }

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', active: true, email: { not: null } },
    select: { id: true, email: true },
  });
  const recipients = admins.map(a => a.email).filter((e): e is string => !!e);
  if (recipients.length === 0) {
    return { ok: false, reason: 'no_recipients', month: tag };
  }

  const rows = await monthlyClosing({ year, month });
  const csv = toClosingCsv(rows);
  const filename = `closing-${tag}.csv`;

  const result = await emailGateway.send({
    to: recipients,
    subject: `BSN Lacak — Closing ${tag}`,
    text: `Terlampir rekap closing bulan ${tag}.\n\nBaris: ${rows.length}\nFile: ${filename}\n\n— Sistem BSN Lacak`,
    attachments: [{ filename, content: Buffer.from(csv, 'utf-8'), contentType: 'text/csv; charset=utf-8' }],
  });

  if (!result.ok) {
    logger.warn({ err: result.error, month: tag }, 'closing_email_send_failed');
    return { ok: false, reason: 'send_failed', month: tag, recipients: recipients.length };
  }

  await audit({
    action: 'closing.email_sent',
    meta: { month: tag, recipients: recipients.length, rows: rows.length, providerMessageId: result.providerMessageId },
  });
  logger.info({ month: tag, recipients: recipients.length, rows: rows.length }, 'closing_email_sent');
  return { ok: true, month: tag, recipients: recipients.length };
}

export function startClosingEmailWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({
    day: env.CLOSING_EMAIL_DAY, hour: env.CLOSING_EMAIL_HOUR, provider: env.EMAIL_PROVIDER,
  }, 'closing_email_worker_started');
  const tick = () => {
    runClosingEmailSweep().catch(e => logger.warn({ err: String(e) }, 'closing_email_sweep_failed'));
  };
  // First tick after 1 minute so boot isn't blocked, then hourly.
  timer = setTimeout(function loop() {
    tick();
    timer = setTimeout(loop, 60 * 60 * 1000);
  }, 60 * 1000);
}

export function stopClosingEmailWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
