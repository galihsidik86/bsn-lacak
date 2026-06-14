import webpush from 'web-push';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from './logger.js';

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return false;
  webpush.setVapidDetails(env.VAPID_CONTACT, env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body?: string;
  link?: string;
  tag?: string;
}

// Fan out a push payload to every active subscription for the given users.
// Drops subscriptions that the push gateway rejects with 404/410 (expired).
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (!ensureConfigured()) {
    logger.debug('web_push_skipped_no_vapid');
    return { sent: 0, pruned: 0 };
  }
  if (userIds.length === 0) return { sent: 0, pruned: 0 };
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  let pruned = 0;
  const expired: string[] = [];
  const json = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.authKey },
      }, json);
      sent++;
    } catch (e: any) {
      const status = e?.statusCode;
      if (status === 404 || status === 410) {
        expired.push(s.id);
      } else {
        logger.warn({ err: String(e), status, sub: s.id }, 'web_push_failed');
      }
    }
  }));

  if (expired.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expired } } });
    pruned = expired.length;
  }
  return { sent, pruned };
}

export function vapidPublicKey(): string | null {
  return env.VAPID_PUBLIC ?? null;
}
