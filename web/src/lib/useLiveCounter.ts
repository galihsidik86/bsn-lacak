// Counts SSE events received since mount, with a "fresh" flag that goes
// false after FADE_MS of inactivity. Drives the small "+N live" chip on
// Dashboard tiles so the operator can see incoming traffic at a glance.

import { useEffect, useRef, useState } from 'react';
import { subscribe } from './events';

interface State { count: number; fresh: boolean }

const FADE_MS = 8_000;

export function useLiveCounter(
  topic: 'kunjungan.created' | 'kunjungan.reviewed' | 'blast.completed' | 'nasabah.reassign',
): State {
  const [state, setState] = useState<State>({ count: 0, fresh: false });
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = subscribe(topic, () => {
      setState(s => ({ count: s.count + 1, fresh: true }));
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => setState(s => ({ ...s, fresh: false })),
        FADE_MS,
      );
    });
    return () => {
      unsub();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [topic]);

  return state;
}
