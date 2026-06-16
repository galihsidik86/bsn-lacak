// Audit log viewer. Non-ADMIN users see only events done by users in their
// own branch — keeps tenant isolation symmetric with the rest of the API.

import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { env } from '../env.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('SUPERVISOR', 'ADMIN'));

const query = z.object({
  action: z.string().optional(),
  actor: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(), // AuditLog.id of last item from previous page
});

router.get('/', async (req, res) => {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const { action, actor, since, until, limit, cursor } = parsed.data;

  // Scope to branch: a SUPERVISOR sees only audit entries authored by users
  // who belong to their branch. The join uses actorId — anonymous (no actor)
  // entries like failed logins are hidden from non-ADMIN views.
  const branchId = scopedBranchId(req);
  const actorBranchFilter = branchId
    ? { actorId: { in: await scopedActorIds(branchId) } }
    : {};

  const rows = await prisma.auditLog.findMany({
    where: {
      ...actorBranchFilter,
      ...(action ? { action: { contains: action } } : {}),
      ...(actor ? { actor: { contains: actor, mode: 'insensitive' as const } } : {}),
      ...(since || until
        ? { createdAt: {
            ...(since ? { gte: new Date(since) } : {}),
            ...(until ? { lte: new Date(until) } : {}),
          } }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1, // peek one extra to know if there's a next page
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  res.json({
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  });
});

router.get('/actions', async (req, res) => {
  // For the filter dropdown — distinct action strings the requester can see.
  const branchId = scopedBranchId(req);
  const where = branchId ? { actorId: { in: await scopedActorIds(branchId) } } : {};
  const rows = await prisma.auditLog.groupBy({
    by: ['action'],
    where,
    orderBy: { action: 'asc' },
    take: 200,
  });
  res.json(rows.map(r => r.action));
});

async function scopedActorIds(branchId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { branchId },
    select: { id: true },
  });
  return users.map(u => u.id);
}

// ---- Archive (ADMIN-only) -----------------------------------------------
//
// audit retention worker archives old rows to JSONL files under
// AUDIT_ARCHIVE_DIR. ADMIN can list + read them via the UI without
// SSH-ing into the host. Filenames are validated to live inside the
// archive dir — never trust client-supplied paths.

function archiveDir(): string {
  return path.resolve(env.AUDIT_ARCHIVE_DIR);
}

function isSafeArchiveName(name: string): boolean {
  // Restrict to the YYYY-MM-DD pattern we generate, optionally .gz.
  return /^audit-\d{4}-\d{2}-\d{2}\.(jsonl|jsonl\.gz)$/.test(name);
}

router.get('/archive', requireRole('ADMIN'), async (_req, res) => {
  const dir = archiveDir();
  if (!fs.existsSync(dir)) return res.json({ dir, files: [] });
  const entries = await fs.promises.readdir(dir);
  const files = await Promise.all(
    entries.filter(isSafeArchiveName).map(async (name) => {
      const stat = await fs.promises.stat(path.join(dir, name)).catch(() => null);
      return stat ? { name, size: stat.size, mtime: stat.mtime } : null;
    }),
  );
  res.json({
    dir,
    files: files
      .filter((f): f is { name: string; size: number; mtime: Date } => f !== null)
      .sort((a, b) => b.name.localeCompare(a.name)),
  });
});

router.get('/archive/:name', requireRole('ADMIN'), async (req, res) => {
  const name = String(req.params.name);
  if (!isSafeArchiveName(name)) return res.status(400).json({ error: 'bad_name' });
  const file = path.join(archiveDir(), name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not_found' });

  // Cap response to avoid blowing up the browser with multi-MB JSONL.
  const limitParam = Number.parseInt(String(req.query.limit ?? '500'), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 5000 ? limitParam : 500;

  const raw = await fs.promises.readFile(file);
  let text: string;
  try {
    text = name.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');
  } catch {
    return res.status(500).json({ error: 'decompress_failed' });
  }

  const lines = text.split('\n').filter(l => l.length > 0);
  const items = lines.slice(0, limit).map((l, i) => {
    try { return JSON.parse(l); }
    catch { return { _parseError: true, line: i, raw: l.slice(0, 500) }; }
  });
  res.json({ file: name, totalLines: lines.length, returned: items.length, items });
});

export default router;
