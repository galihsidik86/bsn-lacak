// React hook layer over lib/events.ts. Auto-invalidates React Query when
// server-side state changes — so the dashboard, blast list, tracking, etc.
// refresh without manual polling.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribe } from './events';

export function useEventStream() {
  const qc = useQueryClient();

  useEffect(() => {
    const unsubs = [
      subscribe('kunjungan.created', () => {
        qc.invalidateQueries({ queryKey: ['kunjungan'] });
        qc.invalidateQueries({ queryKey: ['nasabah'] });
        qc.invalidateQueries({ queryKey: ['payflow'] });
      }),
      subscribe('kunjungan.reviewed', () => {
        // Petugas needs to see status flip from PENDING → APPROVED/REJECTED
        // without reload; supervisor view needs its filtered list refreshed.
        qc.invalidateQueries({ queryKey: ['kunjungan'] });
      }),
      subscribe('nasabah.reassign', () => {
        qc.invalidateQueries({ queryKey: ['nasabah'] });
      }),
      subscribe('blast.completed', () => {
        qc.invalidateQueries({ queryKey: ['blast'] });
      }),
      subscribe('notification.new', () => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
      }),
      subscribe('chat.message', (data) => {
        qc.invalidateQueries({ queryKey: ['chat-convos'] });
        qc.invalidateQueries({ queryKey: ['chat-unread-count'] });
        // Dispatch DOM event supaya ScreenChat (kalau open) bisa
        // refresh thread aktif tanpa memburuhkan query key sharing.
        window.dispatchEvent(new CustomEvent('bsn:chat.message', { detail: data }));
      }),
    ];
    return () => { unsubs.forEach(fn => fn()); };
  }, [qc]);
}

// Used by Tracking screen — gets called only when on that screen so the live
// updates don't accumulate state for screens that don't use them.
export function usePetugasPositions(onUpdate: (data: { petugasId: string; lat: number; lng: number; ts: number }) => void) {
  useEffect(() => subscribe('petugas.position', onUpdate), [onUpdate]);
}
