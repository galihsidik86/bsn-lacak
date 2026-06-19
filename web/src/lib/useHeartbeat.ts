// CU — once the user is authenticated, ping /api/users/heartbeat every
// HEARTBEAT_MS (60s) while the tab is focused. Stamps the user's
// lastSeenAt server-side so the presence list works.

import { useEffect } from 'react';
import { tokenStore } from './api';

const HEARTBEAT_MS = 60_000;
const BASE = import.meta.env.VITE_API_URL || '/api';

export function useHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const ping = async () => {
      if (document.hidden) return;
      const tok = tokenStore.get();
      if (!tok) return;
      try {
        await fetch(`${BASE}/users/heartbeat`, {
          method: 'POST',
          credentials: 'include',
          headers: { Authorization: `Bearer ${tok}` },
        });
      } catch { /* swallow — next tick will retry */ }
    };
    // Fire immediately so a fresh login shows up without a 60s wait.
    void ping();
    const id = window.setInterval(ping, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [enabled]);
}
