import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';

// Auto-archive worker (BY). Periodically stamps `archivedAt` on every
// APPROVED/REJECTED kunjungan older than ARCHIVE_AFTER_DAYS so the default
// supervisor list endpoint can skip them. Archived rows still exist for
// analytics + GDPR-style export + audit replay.

let timer: NodeJS.Timeout | null = null;

export async function runArchiveSweep(opts?: { now?: Date }): Promise<{ archived: number }> {
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - env.ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.kunjungan.updateMany({
    where: {
      archivedAt: null,
      reviewStatus: { in: ['APPROVED', 'REJECTED'] },
      tanggal: { lt: cutoff },
    },
    data: { archivedAt: now },
  });

  if (result.count > 0) {
    await audit({
      action: 'kunjungan.archive_sweep',
      meta: { archived: result.count, cutoff: cutoff.toISOString() },
    });
    logger.info({ archived: result.count, cutoff }, 'kunjungan_archive_sweep');
  }
  return { archived: result.count };
}

export function startArchiveWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ retentionDays: env.ARCHIVE_AFTER_DAYS, pollMs: env.ARCHIVE_POLL_MS },
    'archive_worker_started');
  // Defer first run by 2 minutes so server boot stays clean.
  timer = setTimeout(function loop() {
    runArchiveSweep().catch(e => logger.warn({ err: String(e) }, 'archive_sweep_failed'));
    timer = setTimeout(loop, env.ARCHIVE_POLL_MS);
  }, 2 * 60 * 1000);
}

export function stopArchiveWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
