import webpush from 'web-push';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from './logger.js';
import { fcmSend } from './fcm.js';

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
// Split per `kind`: VAPID via web-push lib, FCM via firebase-admin. Expired
// tokens (404/410 untuk VAPID, registration-token-not-registered untuk
// FCM) di-prune supaya tidak mengakumulasi sampah.
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  if (userIds.length === 0) return { sent: 0, pruned: 0 };
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  const expiredIds: string[] = [];

  // --- VAPID (Web Push) ---
  const vapidSubs = subs.filter(s => s.kind === 'vapid' && s.p256dh && s.authKey);
  if (vapidSubs.length > 0 && ensureConfigured()) {
    const json = JSON.stringify(payload);
    await Promise.all(vapidSubs.map(async (s) => {
      try {
        await webpush.sendNotification({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh!, auth: s.authKey! },
        }, json);
        sent++;
      } catch (e: any) {
        const status = e?.statusCode;
        if (status === 404 || status === 410) {
          expiredIds.push(s.id);
        } else {
          logger.warn({ err: String(e), status, sub: s.id }, 'web_push_failed');
        }
      }
    }));
  } else if (vapidSubs.length > 0) {
    logger.debug('web_push_skipped_no_vapid');
  }

  // --- FCM (Capacitor APK native) ---
  const fcmSubs = subs.filter(s => s.kind === 'fcm');
  if (fcmSubs.length > 0) {
    const tokens = fcmSubs.map(s => s.endpoint);
    const result = await fcmSend(tokens, payload);
    sent += result.sent;
    if (result.invalidTokens.length > 0) {
      // Map token kembali ke subscription id supaya prune by id konsisten.
      const tokenToId = new Map(fcmSubs.map(s => [s.endpoint, s.id] as const));
      for (const t of result.invalidTokens) {
        const id = tokenToId.get(t);
        if (id) expiredIds.push(id);
      }
    }
  }

  let pruned = 0;
  if (expiredIds.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
    pruned = expiredIds.length;
  }
  return { sent, pruned };
}

export function vapidPublicKey(): string | null {
  return env.VAPID_PUBLIC ?? null;
}
