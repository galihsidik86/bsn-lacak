// Screen Wake Lock — supaya browser tidak suspend tab petugas saat layar
// HP idle. Tanpa ini, watchPosition di geolocation hook ikut suspend di
// background dan trail GPS bolong selama petugas berkendara.
//
// API: navigator.wakeLock.request('screen') — tersedia di Chrome Android
// 84+ / Safari 16.4+. Lock otomatis dilepas saat tab background atau saat
// halaman ter-unload, jadi kita auto re-acquire pada 'visibilitychange'.
//
// Behavior:
// - enabled=true → acquire lock + auto re-acquire kalau lepas
// - enabled=false → release lock
// - Return status: 'active' | 'idle' | 'unsupported' | 'denied'
// - Status dipakai UI badge supaya petugas tahu lock aktif (atau gagal).

import { useEffect, useRef, useState } from 'react';

export type WakeLockStatus = 'idle' | 'active' | 'unsupported' | 'denied';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

export function useScreenWakeLock(enabled: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>('idle');
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) {
      setStatus('unsupported');
      return;
    }
    if (!enabled) {
      setStatus('idle');
      // Lepas lock kalau ada saat enabled berubah ke false.
      if (sentinelRef.current) {
        void sentinelRef.current.release().catch(() => undefined);
        sentinelRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      if (cancelled) return;
      // Skip kalau lock masih hidup.
      if (sentinelRef.current) return;
      // Wake lock cuma bisa di-acquire saat dokumen visible.
      if (document.visibilityState !== 'visible') return;
      try {
        const sentinel = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
        setStatus('active');
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
          // Kalau release karena tab background, biarkan idle. Auto re-
          // acquire saat visibility 'visible' di handler bawah.
          setStatus('idle');
        });
      } catch (err: any) {
        // Common error: 'NotAllowedError' kalau page tidak punya user
        // gesture / focus context. Anggap 'denied' supaya badge bisa kasih
        // hint actionable ("tap layar dulu") tanpa noise.
        if (cancelled) return;
        if (err?.name === 'NotAllowedError') setStatus('denied');
        else setStatus('idle');
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinelRef.current) {
        void sentinelRef.current.release().catch(() => undefined);
        sentinelRef.current = null;
      }
    };
  }, [enabled]);

  return status;
}
