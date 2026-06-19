import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';
import { pushToUsers } from '../lib/webPush.js';

// DM — daily JANJI reminder. For each JANJI whose deadline (tanggal +
// JANJI_FOLLOWUP_HOURS) falls in [now, now+24h] AND has no follow-up
// kunjungan yet, push one notification to the owning petugas. Dedup
// per (petugasId, day) via the audit log so re-runs don't spam.

const ACTION = 'janji.reminder_sent';
const FOLLOWUP_HOURS = 72;
const WINDOW_HOURS = 24;

let timer: NodeJS.Timeout | null = null;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function runJanjiReminderSweep(opts?: { now?: Date; force?: boolean }):
  Promise<{ ok: boolean; reason?: string; alerted?: number; day?: string }>
{
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  const day = dateKey(now);

  if (!force && now.getHours() !== env.JANJI_REMINDER_HOUR) {
    return { ok: false, reason: 'not_hour' };
  }

  // JANJIs whose deadline lies in [now, now+24h].
  // deadline = tanggal + FOLLOWUP_HOURS * 3600s. Rearrange: tanggal in
  // [now - FOLLOWUP_HOURS, now - FOLLOWUP_HOURS + WINDOW_HOURS].
  const winStart = new Date(now.getTime() - FOLLOWUP_HOURS * 3600_000);
  const winEnd = new Date(winStart.getTime() + WINDOW_HOURS * 3600_000);

  const janjis = await prisma.kunjungan.findMany({
    where: { hasil: 'JANJI', tanggal: { gte: winStart, lt: winEnd } },
    select: {
      id: true, nasabahId: true, petugasId: true, tanggal: true,
      nasabah: { select: { kode: true, nama: true } },
    },
  });
  if (janjis.length === 0) return { ok: true, alerted: 0, day };

  // Filter out those that already have a follow-up kunjungan after the
  // JANJI (and before deadline). Same per-nasabah probe used by DJ.
  const nasabahIds = [...new Set(janjis.map(j => j.nasabahId))];
  const followups = await prisma.kunjungan.findMany({
    where: { nasabahId: { in: nasabahIds }, tanggal: { gt: winStart } },
    select: { id: true, nasabahId: true, tanggal: true },
  });
  const byNas = new Map<string, Array<{ id: string; tanggal: Date }>>();
  for (const f of followups) {
    const arr = byNas.get(f.nasabahId) ?? [];
    arr.push({ id: f.id, tanggal: f.tanggal });
    byNas.set(f.nasabahId, arr);
  }

  const open = janjis.filter(j => {
    const deadline = new Date(j.tanggal.getTime() + FOLLOWUP_HOURS * 3600_000);
    const cands = byNas.get(j.nasabahId) ?? [];
    return !cands.find(c => c.id !== j.id && c.tanggal > j.tanggal && c.tanggal <= deadline);
  });
  if (open.length === 0) return { ok: true, alerted: 0, day };

  // Group per petugas so they get one summary push, not one per JANJI.
  const perPetugas = new Map<string, typeof open>();
  for (const j of open) {
    const arr = perPetugas.get(j.petugasId) ?? [];
    arr.push(j);
    perPetugas.set(j.petugasId, arr);
  }

  const petugasIds = [...perPetugas.keys()];
  const users = await prisma.user.findMany({
    where: { petugasId: { in: petugasIds } },
    select: { id: true, petugasId: true },
  });
  const userByPet = new Map(users.map(u => [u.petugasId!, u.id]));

  // Dedup against earlier today's run.
  const recent = await prisma.auditLog.findMany({
    where: {
      action: ACTION,
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
    },
    select: { target: true },
  });
  const already = new Set(recent.map(r => r.target!).filter(Boolean));

  let alerted = 0;
  for (const [petugasId, rows] of perPetugas) {
    if (already.has(petugasId)) continue;
    const userId = userByPet.get(petugasId);
    if (!userId) continue;
    const sample = rows.slice(0, 3).map(r => r.nasabah.kode).join(', ');
    const title = `${rows.length} janji jatuh tempo hari ini`;
    const body = rows.length === 1
      ? `${rows[0].nasabah.nama} (${rows[0].nasabah.kode}) — deadline janji hari ini.`
      : `${sample}${rows.length > 3 ? '…' : ''} — deadline janji hari ini.`;

    await enqueueNotification({
      userIds: [userId], type: 'janji.deadline',
      title, body, severity: 'WARN', link: 'mobile',
    }).catch(() => undefined);

    void pushToUsers([userId], {
      title, body, link: '/#mobile', tag: `janji-${petugasId}-${day}`,
    });

    await audit({ action: ACTION, target: petugasId, meta: { day, count: rows.length } });
    alerted++;
  }

  if (alerted > 0) logger.info({ alerted, day }, 'janji_reminder_sweep_completed');
  return { ok: true, day, alerted };
}

export function startJanjiReminderWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ hour: env.JANJI_REMINDER_HOUR }, 'janji_reminder_worker_started');
  timer = setTimeout(function loop() {
    runJanjiReminderSweep().catch(e =>
      logger.warn({ err: String(e) }, 'janji_reminder_sweep_failed'));
    timer = setTimeout(loop, 60 * 60 * 1000);
  }, 75 * 1000);
}

export function stopJanjiReminderWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
