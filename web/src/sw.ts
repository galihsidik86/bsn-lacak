/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

// Vite-plugin-pwa injects the precache manifest here at build time.
precacheAndRoute(self.__WB_MANIFEST);

// --- Web Push -------------------------------------------------------------
//
// Server sends a JSON payload via web-push:
//   { title, body, link, tag }
// The SW shows it as an OS-level notification; tapping it focuses the
// existing tab and tells the SPA to navigate to the link, or opens a new
// tab if none is around.

interface PushPayload {
  title?: string;
  body?: string;
  link?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try { payload = event.data?.json() ?? {}; } catch { /* non-json payload */ }
  const title = payload.title || 'BSN Lacak';
  const opts: NotificationOptions = {
    body: payload.body || '',
    tag: payload.tag,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { link: payload.link || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | undefined)?.link || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = all[0];
    if (existing) {
      try { existing.postMessage({ type: 'navigate', link }); } catch { /* ignore */ }
      await (existing as WindowClient).focus();
      return;
    }
    await self.clients.openWindow(link);
  })());
});
