// Audit log viewer. Non-ADMIN users see only events done by users in their
// own branch — keeps tenant isolation symmetric with the rest of the API.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';

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

export default router;
