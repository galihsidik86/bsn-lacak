// Firebase Cloud Messaging sender — jalur push notification untuk
// Capacitor APK native. Web Push (VAPID) tetap dipakai untuk browser
// PWA; tabel PushSubscription disambiguate via kolom `kind`.
//
// Pakai firebase-admin Messaging API; service account credential
// diambil dari env (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY). Init lazy
// supaya dev tanpa Firebase tidak crash di boot.

import type { App } from 'firebase-admin/app';
import { env } from '../env.js';
import { logger } from './logger.js';

let app: App | null = null;
let initFailed = false;

async function ensureApp(): Promise<App | null> {
  if (app) return app;
  if (initFailed) return null;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    return null;
  }
  try {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    // Singleton — kalau sudah ada app dari init lain (test, dll), reuse.
    if (getApps().length > 0) {
      app = getApps()[0]!;
      return app;
    }
    app = initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        // .env biasanya simpan \n literal (env loader tidak ekspansi);
        // sini un-escape supaya PEM valid.
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    return app;
  } catch (e) {
    initFailed = true;
    logger.warn({ err: String(e) }, 'fcm_init_failed');
    return null;
  }
}

export interface FcmPayload {
  title: string;
  body?: string;
  link?: string;
  tag?: string;
}

export interface FcmSendResult {
  sent: number;
  // Token yang FCM kembalikan sebagai unregistered/invalid → caller harus
  // prune dari DB supaya tidak burn retry budget.
  invalidTokens: string[];
}

export async function fcmAvailable(): Promise<boolean> {
  return (await ensureApp()) !== null;
}

// Send notification ke 1 set FCM token. Return count + token mati supaya
// pemanggil bisa prune subscription kind=fcm yang kadaluarsa.
export async function fcmSend(tokens: string[], payload: FcmPayload): Promise<FcmSendResult> {
  if (tokens.length === 0) return { sent: 0, invalidTokens: [] };
  const a = await ensureApp();
  if (!a) {
    logger.debug('fcm_send_skipped_not_configured');
    return { sent: 0, invalidTokens: [] };
  }
  const { getMessaging } = await import('firebase-admin/messaging');
  const messaging = getMessaging(a);
  let sent = 0;
  const invalidTokens: string[] = [];
  // sendEachForMulticast batch sampai 500 — kita rarely punya > 50,
  // tapi tetap chunk untuk safety.
  const CHUNK = 500;
  for (let i = 0; i < tokens.length; i += CHUNK) {
    const slice = tokens.slice(i, i + CHUNK);
    try {
      const resp = await messaging.sendEachForMulticast({
        tokens: slice,
        notification: {
          title: payload.title,
          body: payload.body ?? '',
        },
        // Data payload supaya SW client bisa baca link saat tap.
        data: {
          ...(payload.link ? { link: payload.link } : {}),
          ...(payload.tag ? { tag: payload.tag } : {}),
        },
        android: {
          priority: 'high',
          notification: {
            // tag = collapse key supaya notif sejenis (mis. chat dari
            // user yang sama) replace bukan tumpuk.
            tag: payload.tag ?? 'bsn-lacak',
            channelId: 'bsn-lacak-default',
          },
        },
      });
      sent += resp.successCount;
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code ?? '';
          // Klasifikasi error FCM yang berarti token mati permanen.
          if (
            code === 'messaging/registration-token-not-registered'
            || code === 'messaging/invalid-registration-token'
            || code === 'messaging/invalid-argument'
          ) {
            invalidTokens.push(slice[idx]!);
          } else {
            logger.warn({ err: String(r.error), code, token: slice[idx]!.slice(0, 12) + '…' }, 'fcm_send_failed');
          }
        }
      });
    } catch (e) {
      logger.warn({ err: String(e) }, 'fcm_send_batch_failed');
    }
  }
  return { sent, invalidTokens };
}
