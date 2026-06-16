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

// Map fine-grained notification types to the coarse preference categories
// users see in the Settings toggle list. New types default to true if not
// mapped — opt-in is the safer default for un-categorized events.
const PREF_CATEGORY: Record<string, string> = {
  'kunjungan.flagged': 'flagged',
  'kunjungan.approved': 'reviewResult',
  'kunjungan.rejected': 'reviewResult',
  'sla.pending_breach': 'sla',
  'announcement': 'announcement',
  'nasabah.reassigned_to_you': 'assignment',
};

export async function enqueueNotification(input: z.infer<typeof enqueueSchema>) {
  const parsed = enqueueSchema.parse(input);
  const category = PREF_CATEGORY[parsed.type] ?? null;

  // Filter out users who have opted out of this category. The notifPrefs
  // JSON column is treated as opt-out: explicit `false` skips, anything
  // else (null, missing key, true) sends.
  let userIds = parsed.userIds;
  if (category) {
    const users = await prisma.user.findMany({
      where: { id: { in: parsed.userIds } },
      select: { id: true, notifPrefs: true },
    });
    userIds = users
      .filter(u => {
        const prefs = u.notifPrefs as Record<string, boolean> | null | undefined;
        return prefs?.[category] !== false;
      })
      .map(u => u.id);
  }
  if (userIds.length === 0) return [];

  const rows = await prisma.$transaction(
    userIds.map(userId =>
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

// ---- Per-user notification preferences ----------------------------------

const PREF_CATEGORIES = [
  'flagged', 'reviewResult', 'sla', 'announcement', 'assignment',
] as const;

router.get('/prefs', async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { notifPrefs: true },
  });
  const prefs = (u?.notifPrefs as Record<string, boolean> | null) ?? {};
  // Hydrate with defaults so the UI doesn't need to know the category set.
  const out: Record<string, boolean> = {};
  for (const c of PREF_CATEGORIES) out[c] = prefs[c] !== false;
  res.json(out);
});

const prefsSchema = z.object({
  flagged: z.boolean().optional(),
  reviewResult: z.boolean().optional(),
  sla: z.boolean().optional(),
  announcement: z.boolean().optional(),
  assignment: z.boolean().optional(),
});

router.patch('/prefs', async (req, res) => {
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const current = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { notifPrefs: true },
  });
  const merged = { ...(current?.notifPrefs as Record<string, boolean> | null ?? {}), ...parsed.data };
  await prisma.user.update({
    where: { id: req.user!.sub },
    data: { notifPrefs: merged },
  });
  res.json(merged);
});

export default router;
