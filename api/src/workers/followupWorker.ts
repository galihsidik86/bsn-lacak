import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { pushToUsers } from '../lib/webPush.js';
import { enqueueNotification } from '../routes/notifications.js';

// CG — auto-followup worker. For every JANJI kunjungan whose tanggal is
// FOLLOWUP_DELAY_HOURS ago (default 24), fire a push to the petugas who
// filed it reminding them to chase the promise. Audit-row markers prevent
// re-firing for the same kunjungan.

const ACTION = 'kunjungan.followup_sent';

let timer: NodeJS.Timeout | null = null;

export async function runFollowupSweep(opts?: { now?: Date; force?: boolean }): Promise<{ sent: number }> {
  const now = opts?.now ?? new Date();
  const delayMs = env.FOLLOWUP_DELAY_HOURS * 60 * 60 * 1000;
  const lookback = new Date(now.getTime() - delayMs - 6 * 60 * 60 * 1000); // 6h grace
  const cutoff = new Date(now.getTime() - delayMs);

  // Candidate JANJI rows. tanggal is the visit time (which could be
  // backdated), so we anchor the followup on `tanggal` rather than
  // `createdAt` — the promise's age is what matters to the petugas.
  const candidates = await prisma.kunjungan.findMany({
    where: {
      hasil: 'JANJI',
      tanggal: { gte: lookback, lte: cutoff },
      archivedAt: null,
    },
    select: {
      id: true, petugasId: true, branchId: true, tanggal: true,
      nasabah: { select: { kode: true, nama: true } },
    },
    take: 200,
  });
  if (candidates.length === 0) return { sent: 0 };

  // Dedup against any audit rows we've written previously for these ids.
  const previouslySentRows = await prisma.auditLog.findMany({
    where: {
      action: ACTION,
      target: { in: candidates.map(c => c.id) },
    },
    select: { target: true },
  });
  const alreadySent = new Set(previouslySentRows.map(r => r.target!).filter(Boolean));

  // Map petugasId → userId so the notification targets the petugas
  // account, not the petugas record directly.
  const petugasIds = [...new Set(candidates.filter(c => !alreadySent.has(c.id)).map(c => c.petugasId))];
  if (petugasIds.length === 0) return { sent: 0 };
  const users = await prisma.user.findMany({
    where: { petugasId: { in: petugasIds } },
    select: { id: true, petugasId: true },
  });
  const userByPetugas = new Map(users.map(u => [u.petugasId!, u.id]));

  let sent = 0;
  for (const k of candidates) {
    if (alreadySent.has(k.id)) continue;
    const userId = userByPetugas.get(k.petugasId);
    if (!userId) continue;

    await enqueueNotification({
      userIds: [userId],
      type: 'kunjungan.followup',
      title: 'Follow-up janji bayar',
      body: `Janji bayar ${k.nasabah.nama} (${k.nasabah.kode}) sudah ${env.FOLLOWUP_DELAY_HOURS}j — cek apakah sudah ditepati.`,
      severity: 'INFO',
      link: 'mobile',
    }).catch(() => undefined);

    void pushToUsers([userId], {
      title: 'Janji bayar perlu ditindaklanjuti',
      body: `${k.nasabah.nama} · ${k.nasabah.kode}`,
      link: '/#mobile',
      tag: `followup-${k.id}`,
    });

    await audit({
      action: ACTION, target: k.id,
      meta: { petugasId: k.petugasId, branchId: k.branchId, tanggal: k.tanggal.toISOString() },
    });
    sent++;
  }

  if (sent > 0) {
    logger.info({ sent }, 'followup_sweep_completed');
  }
  return { sent };
}

export function startFollowupWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({
    delayHours: env.FOLLOWUP_DELAY_HOURS, pollMs: env.FOLLOWUP_POLL_MS,
  }, 'followup_worker_started');
  timer = setTimeout(function loop() {
    runFollowupSweep().catch(e => logger.warn({ err: String(e) }, 'followup_sweep_failed'));
    timer = setTimeout(loop, env.FOLLOWUP_POLL_MS);
  }, 90 * 1000);
}

export function stopFollowupWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
