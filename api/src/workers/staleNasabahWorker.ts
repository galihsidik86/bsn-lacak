import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';
import { pushToUsers } from '../lib/webPush.js';
import { petugasOnLeaveOn } from '../lib/leaveCheck.js';

// DF — stale-nasabah alert. Daily at STALE_NASABAH_HOUR. For each active
// nasabah whose latest kunjungan is older than STALE_NASABAH_DAYS (or
// none ever), ping the owning petugas. Group per petugas so we send one
// summary notification rather than N individual ones. Skips petugas on
// approved leave today since their substitute will handle it (see DG).

const ACTION = 'nasabah.stale_alerted';

let timer: NodeJS.Timeout | null = null;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function runStaleNasabahSweep(opts?: { now?: Date; force?: boolean }):
  Promise<{ ok: boolean; reason?: string; alerted?: number; day?: string }>
{
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  const day = dateKey(now);

  if (!force && now.getHours() !== env.STALE_NASABAH_HOUR) {
    return { ok: false, reason: 'not_hour' };
  }

  const cutoff = new Date(now.getTime() - env.STALE_NASABAH_DAYS * 24 * 60 * 60_000);

  const stale = await prisma.nasabah.findMany({
    where: {
      active: true,
      // DQ — supervisor explicitly snoozed: skip the daily alert.
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    select: {
      id: true, kode: true, nama: true, petugasId: true,
      kunjungan: { orderBy: { tanggal: 'desc' }, take: 1, select: { tanggal: true } },
    },
  });
  const onLeave = await petugasOnLeaveOn(now);
  const stalePerPetugas = new Map<string, Array<{ kode: string; nama: string; id: string }>>();
  for (const n of stale) {
    if (onLeave.has(n.petugasId)) continue;
    const latest = n.kunjungan[0]?.tanggal;
    if (latest && latest >= cutoff) continue;
    const arr = stalePerPetugas.get(n.petugasId) ?? [];
    arr.push({ kode: n.kode, nama: n.nama, id: n.id });
    stalePerPetugas.set(n.petugasId, arr);
  }
  if (stalePerPetugas.size === 0) return { ok: true, alerted: 0, day };

  // Resolve petugas → user.
  const petugasIds = [...stalePerPetugas.keys()];
  const users = await prisma.user.findMany({
    where: { petugasId: { in: petugasIds } },
    select: { id: true, petugasId: true },
  });
  const userByPet = new Map(users.map(u => [u.petugasId!, u.id]));

  // Dedup against audit rows from earlier today.
  const recent = await prisma.auditLog.findMany({
    where: {
      action: ACTION,
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
    },
    select: { target: true },
  });
  const alreadyAlerted = new Set(recent.map(r => r.target!).filter(Boolean));

  let alerted = 0;
  for (const [petugasId, rows] of stalePerPetugas) {
    if (alreadyAlerted.has(petugasId)) continue;
    const userId = userByPet.get(petugasId);
    if (!userId) continue;
    const sample = rows.slice(0, 3).map(r => r.kode).join(', ');
    const title = `${rows.length} nasabah belum dikunjungi > ${env.STALE_NASABAH_DAYS}h`;
    const body = rows.length === 1
      ? `${rows[0].nama} (${rows[0].kode}) — sudah > ${env.STALE_NASABAH_DAYS} hari tanpa kunjungan.`
      : `${sample}${rows.length > 3 ? '…' : ''} — sudah > ${env.STALE_NASABAH_DAYS} hari tanpa kunjungan.`;

    await enqueueNotification({
      userIds: [userId], type: 'nasabah.stale',
      title, body, severity: 'WARN', link: 'mobile',
    }).catch(() => undefined);

    void pushToUsers([userId], {
      title, body, link: '/#mobile', tag: `stale-${petugasId}-${day}`,
    });

    await audit({
      action: ACTION, target: petugasId,
      meta: { day, count: rows.length },
    });
    alerted++;
  }

  if (alerted > 0) logger.info({ alerted, day }, 'stale_nasabah_sweep_completed');
  return { ok: true, day, alerted };
}

export function startStaleNasabahWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ days: env.STALE_NASABAH_DAYS, hour: env.STALE_NASABAH_HOUR },
    'stale_nasabah_worker_started');
  timer = setTimeout(function loop() {
    runStaleNasabahSweep().catch(e =>
      logger.warn({ err: String(e) }, 'stale_nasabah_sweep_failed'));
    timer = setTimeout(loop, 60 * 60 * 1000);
  }, 2 * 60 * 1000);
}

export function stopStaleNasabahWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
