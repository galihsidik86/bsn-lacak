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

// iOS Safari never fires beforeinstallprompt — the only path is Share →
// Add to Home Screen. Detect iOS/iPadOS so we can show an instructional
// banner instead of waiting for an event that never arrives.
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // Modern iPadOS pretends to be Mac but exposes touch + standalone.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export function InstallPrompt() {
  const [ev, setEv] = useState<BIPEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  // Detected once on mount — iOS UA is stable for the session.
  const [iosCapable] = useState(() => isIos());

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

  if (isStandalone()) return null;
  if (recentlyDismissed()) return null;

  // Three modes:
  //   - Chrome-style: beforeinstallprompt fired → "Pasang" button (calls prompt())
  //   - iOS: show the same banner shape but tap → modal guide
  //   - Neither: render nothing
  if (!ev && !iosCapable) return null;

  const install = async () => {
    if (iosCapable) { setShowIosGuide(true); return; }
    if (!ev) return;
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
    setShowIosGuide(false);
  };

  return (
    <>
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
            {iosCapable
              ? 'Tambah ke layar utama lewat menu Share Safari.'
              : 'Tambah ke layar utama supaya buka langsung tanpa browser.'}
          </div>
        </div>
        <button className="btn btn-sm btn-primary" onClick={install} disabled={installing}>
          {installing ? 'Memasang…' : iosCapable ? 'Cara Pasang' : 'Pasang'}
        </button>
        <button onClick={dismiss} aria-label="Tutup" style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--ink-3)', padding: 4,
        }}>
          <Ic.x size={16} />
        </button>
      </div>

      {showIosGuide && <IosInstallGuide onClose={() => setShowIosGuide(false)} />}
    </>
  );
}

function IosInstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 35, 25, 0.55)',
        display: 'grid', placeItems: 'center', zIndex: 100, padding: 16,
      }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 18, maxWidth: 380, width: '100%',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
        <div style={{ padding: '18px 22px 8px' }}>
          <div className="between">
            <div className="section-title">Pasang ke Layar Utama (iOS)</div>
            <button onClick={onClose} aria-label="Tutup" className="btn btn-ghost btn-sm">
              <Ic.x size={16} />
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Browser Safari di iOS tidak mendukung tombol "Pasang" otomatis.
            Ikuti tiga langkah berikut untuk menambahkan BSN Lacak ke Layar Utama:
          </p>
        </div>
        <div style={{ padding: '8px 22px 22px' }}>
          <Step n={1} icon="send" title='Ketuk ikon "Bagikan"' detail="Ada di bagian bawah layar Safari — kotak dengan panah ke atas." />
          <Step n={2} icon="plus" title="Pilih 'Tambah ke Layar Utama'" detail="Gulir menu sampai melihat opsi ini." />
          <Step n={3} icon="checkCircle" title="Konfirmasi 'Tambah'" detail="Ikon BSN Lacak akan muncul di layar utama HP Anda — tap untuk buka full-screen." />
          <div className="card card-pad" style={{ marginTop: 12, background: 'var(--accent-soft)', boxShadow: 'none' }}>
            <div className="center gap-2" style={{ color: 'var(--accent-ink)', fontSize: 12.5, fontWeight: 700 }}>
              <Ic.checkCircle size={15} />Setelah terpasang, GPS dan notifikasi aktif penuh.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, icon, title, detail }: { n: number; icon: keyof typeof Ic; title: string; detail: string }) {
  const Icon = Ic[icon];
  return (
    <div className="center gap-3" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
      <div className="num" style={{
        width: 28, height: 28, borderRadius: 99, background: 'var(--accent)', color: 'white',
        display: 'grid', placeItems: 'center', flex: 'none', fontSize: 13, fontWeight: 800,
      }}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="center gap-2">
          <Icon size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{detail}</div>
      </div>
    </div>
  );
}
