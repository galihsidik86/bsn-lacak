import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { pushToUsers } from '../lib/webPush.js';
import { enqueueNotification } from './notifications.js';

const router = Router();
router.use(requireAuth);

const broadcastSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  severity: z.enum(['INFO', 'WARN', 'CRIT']).default('INFO'),
  // Audience selectors. Defaults to "petugas in caller's branch" — the
  // most common use case (shift briefing). ADMIN can target all branches
  // or specific cabang via x-branch-id override.
  audience: z.enum(['PETUGAS', 'SUPERVISOR', 'ALL']).default('PETUGAS'),
  link: z.string().max(500).optional(),
});

router.post('/broadcast', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const branchId = scopedBranchId(req);

  // Build the role filter from the audience selector.
  const roleFilter: { in: ('PETUGAS' | 'SUPERVISOR' | 'ADMIN')[] } =
    parsed.data.audience === 'ALL' ? { in: ['PETUGAS', 'SUPERVISOR'] }
    : { in: [parsed.data.audience] };

  const recipients = await prisma.user.findMany({
    where: {
      role: roleFilter,
      active: true,
      // Sender shouldn't get their own broadcast back in their bell.
      id: { not: req.user!.sub },
      ...(branchId ? { branchId } : {}),
    },
    select: { id: true },
  });
  if (recipients.length === 0) {
    return res.status(400).json({ error: 'no_recipients' });
  }

  const userIds = recipients.map(r => r.id);
  await enqueueNotification({
    userIds,
    type: 'announcement',
    title: parsed.data.title,
    body: parsed.data.body,
    severity: parsed.data.severity,
    link: parsed.data.link,
  });
  void pushToUsers(userIds, {
    title: parsed.data.title,
    body: parsed.data.body ?? '',
    link: parsed.data.link ? `/#${parsed.data.link}` : '/',
    tag: `announcement-${Date.now()}`,
  });

  await audit({
    action: 'announcement.broadcast', ...fromReq(req),
    meta: {
      title: parsed.data.title, severity: parsed.data.severity,
      audience: parsed.data.audience, recipients: userIds.length,
    },
  });

  res.status(201).json({ ok: true, recipients: userIds.length });
});

export default router;
