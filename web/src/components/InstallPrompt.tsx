import { useEffect, useState } from 'react';
import { Ic } from './Icons';

// Capture the browser's beforeinstallprompt event and surface a banner so
// the petugas can add BSN Lacak to their home screen. Hidden once the app
// is already installed (display-mode: standalone) or the user dismisses.

interface BIPEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'bsn_install_dismissed_at';
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function recentlyDismissed(): boolean {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    return Date.now() - Number(v) < DISMISS_TTL;
  } catch { return false; }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari uses navigator.standalone.
  // @ts-expect-error — non-standard property
  if (window.navigator.standalone) return true;
  return false;
}

export function InstallPrompt() {
  const [ev, setEv] = useState<BIPEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (recentlyDismissed()) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setEv(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!ev || isStandalone()) return null;

  const install = async () => {
    setInstalling(true);
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      if (choice.outcome === 'dismissed') {
        try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
      }
    } finally {
      setEv(null);
      setInstalling(false);
    }
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setEv(null);
  };

  return (
    <div className="card card-pad fade-up" style={{
      margin: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--accent-soft)', border: '1px solid var(--accent-soft-2)',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 11, flex: 'none',
        background: 'var(--accent)', color: 'white',
        display: 'grid', placeItems: 'center',
      }}>
        <Ic.download size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent-ink)' }}>Pasang BSN Lacak</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 1 }}>
          Tambah ke layar utama supaya buka langsung tanpa browser.
        </div>
      </div>
      <button className="btn btn-sm btn-primary" onClick={install} disabled={installing}>
        {installing ? 'Memasang…' : 'Pasang'}
      </button>
      <button onClick={dismiss} aria-label="Tutup" style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--ink-3)', padding: 4,
      }}>
        <Ic.x size={16} />
      </button>
    </div>
  );
}
