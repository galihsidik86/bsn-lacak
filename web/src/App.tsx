import { Fragment, Suspense, lazy, useEffect, useState } from 'react';
import { Ic, type IconKey } from './components/Icons';
import { NotificationBell } from './components/NotificationBell';
import { Avatar } from './components/UI';
import { TweakRadio, TweakSection, TweakSelect, TweakToggle, TweaksPanel, useTweaks } from './components/TweaksPanel';
import { useSegmen } from './data/queries';
import { doLogout, useAuth } from './lib/auth';
import { useEventStream } from './lib/useEventStream';
import { ChangePassword } from './screens/ChangePassword';
import { Login } from './screens/Login';

// Lazy-load each screen so the initial bundle only ships the shell + login.
// Vite splits them into separate chunks named after the dynamic import target.
const ScreenAngsuran = lazy(() => import('./screens/Angsuran').then(m => ({ default: m.ScreenAngsuran })));
const ScreenBlast = lazy(() => import('./screens/Blast').then(m => ({ default: m.ScreenBlast })));
const ScreenDashboard = lazy(() => import('./screens/Dashboard').then(m => ({ default: m.ScreenDashboard })));
const ScreenDistribusi = lazy(() => import('./screens/Distribusi').then(m => ({ default: m.ScreenDistribusi })));
const ScreenKolektabilitas = lazy(() => import('./screens/Kolektabilitas').then(m => ({ default: m.ScreenKolektabilitas })));
const ScreenLaporan = lazy(() => import('./screens/Laporan').then(m => ({ default: m.ScreenLaporan })));
const ScreenMobile = lazy(() => import('./screens/Mobile').then(m => ({ default: m.ScreenMobile })));
const ScreenTracking = lazy(() => import('./screens/Tracking').then(m => ({ default: m.ScreenTracking })));

function ScreenFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 48, color: 'var(--ink-3)', fontSize: 13, fontWeight: 600 }}>
      Memuat layar…
    </div>
  );
}

type PageKey =
  | 'dashboard' | 'tracking' | 'kolektabilitas' | 'angsuran'
  | 'blast' | 'laporan' | 'distribusi' | 'mobile';

interface NavItem { k: PageKey; label: string; icon: IconKey; badge?: number }
interface NavGroup { group: string; items: NavItem[] }

function useNav(): NavGroup[] {
  const seg = useSegmen();
  return [
    { group: 'Monitoring', items: [
      { k: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { k: 'tracking', label: 'Tracking Petugas', icon: 'map' },
      { k: 'kolektabilitas', label: 'Kolektabilitas', icon: 'layers' },
      { k: 'angsuran', label: 'Pergerakan Angsuran', icon: 'chart' },
    ] },
    { group: 'Operasional', items: [
      { k: 'blast', label: 'Blast SMS / WA', icon: 'send', badge: seg.lewat.length },
      { k: 'laporan', label: 'Laporan Kunjungan', icon: 'clipboard' },
      { k: 'distribusi', label: 'Distribusi Nasabah', icon: 'users' },
    ] },
    { group: 'Lapangan', items: [
      { k: 'mobile', label: 'Aplikasi Petugas', icon: 'phone' },
    ] },
  ];
}

const TITLES: Record<PageKey, [string, string]> = {
  dashboard: ['Dashboard', 'Ringkasan operasional penagihan · 11 Juni 2026'],
  tracking: ['Tracking Petugas', 'Posisi live & rute kunjungan hari ini'],
  kolektabilitas: ['Postur Kolektabilitas', 'Komposisi & detail nasabah binaan'],
  angsuran: ['Pergerakan Angsuran', 'Arus pembayaran & ledger transaksi'],
  blast: ['Blast SMS / WhatsApp', 'Pengingat jatuh tempo & penagihan massal'],
  laporan: ['Laporan Kunjungan', 'Laporan harian petugas beserta foto bukti'],
  distribusi: ['Distribusi Nasabah', 'Alokasi nasabah binaan ke petugas lapangan'],
  mobile: ['Aplikasi Petugas Lapangan', 'Pratinjau aplikasi mobile kolektor'],
};

const TWEAK_DEFAULTS = {
  accent: 'hijau' as const,
  font: 'Plus Jakarta Sans',
  density: 'regular' as const,
  dark: false,
};

const ACCENTS: Record<string, { h: number; label: string }> = {
  hijau: { h: 162, label: 'Emerald' },
  teal: { h: 190, label: 'Teal' },
  emas: { h: 95, label: 'Hijau Emas' },
  navy: { h: 240, label: 'Navy' },
};

function applyAccent(name: string) {
  const h = ACCENTS[name]?.h ?? 162;
  const r = document.documentElement.style;
  r.setProperty('--accent', `oklch(0.57 0.125 ${h})`);
  r.setProperty('--accent-600', `oklch(0.51 0.13 ${h})`);
  r.setProperty('--accent-700', `oklch(0.43 0.115 ${h})`);
  r.setProperty('--accent-soft', `oklch(0.95 0.038 ${h})`);
  r.setProperty('--accent-soft-2', `oklch(0.90 0.056 ${h})`);
  r.setProperty('--accent-ink', `oklch(0.34 0.095 ${h})`);
  r.setProperty('--col-lancar', `oklch(0.60 0.13 ${h})`);
  r.setProperty('--col-lancar-soft', `oklch(0.95 0.038 ${h})`);
}

function isPage(k: string): k is PageKey {
  return k in TITLES;
}

export function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS as any);
  const user = useAuth(s => s.user);
  const bootstrapped = useAuth(s => s.bootstrapped);
  const [showChangePw, setShowChangePw] = useState(false);
  const [page, setPage] = useState<PageKey>(() => {
    const h = location.hash.slice(1);
    return isPage(h) ? h : 'dashboard';
  });

  const go = (k: string) => {
    if (!isPage(k)) return;
    setPage(k);
    location.hash = k;
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-density', t.density);
    document.documentElement.style.setProperty('--font', `"${t.font}", system-ui, sans-serif`);
    applyAccent(t.accent);
  }, [t]);

  // Listen for 401 → API client emits this when refresh fails.
  useEffect(() => {
    const handler = () => useAuth.getState().setUser(null);
    window.addEventListener('bsn:unauthenticated', handler);
    return () => window.removeEventListener('bsn:unauthenticated', handler);
  }, []);

  // Build nav before any conditional return so hook order is stable across
  // bootstrap → login → dashboard transitions.
  const NAV = useNav();

  // Wire up SSE-driven query invalidation. Hook order must stay stable, so
  // this also runs before the conditional returns; the underlying connect
  // is no-op without a token.
  useEventStream();

  // Wait for the silent bootstrap to settle before deciding what to render.
  if (!bootstrapped) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13, fontWeight: 600 }}>
        Memuat…
      </div>
    );
  }
  if (!user) return <Login />;
  const forceChange = !!user.mustChangePassword;

  const [title, sub] = TITLES[page];

  return (
    <div className="app">
      <a href="#main-content" className="visually-hidden focus-visible-skip">Lewati ke konten utama</a>
      <aside className="sidebar" aria-label="Navigasi utama">
        <div className="brand">
          <div className="islamic-band" />
          <div className="brand-mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7">
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
              <rect x="5" y="5" width="14" height="14" rx="1.5" transform="rotate(45 12 12)" />
              <circle cx="12" cy="12" r="2.4" fill="var(--gold)" stroke="none" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">BSN Lacak</div>
            <div className="brand-sub">Bank Syariah Nasional</div>
          </div>
        </div>

        <nav aria-label="Menu">
          {NAV.map(grp => (
            <Fragment key={grp.group}>
              <div className="nav-label" id={`nav-${grp.group}`}>{grp.group}</div>
              <div role="group" aria-labelledby={`nav-${grp.group}`}>
                {grp.items.map(it => {
                  const Icon = Ic[it.icon];
                  const isActive = page === it.k;
                  return (
                    <button key={it.k} className={'nav-item' + (isActive ? ' active' : '')}
                      onClick={() => go(it.k)}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={it.label + (it.badge ? `, ${it.badge} item perlu perhatian` : '')}>
                      <Icon aria-hidden="true" /><span className="lbl">{it.label}</span>
                      {it.badge ? <span className="badge-count num" aria-hidden="true">{it.badge}</span> : null}
                    </button>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </nav>

        <div className="sidebar-foot">
          <Avatar inisial={user.nama.slice(0, 2).toUpperCase()} hue={162} size={36} />
          <div style={{ flex: 1, minWidth: 0 }} className="brand-text">
            <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.nama}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{user.role}</div>
          </div>
          <button onClick={() => doLogout()} className="btn btn-ghost btn-sm" title="Keluar"
            style={{ padding: 6, border: 'none' }}>
            <Ic.logout size={17} style={{ color: 'var(--ink-4)' }} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ flex: 1 }}>
            <div className="page-title">{title}</div>
            <div className="page-sub">{sub}</div>
          </div>
          <div className="search" style={{ width: 260 }}>
            <Ic.search size={16} aria-hidden="true" />
            <input placeholder="Cari nasabah, petugas, transaksi…"
              aria-label="Cari nasabah, petugas, transaksi" type="search" />
          </div>
          <NotificationBell onNavigate={(link) => go(link)} />
          <button className="btn" aria-label="Ekspor laporan"><Ic.download size={16} aria-hidden="true" />Ekspor</button>
        </header>

        <main id="main-content" className="main-scroll" style={{
          flex: 1, overflow: page === 'tracking' ? 'hidden' : 'auto',
          display: 'flex', flexDirection: 'column',
        }}>
          <Suspense fallback={<ScreenFallback />}>
            {page === 'dashboard' && <ScreenDashboard go={go} />}
            {page === 'tracking' && <ScreenTracking go={go} />}
            {page === 'kolektabilitas' && <ScreenKolektabilitas go={go} />}
            {page === 'angsuran' && <ScreenAngsuran />}
            {page === 'blast' && <ScreenBlast />}
            {page === 'laporan' && <ScreenLaporan />}
            {page === 'distribusi' && <ScreenDistribusi />}
            {page === 'mobile' && <ScreenMobile />}
          </Suspense>
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Tema & Warna" />
        <TweakRadio label="Warna aksen" value={t.accent as any}
          options={Object.keys(ACCENTS)} onChange={v => setTweak('accent', v)} />
        <TweakToggle label="Mode gelap" value={t.dark} onChange={v => setTweak('dark', v)} />
        <TweakSection label="Tipografi & Kepadatan" />
        <TweakSelect label="Font" value={t.font}
          options={['Plus Jakarta Sans', 'Manrope', 'Figtree', 'DM Sans', 'Schibsted Grotesk']}
          onChange={v => setTweak('font', v)} />
        <TweakRadio label="Kepadatan" value={t.density}
          options={['compact', 'regular', 'comfy'] as const} onChange={v => setTweak('density', v)} />
      </TweaksPanel>

      {(forceChange || showChangePw) && (
        <ChangePassword forced={forceChange} onClose={() => setShowChangePw(false)} />
      )}
    </div>
  );
}
