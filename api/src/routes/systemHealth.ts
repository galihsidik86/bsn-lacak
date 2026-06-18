import { Router } from 'express';
import os from 'node:os';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { env } from '../env.js';

// CB — admin-only operational health page. Returns one snapshot of every
// signal the operator cares about: DB latency, last-touched timestamps
// for the four sweep workers, pending queue depths, and process uptime.
// Designed for a glance, not for diagnostics — when something looks wrong
// the operator switches to the Audit Log or container logs.

const router = Router();
router.use(requireAuth);
router.use(requireRole('ADMIN'));

router.get('/', async (_req, res) => {
  const t0 = Date.now();
  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
    dbLatencyMs = Date.now() - t0;
  } catch {
    dbOk = false;
  }

  // Worker "freshness" — pull the most recent audit row each worker writes.
  // No row = either worker hasn't run yet OR has nothing to do (cheap +
  // accurate enough; the operator notices a stale timestamp instantly).
  const workerActions = [
    'morning_reminder.sent',
    'closing.email_sent',
    'kunjungan.archive_sweep',
    'sla.pending_breach',
  ] as const;
  const workerRows = await Promise.all(
    workerActions.map(action =>
      prisma.auditLog.findFirst({
        where: { action },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ),
  );
  const workers = workerActions.reduce((acc, a, i) => {
    acc[a] = workerRows[i]?.createdAt?.toISOString() ?? null;
    return acc;
  }, {} as Record<string, string | null>);

  // Queue depths — backlog operators react to.
  const [pendingReviews, pendingWebhooks, deadLetterWebhooks, archivedTotal] = await Promise.all([
    prisma.kunjungan.count({ where: { reviewStatus: 'PENDING' } }),
    prisma.webhookDelivery.count({ where: { status: 'pending' } }),
    prisma.webhookDelivery.count({ where: { status: 'dead_letter' } }),
    prisma.kunjungan.count({ where: { archivedAt: { not: null } } }),
  ]);

  const mem = process.memoryUsage();
  res.json({
    generatedAt: new Date().toISOString(),
    db: { ok: dbOk, latencyMs: dbLatencyMs },
    workers,
    queues: {
      pendingReviews,
      pendingWebhooks,
      deadLetterWebhooks,
      archivedTotal,
    },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      loadAvg1m: os.loadavg()[0],
    },
    env: {
      nodeEnv: env.NODE_ENV,
      archiveAfterDays: env.ARCHIVE_AFTER_DAYS,
      slaPendingHours: env.SLA_PENDING_HOURS,
      morningReminderEnabled: env.MORNING_REMINDER_ENABLED,
    },
  });
});

export default router;
