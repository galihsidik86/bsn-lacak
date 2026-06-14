import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { bootstrapSession } from './lib/api';
import { fetchMe, useAuth } from './lib/auth';
import './styles.css';

// Register the service worker so Chrome's installability check passes —
// without this, beforeinstallprompt never fires. We deliberately ignore
// onNeedRefresh so a new SW version (frequent in dev when HMR rebuilds the
// worker) never triggers an auto-reload mid-form.
registerSW({
  immediate: true,
  onNeedRefresh: () => { /* swallow — user can hard-reload to take updates */ },
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
