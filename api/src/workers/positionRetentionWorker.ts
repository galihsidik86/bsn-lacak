import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';

// Position retention sweep — hapus PetugasPosition yang lebih tua dari
// POSITION_RETENTION_DAYS. Trail supervisor untuk audit lapangan
// realistis butuh lookback 1-3 bulan; > 90 hari cuma menghabiskan disk
// tanpa nilai bisnis. Kalau butuh trail lebih lama untuk case spesifik
// (mis. investigasi fraud lawas), dump manual dulu sebelum sweep atau
// naikkan retention days sementara di env.
//
// Dijalankan sekali per hari saat off-peak (default jam 3 pagi WIB —
// dihitung dari boot time supaya tidak butuh sinkronisasi wall-clock).
// Batch delete 10k row per iterasi supaya tidak lock table lama pada
// data set besar.

const ACTION = 'position.retention_sweep';
const DELETE_BATCH_SIZE = 10_000;

let timer: NodeJS.Timeout | null = null;

export async function runPositionRetentionSweep(opts?: { now?: Date }):
  Promise<{ ok: boolean; deleted: number; retentionDays: number }>
{
  const now = opts?.now ?? new Date();
  const retentionDays = env.POSITION_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let totalDeleted = 0;
  // Batch loop — deleteMany di Postgres lock row-level, tapi index scan
  // pada 100k+ row bisa freeze table beberapa detik. Chunk 10k = sub-detik.
  while (true) {
    const oldIds = await prisma.petugasPosition.findMany({
      where: { recordedAt: { lt: cutoff } },
      select: { id: true },
      take: DELETE_BATCH_SIZE,
      orderBy: { recordedAt: 'asc' },
    });
    if (oldIds.length === 0) break;
    const result = await prisma.petugasPosition.deleteMany({
      where: { id: { in: oldIds.map(r => r.id) } },
    });
    totalDeleted += result.count;
    // Kalau batch penuh, ada kemungkinan masih ada sisa — loop lagi.
    // Kalau tidak penuh, tidak ada lagi row yang match.
    if (oldIds.length < DELETE_BATCH_SIZE) break;
  }

  if (totalDeleted > 0) {
    await audit({
      action: ACTION, target: null,
      actor: null, actorId: null, ip: null, userAgent: null,
      meta: { deleted: totalDeleted, cutoffIso: cutoff.toISOString(), retentionDays },
    });
  }
  logger.info({ deleted: totalDeleted, retentionDays, cutoffIso: cutoff.toISOString() },
    'position_retention_sweep_completed');
  return { ok: true, deleted: totalDeleted, retentionDays };
}

export function startPositionRetentionWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  const everyMs = 24 * 60 * 60 * 1000; // sekali sehari
  logger.info(
    { retentionDays: env.POSITION_RETENTION_DAYS, everyHours: 24 },
    'position_retention_worker_started',
  );
  // Delay pertama 5 menit setelah boot — bukan langsung supaya boot
  // sequence cepat dan tidak berbenturan dengan seed/migration.
  timer = setTimeout(function loop() {
    runPositionRetentionSweep().catch(e =>
      logger.warn({ err: String(e) }, 'position_retention_sweep_failed'));
    timer = setTimeout(loop, everyMs);
  }, 5 * 60_000);
}

export function stopPositionRetentionWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
