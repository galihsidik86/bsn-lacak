import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { tokenStore } from './api';
import { useAuth } from './auth';
import { subscribe } from './events';

const BASE = import.meta.env.VITE_API_URL || '/api';

// Total unread chat messages — dipakai badge nav & icon. Realtime via
// SSE 'chat.message' yang dispatch invalidate.
export function useChatUnread(): number {
  const tok = tokenStore.get();
  const bootstrapped = useAuth(s => s.bootstrapped);
  const user = useAuth(s => s.user);
  const qc = useQueryClient();

  useEffect(() => {
    const unsub = subscribe('chat.message', () => {
      void qc.invalidateQueries({ queryKey: ['chat-unread-count'] });
    });
    return unsub;
  }, [qc]);

  const q = useQuery<{ unread: number }>({
    queryKey: ['chat-unread-count'],
    queryFn: async () => (await axios.get(`${BASE}/chat/unread-count`, {
      withCredentials: true,
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    })).data,
    refetchInterval: 60_000,
    enabled: bootstrapped && !!user && !!tok,
  });
  return q.data?.unread ?? 0;
}
