import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { bootstrapSession } from './lib/api';
import { fetchMe, useAuth } from './lib/auth';
import './styles.css';

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
