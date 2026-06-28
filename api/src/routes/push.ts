import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';
import { vapidPublicKey } from '../lib/webPush.js';
import { audit, fromReq } from '../lib/audit.js';

const router = Router();

router.get('/vapid-public', (_req, res) => {
  const key = vapidPublicKey();
  if (!key) return res.status(503).json({ error: 'push_disabled' });
  res.json({ publicKey: key });
});

router.use(requireAuth);

// Dua bentuk subscription body:
//   VAPID (web browser): { endpoint, keys: { p256dh, auth } }
//   FCM (Capacitor APK):  { kind: 'fcm', fcmToken }
// Validasi terpisah supaya field tidak campur aduk; endpoint dipakai
// sebagai unique key apapun jalurnya (FCM token cukup unik per device).
const vapidSubSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().max(255),
    auth: z.string().max(255),
  }),
});
const fcmSubSchema = z.object({
  kind: z.literal('fcm'),
  fcmToken: z.string().min(20).max(2048),
});

router.post('/subscribe', async (req, res) => {
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 255);

  // Coba parse sebagai FCM dulu (lebih distinctive — punya kind literal).
  const fcm = fcmSubSchema.safeParse(req.body);
  if (fcm.success) {
    const { fcmToken } = fcm.data;
    await prisma.pushSubscription.upsert({
      where: { endpoint: fcmToken },
      create: {
        endpoint: fcmToken, kind: 'fcm',
        userId: req.user!.sub, userAgent: ua,
      },
      update: {
        userId: req.user!.sub, userAgent: ua, kind: 'fcm',
        p256dh: null, authKey: null,
      },
    });
    await audit({ action: 'push.subscribe', actorId: req.user!.sub, ...fromReq(req) });
    return res.json({ ok: true });
  }

  const vapid = vapidSubSchema.safeParse(req.body);
  if (!vapid.success) return res.status(400).json({ error: 'bad_request' });
  const { endpoint, keys } = vapid.data;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      endpoint, kind: 'vapid', p256dh: keys.p256dh, authKey: keys.auth,
      userId: req.user!.sub, userAgent: ua,
    },
    update: {
      // Re-bind endpoint to this user (handles a device shared between
      // accounts — old user loses the device, new user owns it).
      userId: req.user!.sub, userAgent: ua, kind: 'vapid',
      p256dh: keys.p256dh, authKey: keys.auth,
    },
  });
  await audit({ action: 'push.subscribe', actorId: req.user!.sub, ...fromReq(req) });
  res.json({ ok: true });
});

router.post('/unsubscribe', async (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : null;
  if (!endpoint) return res.status(400).json({ error: 'bad_request' });
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: req.user!.sub },
  });
  await audit({ action: 'push.unsubscribe', actorId: req.user!.sub, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
