import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import * as Sentry from '@sentry/react';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { bootstrapSession } from './lib/api';
import { fetchMe, useAuth } from './lib/auth';
import './styles.css';

// Sentry no-ops when the DSN is absent so dev / preview builds stay clean.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENV ?? 'development',
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  });
}

// Register the service worker so Chrome's installability check passes —
// without this, beforeinstallprompt never fires. onNeedRefresh fires
// whenever a fresh SW + precache manifest is detected — we auto-apply so
// users always end up on the latest bundle (Vite content-hash invalidates
// every chunk per deploy). Trade-off: a deploy that happens while user
// is mid-form can wipe the form state on reload. For production with
// active forms, swap this for a "Update tersedia" toast that lets the
// user opt in.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { updateSW(true); },
  onOfflineReady: () => { /* no UI hookup */ },
});

// SW relays a message to the active tab when the user taps a notification.
// We translate it into a hash-route change so App's existing router picks
// it up without a reload.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; link?: string } | undefined;
    if (data?.type === 'navigate' && typeof data.link === 'string') {
      const clean = data.link.replace(/^\/?#?/, '');
      if (clean) window.location.hash = clean;
    }
  });
}

// Native APK: terjemahkan tap notif FCM ke hash route, sama spirit
// dengan SW message di atas. Plugin fire 'pushNotificationActionPerformed'
// dengan data payload yang server kirim di field `data.link`.
void (async () => {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  void PushNotifications.addListener('pushNotificationActionPerformed', (ev: { notification: { data?: Record<string, unknown> } }) => {
    const link = (ev.notification.data as { link?: string } | undefined)?.link;
    if (typeof link === 'string' && link) {
      const clean = link.replace(/^\/?#?/, '');
      if (clean) window.location.hash = clean;
    }
  });
})();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Try silent session restore from the httpOnly refresh cookie, then mark
// bootstrap done so App stops showing the loading splash. If the refresh
// succeeds and we have an access token, /auth/me fills in the user profile.
(async () => {
  const ok = await bootstrapSession().catch(() => false);
  if (ok) {
    const me = await fetchMe();
    if (me) useAuth.getState().setUser(me as any);
  }
  useAuth.getState().setBootstrapped(true);
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
