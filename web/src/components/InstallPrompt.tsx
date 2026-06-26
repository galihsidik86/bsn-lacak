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
      <div className="m-install-banner">
        <div className="m-install-ic">
          <Ic.download size={20} aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="m-install-title">Pasang BSN Lacak</div>
          <div className="m-install-body">
            {iosCapable
              ? 'Tambah ke layar utama lewat menu Share Safari.'
              : 'Tambah ke layar utama supaya buka langsung tanpa browser.'}
          </div>
        </div>
        <button type="button" className="m-install-cta" onClick={install} disabled={installing}>
          {installing ? 'Memasang…' : iosCapable ? 'Pasang' : 'Pasang'}
        </button>
        <button type="button" onClick={dismiss} aria-label="Tutup" className="m-install-close">
          <Ic.x size={16} aria-hidden="true" />
        </button>
      </div>

      {showIosGuide && <IosInstallGuide onClose={() => setShowIosGuide(false)} />}
    </>
  );
}

function IosInstallGuide({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true"
      className="m-ios-guide-backdrop"
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="m-ios-guide-card">
        <div className="m-ios-guide-head">
          <div className="m-ios-guide-title">Pasang ke Layar Utama (iOS)</div>
          <button onClick={onClose} aria-label="Tutup" className="m-gallery-close">
            <Ic.x size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="m-ios-guide-body">
          <p className="m-ios-guide-intro">
            Browser Safari di iOS tidak mendukung tombol "Pasang" otomatis.
            Ikuti tiga langkah berikut untuk menambahkan BSN Lacak ke Layar Utama:
          </p>
          <Step n={1} icon="send" title='Ketuk ikon "Bagikan"' detail="Ada di bagian bawah layar Safari — kotak dengan panah ke atas." />
          <Step n={2} icon="plus" title="Pilih 'Tambah ke Layar Utama'" detail="Gulir menu sampai melihat opsi ini." />
          <Step n={3} icon="checkCircle" title="Konfirmasi 'Tambah'" detail="Ikon BSN Lacak akan muncul di layar utama HP Anda — tap untuk buka full-screen." />
          <div className="m-ios-guide-footnote">
            <Ic.checkCircle size={16} aria-hidden="true" />Setelah terpasang, GPS dan notifikasi aktif penuh.
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, icon, title, detail }: { n: number; icon: keyof typeof Ic; title: string; detail: string }) {
  const Icon = Ic[icon];
  return (
    <div className="m-ios-step">
      <div className="m-ios-step-num num">{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="m-ios-step-title">
          <Icon size={15} style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <span>{title}</span>
        </div>
        <div className="m-ios-step-detail">{detail}</div>
      </div>
    </div>
  );
}
