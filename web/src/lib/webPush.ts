// Web Push subscriber. Drives the petugas Profil tab toggle: ask for
// permission, subscribe via the active service worker, and POST the
// subscription up to the api so the server can fan out via web-push.

import axios from 'axios';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';

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

export async function pushState(): Promise<PushState> {
  const supported = typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
  if (!supported) return { supported: false, permission: 'denied', subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported, permission: Notification.permission, subscribed: !!sub };
}

export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
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
