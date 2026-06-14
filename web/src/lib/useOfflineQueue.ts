import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { list, remove, recordFailure, toFiles } from './submitQueue';

// Pending count + a "drain now" trigger. The drainer runs in background
// whenever the tab regains connectivity / focus; it walks the IDB outbox and
// re-posts each kunjungan via the same api.createKunjungan path used live.

export function useOfflineQueue(): { pending: number; flush: () => Promise<void> } {
  const [pending, setPending] = useState(0);
  const qc = useQueryClient();

  async function refresh() {
    try { setPending((await list()).length); } catch { /* ignore */ }
  }

  async function flush() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const items = await list().catch(() => []);
    if (items.length === 0) return;
    for (const item of items) {
      try {
        await api.createKunjungan({
          ...item.args,
          hasil: item.args.hasil as any,
          photos: toFiles(item.photos),
        });
        await remove(item.id);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // Give up after 10 attempts so a permanently-bad payload can't
        // jam the queue forever. UI can surface this state.
        if (item.attempts >= 9) {
          await remove(item.id);
        } else {
          await recordFailure(item, msg);
        }
        // If the failure looks like an offline / network error, stop the
        // walk — no point hammering remaining items.
        if (/network|fetch|failed/i.test(msg) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          break;
        }
      }
    }
    qc.invalidateQueries({ queryKey: ['kunjungan'] });
    await refresh();
  }

  useEffect(() => {
    refresh();
    const onOnline = () => { void flush(); };
    const onVis = () => { if (document.visibilityState === 'visible') void flush(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVis);
    // Periodic safety net in case events miss.
    const id = window.setInterval(() => { void flush(); }, 60_000);
    void flush();
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pending, flush };
}
