// Archive + prune AuditLog rows older than AUDIT_RETENTION_DAYS.
// Runs once on boot (after a small delay) and then daily.
// Archive format: one gzipped JSONL file per run, named with timestamp range.

import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 5000;

async function archiveOnce() {
  const cutoff = new Date(Date.now() - env.AUDIT_RETENTION_DAYS * ONE_DAY_MS);

  const total = await prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } });
  if (total === 0) {
    logger.debug({ cutoff }, 'audit_retention_nothing_to_archive');
    return;
  }

  fs.mkdirSync(env.AUDIT_ARCHIVE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(env.AUDIT_ARCHIVE_DIR, `audit-${stamp}.jsonl.gz`);
  const tmp = file + '.tmp';

  let archived = 0;
  // Stream the dump so a multi-million-row archive doesn't bloat heap.
  const out = fs.createWriteStream(tmp);

  async function* rows() {
    while (true) {
      const batch = await prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
      });
      if (batch.length === 0) return;
      for (const r of batch) yield JSON.stringify(r) + '\n';
      archived += batch.length;
      // Delete what we just emitted before fetching the next batch — keeps
      // the working set bounded and makes the cursor advance cleanly.
      await prisma.auditLog.deleteMany({
        where: { id: { in: batch.map(b => b.id) } },
      });
    }
  }

  await pipeline(Readable.from(rows()), createGzip(), out);
  fs.renameSync(tmp, file);

  logger.info({ archived, file, cutoffDays: env.AUDIT_RETENTION_DAYS }, 'audit_retention_done');
}

export function startAuditRetention() {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try { await archiveOnce(); }
    catch (err) { logger.error({ err }, 'audit_retention_failed'); }
    if (!stopped) setTimeout(tick, ONE_DAY_MS);
  };
  // Initial delay so we don't compete with startup work.
  setTimeout(tick, 60_000);
  logger.info({ retentionDays: env.AUDIT_RETENTION_DAYS, archiveDir: env.AUDIT_ARCHIVE_DIR }, 'audit_retention_started');
  return () => { stopped = true; };
}
