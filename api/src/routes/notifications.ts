import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';
import { bus } from '../lib/events.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const onlyUnread = req.query.unread === '1';
  const severityParam = typeof req.query.severity === 'string' ? req.query.severity : null;
  const severity = severityParam && ['INFO', 'WARN', 'CRIT'].includes(severityParam)
    ? severityParam as 'INFO' | 'WARN' | 'CRIT' : null;
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length > 0
    ? req.query.cursor : null;
  const limitNum = Number.parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(limitNum) && limitNum > 0 && limitNum <= 200 ? limitNum : 50;

  const list = await prisma.notification.findMany({
    where: {
      userId: req.user!.sub,
      ...(onlyUnread ? { readAt: null } : {}),
      ...(severity ? { severity } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,                       // +1 lookahead for nextCursor
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = list.length > limit;
  const items = hasMore ? list.slice(0, limit) : list;

  const unreadCount = await prisma.notification.count({
    where: { userId: req.user!.sub, readAt: null },
  });
  res.json({
    items, unreadCount,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  });
});

router.patch('/:id/read', async (req, res) => {
  const id = String(req.params.id);
  const n = await prisma.notification.findFirst({
    where: { id, userId: req.user!.sub },
  });
  if (!n) return res.status(404).json({ error: 'not_found' });
  if (!n.readAt) {
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }
  res.json({ ok: true });
});

router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.sub, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

// Helper for other routes/workers to fan out a notification. Persists it and
// pushes via SSE in one step so the bell badge updates without a refetch.
const enqueueSchema = z.object({
  userIds: z.array(z.string()).min(1).max(2000),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  severity: z.enum(['INFO', 'WARN', 'CRIT']).default('INFO'),
  link: z.string().max(500).optional(),
});

export async function enqueueNotification(input: z.infer<typeof enqueueSchema>) {
  const parsed = enqueueSchema.parse(input);
  const rows = await prisma.$transaction(
    parsed.userIds.map(userId =>
      prisma.notification.create({
        data: {
          userId,
          type: parsed.type,
          title: parsed.title,
          body: parsed.body ?? null,
          severity: parsed.severity,
          link: parsed.link ?? null,
        },
      })
    )
  );
  for (const r of rows) {
    bus.publish('notification.new', {
      id: r.id, type: r.type, title: r.title, body: r.body,
      severity: r.severity, link: r.link, createdAt: r.createdAt,
    }, [r.userId]);
  }
  return rows;
}

export default router;
