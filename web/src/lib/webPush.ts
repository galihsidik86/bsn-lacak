// Push subscriber — drives the petugas Profil tab toggle. Dual runtime:
//   - Browser PWA: Web Push API (VAPID + service worker pushManager).
//   - Capacitor APK native: @capacitor/push-notifications plugin (FCM).
// Backend tabel PushSubscription menyimpan keduanya, disambiguate via
// kolom `kind` ('vapid' vs 'fcm').

import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';
const isNative = Capacitor.isNativePlatform();

// PushManager.subscribe wants a BufferSource with ArrayBuffer backing.
// Build the Uint8Array on top of a fresh ArrayBuffer to satisfy strict types.
function urlBase64ToBufferSource(base64: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

async function fetchVapidPublic(): Promise<string | null> {
  try {
    const { data } = await axios.get(`${BASE}/push/vapid-public`);
    return typeof data?.publicKey === 'string' ? data.publicKey : null;
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface PushState {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
}

// Cache FCM token saat register sukses supaya unsubscribe bisa POST
// endpoint yang sama tanpa harus re-register dulu.
const FCM_TOKEN_KEY = 'bsn-lacak:fcm-token';

export async function pushState(): Promise<PushState> {
  // --- Native (FCM) ---
  if (isNative) {
    try {
      const perm = await PushNotifications.checkPermissions();
      // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
      const granted = perm.receive === 'granted';
      const stored = (() => {
        try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return null; }
      })();
      return {
        supported: true,
        permission: granted ? 'granted' : (perm.receive === 'denied' ? 'denied' : 'default'),
        subscribed: granted && !!stored,
      };
    } catch {
      return { supported: false, permission: 'denied', subscribed: false };
    }
  }

  // --- Web (VAPID) ---
  const supported = typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
  if (!supported) return { supported: false, permission: 'denied', subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported, permission: Notification.permission, subscribed: !!sub };
}

export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
  // --- Native (FCM) ---
  if (isNative) {
    try {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') return { ok: false, reason: 'permission' };

      // Listener register SEKALI per page load — plugin spawn ulang
      // OK tapi callback double. Use Promise yang resolve di registration.
      const token = await new Promise<string>((resolve, reject) => {
        const ok = PushNotifications.addListener('registration', (t) => {
          void ok.then(h => h.remove());
          void err.then(h => h.remove());
          resolve(t.value);
        });
        const err = PushNotifications.addListener('registrationError', (e) => {
          void ok.then(h => h.remove());
          void err.then(h => h.remove());
          reject(new Error(String(e.error)));
        });
        void PushNotifications.register();
      });

      try { localStorage.setItem(FCM_TOKEN_KEY, token); } catch { /* ignore */ }
      await axios.post(`${BASE}/push/subscribe`,
        { kind: 'fcm', fcmToken: token },
        { withCredentials: true, headers: authHeaders() },
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'fcm_register_failed' };
    }
  }

  // --- Web (VAPID) ---
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  const reg = await navigator.serviceWorker.ready;
  // Ask permission if needed.
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'permission' };

  const publicKey = await fetchVapidPublic();
  if (!publicKey) return { ok: false, reason: 'vapid_missing' };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBufferSource(publicKey),
    });
  }
  const json: any = sub.toJSON();
  await axios.post(`${BASE}/push/subscribe`,
    { endpoint: json.endpoint, keys: json.keys },
    { withCredentials: true, headers: authHeaders() },
  );
  return { ok: true };
}

export async function unsubscribePush(): Promise<void> {
  // --- Native (FCM) ---
  if (isNative) {
    const token = (() => { try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return null; } })();
    if (token) {
      await axios.post(`${BASE}/push/unsubscribe`,
        { endpoint: token },
        { withCredentials: true, headers: authHeaders() },
      ).catch(() => undefined);
      try { localStorage.removeItem(FCM_TOKEN_KEY); } catch { /* ignore */ }
    }
    // Plugin tidak punya 'unregister' eksplisit — device tetap punya
    // token, kita cukup hapus dari server supaya fan-out skip.
    return;
  }

  // --- Web (VAPID) ---
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await axios.post(`${BASE}/push/unsubscribe`,
    { endpoint: sub.endpoint },
    { withCredentials: true, headers: authHeaders() },
  ).catch(() => undefined);
  await sub.unsubscribe();
}
