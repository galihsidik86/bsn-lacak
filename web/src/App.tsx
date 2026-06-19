import { Fragment, Suspense, lazy, useEffect, useState } from 'react';
import { Ic, type IconKey } from './components/Icons';
import { NotificationBell } from './components/NotificationBell';
import { GlobalSearchModal } from './components/GlobalSearch';
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
const ScreenBranch = lazy(() => import('./screens/Branch').then(m => ({ default: m.ScreenBranch })));
const ScreenAudit = lazy(() => import('./screens/Audit').then(m => ({ default: m.ScreenAudit })));
const ScreenSettings = lazy(() => import('./screens/Settings').then(m => ({ default: m.ScreenSettings })));
const ScreenUsers = lazy(() => import('./screens/Users').then(m => ({ default: m.ScreenUsers })));
const ScreenPetugas = lazy(() => import('./screens/Petugas').then(m => ({ default: m.ScreenPetugas })));
const ScreenNasabah = lazy(() => import('./screens/Nasabah').then(m => ({ default: m.ScreenNasabah })));
const ScreenPerforma = lazy(() => import('./screens/Performa').then(m => ({ default: m.ScreenPerforma })));
const ScreenAnalytics = lazy(() => import('./screens/Analytics').then(m => ({ default: m.ScreenAnalytics })));
const ScreenScorecard = lazy(() => import('./screens/Scorecard').then(m => ({ default: m.ScreenScorecard })));
const ScreenAgingReport = lazy(() => import('./screens/AgingReport').then(m => ({ default: m.ScreenAgingReport })));
const ScreenAttendanceMap = lazy(() => import('./screens/AttendanceMap').then(m => ({ default: m.ScreenAttendanceMap })));
const ScreenChurnRisk = lazy(() => import('./screens/ChurnRisk').then(m => ({ default: m.ScreenChurnRisk })));
const ScreenActivityFeed = lazy(() => import('./screens/ActivityFeed').then(m => ({ default: m.ScreenActivityFeed })));
const ScreenLeaderboard = lazy(() => import('./screens/Leaderboard').then(m => ({ default: m.ScreenLeaderboard })));
const ScreenSystemHealth = lazy(() => import('./screens/SystemHealth').then(m => ({ default: m.ScreenSystemHealth })));
const ScreenCommission = lazy(() => import('./screens/Commission').then(m => ({ default: m.ScreenCommission })));
const ScreenEscalation = lazy(() => import('./screens/Escalation').then(m => ({ default: m.ScreenEscalation })));
const ScreenNotifikasi = lazy(() => import('./screens/Notifikasi').then(m => ({ default: m.ScreenNotifikasi })));
const ScreenPengumuman = lazy(() => import('./screens/Pengumuman').then(m => ({ default: m.ScreenPengumuman })));
const ScreenWilayah = lazy(() => import('./screens/Wilayah').then(m => ({ default: m.ScreenWilayah })));
const ScreenFeedbackPublic = lazy(() => import('./screens/FeedbackPublic').then(m => ({ default: m.ScreenFeedbackPublic })));
const ScreenFeedback = lazy(() => import('./screens/Feedback').then(m => ({ default: m.ScreenFeedback })));
const ScreenBackup = lazy(() => import('./screens/Backup').then(m => ({ default: m.ScreenBackup })));
const ScreenApiKeys = lazy(() => import('./screens/ApiKeys').then(m => ({ default: m.ScreenApiKeys })));
const ScreenWebhooks = lazy(() => import('./screens/Webhooks').then(m => ({ default: m.ScreenWebhooks })));

function ScreenFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 48, color: 'var(--ink-3)', fontSize: 13, fontWeight: 600 }}>
      Memuat layar…
    </div>
  );
}

type PageKey =
  | 'dashboard' | 'tracking' | 'kolektabilitas' | 'angsuran'
  | 'blast' | 'laporan' | 'distribusi' | 'mobile'
  | 'branch' | 'audit' | 'settings' | 'users' | 'petugas' | 'nasabah' | 'performa' | 'analytics' | 'scorecard' | 'aging' | 'attendance-map' | 'churn' | 'activity' | 'leaderboard' | 'system-health' | 'commission' | 'escalation' | 'notifikasi' | 'pengumuman' | 'wilayah' | 'feedback' | 'backup' | 'apikeys' | 'webhooks';

interface NavItem { k: PageKey; label: string; icon: IconKey; badge?: number }
interface NavGroup { group: string; items: NavItem[] }

function useNav(): NavGroup[] {
  const seg = useSegmen();
  const role = useAuth(s => s.user?.role);
  const groups: NavGroup[] = [
    { group: 'Monitoring', items: [
      { k: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { k: 'analytics', label: 'Analytics & Closing', icon: 'trend' },
      { k: 'scorecard', label: 'Scorecard & Heatmap', icon: 'target' },
      { k: 'aging', label: 'Aging Report', icon: 'clock' },
      { k: 'attendance-map', label: 'Peta Kehadiran', icon: 'pin' },
      { k: 'churn', label: 'Churn Risk', icon: 'alert' },
      { k: 'activity', label: 'Activity Feed', icon: 'eye' },
      { k: 'leaderboard', label: 'Leaderboard', icon: 'target' },
      { k: 'commission', label: 'Komisi Petugas', icon: 'wallet' },
      { k: 'tracking', label: 'Tracking Petugas', icon: 'map' },
      { k: 'kolektabilitas', label: 'Kolektabilitas', icon: 'layers' },
      { k: 'angsuran', label: 'Pergerakan Angsuran', icon: 'chart' },
    ] },
    { group: 'Operasional', items: [
      { k: 'blast', label: 'Blast SMS / WA', icon: 'send', badge: seg.lewat.length },
      { k: 'pengumuman', label: 'Pengumuman', icon: 'bell' },
      { k: 'laporan', label: 'Laporan Kunjungan', icon: 'clipboard' },
      { k: 'distribusi', label: 'Distribusi Nasabah', icon: 'users' },
      { k: 'performa', label: 'Performa Petugas', icon: 'chart' },
      { k: 'feedback', label: 'Feedback Nasabah', icon: 'wa' },
      { k: 'escalation', label: 'Escalation', icon: 'alert' },
    ] },
    { group: 'Lapangan', items: [
      { k: 'wilayah', label: 'Wilayah Binaan', icon: 'map' },
      { k: 'mobile', label: 'Aplikasi Petugas', icon: 'phone' },
    ] },
  ];
  // Admin panel — SUPERVISOR sees user/petugas/audit scoped to own branch;
  // only ADMIN gets the cabang manager.
  const adminItems: NavItem[] = [];
  if (role === 'ADMIN') adminItems.push({ k: 'branch', label: 'Kelola Cabang', icon: 'layers' });
  if (role === 'ADMIN') adminItems.push({ k: 'backup', label: 'Backup DB', icon: 'download' });
  if (role === 'ADMIN') adminItems.push({ k: 'system-health', label: 'System Health', icon: 'alert' });
  if (role === 'ADMIN') adminItems.push({ k: 'apikeys', label: 'API Keys', icon: 'eye' });
  if (role === 'ADMIN') adminItems.push({ k: 'webhooks', label: 'Webhooks', icon: 'send' });
  if (role === 'ADMIN' || role === 'SUPERVISOR') {
    adminItems.push({ k: 'petugas', label: 'Kelola Petugas', icon: 'user' });
    adminItems.push({ k: 'nasabah', label: 'Kelola Nasabah', icon: 'users' });
    adminItems.push({ k: 'users', label: 'Kelola User', icon: 'users' });
    adminItems.push({ k: 'audit', label: 'Audit Log', icon: 'eye' });
  }
  if (adminItems.length) groups.push({ group: 'Administrasi', items: adminItems });
  return groups;
}

const TODAY_LABEL = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

const TITLES: Record<PageKey, [string, string]> = {
  dashboard: ['Dashboard', `Ringkasan operasional penagihan · ${TODAY_LABEL}`],
  tracking: ['Tracking Petugas', 'Posisi live & rute kunjungan hari ini'],
  kolektabilitas: ['Postur Kolektabilitas', 'Komposisi & detail nasabah binaan'],
  angsuran: ['Pergerakan Angsuran', 'Arus pembayaran & ledger transaksi'],
  blast: ['Blast SMS / WhatsApp', 'Pengingat jatuh tempo & penagihan massal'],
  laporan: ['Laporan Kunjungan', 'Laporan harian petugas beserta foto bukti'],
  distribusi: ['Distribusi Nasabah', 'Alokasi nasabah binaan ke petugas lapangan'],
  mobile: ['Aplikasi Petugas Lapangan', 'Pratinjau aplikasi mobile kolektor'],
  branch: ['Kelola Cabang', 'Kelola cabang BSN — hanya ADMIN HQ'],
  audit: ['Audit Log', 'Audit trail aktivitas sistem (login, mutasi data, dll)'],
  settings: ['Pengaturan Akun', 'Profil, password, dan preferensi pribadi'],
  users: ['Kelola User', 'Tambah / edit / nonaktifkan akun login pengguna sistem'],
  petugas: ['Kelola Petugas', 'Tambah / edit data petugas lapangan'],
  nasabah: ['Kelola Nasabah', 'Tambah / edit / non-aktifkan data nasabah binaan'],
  performa: ['Performa Petugas', 'Approval rate, flag rate, dan respon supervisor per petugas'],
  analytics: ['Analytics & Closing', 'Tren penagihan bulanan, leaderboard, dan ekspor closing CSV'],
  scorecard: ['Scorecard & Heatmap', 'KPI cabang vs target bulan ini + heatmap risiko per kolektabilitas'],
  aging: ['Aging Report', 'Distribusi usia PENDING laporan per cabang & per petugas'],
  'attendance-map': ['Peta Kehadiran', 'Titik clock-in petugas pada peta basemap'],
  churn: ['Churn Risk', 'Nasabah dengan risiko tertinggi — skor & faktor di balik angkanya'],
  activity: ['Activity Feed', 'Timeline kunjungan, pembayaran, blast, review per cabang'],
  leaderboard: ['Leaderboard', 'Top petugas tertagih bulan ini dengan podium juara'],
  commission: ['Komisi Petugas', 'Tabel komisi per petugas berdasarkan tertagih bulan berjalan'],
  escalation: ['Escalation Matrix', 'Tiket eskalasi nasabah dengan KOL tinggi tanpa progress pembayaran'],
  'system-health': ['System Health', 'DB ping, worker freshness, queue depth, process uptime'],
  notifikasi: ['Notifikasi', 'Riwayat semua notifikasi sistem dan supervisor'],
  pengumuman: ['Pengumuman', 'Broadcast notifikasi ke seluruh petugas di cabang'],
  wilayah: ['Wilayah Binaan', 'Gambar polygon geofence per wilayah dan tugaskan ke petugas'],
  feedback: ['Feedback Nasabah', 'Rating + komentar nasabah pasca-kunjungan, plus petugas yang konsisten rating rendah'],
  backup: ['Backup Database', 'Status backup pg_dump + verifikasi integritas file'],
  apikeys: ['API Keys', 'Token machine-to-machine untuk integrasi sistem lain'],
  webhooks: ['Webhooks', 'Daftarkan URL eksternal untuk menerima event sistem'],
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [page, setPage] = useState<PageKey>(() => {
    const h = location.hash.slice(1);
    if (isPage(h)) return h;
    // PETUGAS lands on the mobile app by default — they don't use the desktop shell.
    return useAuth.getState().user?.role === 'PETUGAS' ? 'mobile' : 'dashboard';
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

  // Ctrl+K / Cmd+K opens the global search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Build nav before any conditional return so hook order is stable across
  // bootstrap → login → dashboard transitions.
  const NAV = useNav();

  // Wire up SSE-driven query invalidation. Hook order must stay stable, so
  // this also runs before the conditional returns; the underlying connect
  // is no-op without a token.
  useEventStream();

  // Public feedback page — opened from an SMS link by the nasabah, who has
  // no account. Bypass auth + nav entirely; only the hash matters.
  const hash = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  const fbMatch = hash.match(/^feedback\/([a-f0-9]+)$/);
  if (fbMatch) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <ScreenFeedbackPublic token={fbMatch[1]} />
      </Suspense>
    );
  }

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

  // PETUGAS gets a chrome-less full-screen mobile experience. No sidebar,
  // no topbar — the device IS the app shell.
  if (user.role === 'PETUGAS') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <Suspense fallback={<ScreenFallback />}>
          <ScreenMobile />
        </Suspense>
        {(forceChange || showChangePw) && (
          <ChangePassword forced={forceChange} onClose={() => setShowChangePw(false)} />
        )}
      </div>
    );
  }

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

        <div className="sidebar-foot"
          style={{ background: page === 'settings' ? 'var(--accent-soft)' : 'var(--surface-2)' }}>
          <button onClick={() => go('settings')} type="button"
            aria-label="Buka pengaturan akun"
            style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
              background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer',
              padding: 0,
            }}>
            <Avatar inisial={user.nama.slice(0, 2).toUpperCase()} hue={162} size={36} />
            <div style={{ flex: 1, minWidth: 0 }} className="brand-text">
              <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.nama}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{user.role}</div>
            </div>
          </button>
          <button type="button" onClick={doLogout}
            title="Keluar" aria-label="Keluar"
            style={{
              padding: 6, cursor: 'pointer', display: 'grid', placeItems: 'center',
              background: 'transparent', border: 'none',
            }}>
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
          {user.branch && (
            <div className="chip" title={`Cabang Anda: ${user.branch.nama}`} aria-label={`Cabang ${user.branch.nama}`}>
              <Ic.layers size={13} aria-hidden="true" />
              {user.branch.nama}
            </div>
          )}
          {user.role === 'ADMIN' && !user.branch && (
            <div className="chip" style={{ background: 'var(--gold-soft)', color: 'var(--gold-ink)' }}
              title="ADMIN HQ — lihat semua cabang" aria-label="Admin HQ, melihat semua cabang">
              <Ic.layers size={13} aria-hidden="true" />
              Semua Cabang
            </div>
          )}
          <button className="search" onClick={() => setSearchOpen(true)}
            aria-label="Cari nasabah, petugas, transaksi (Ctrl+K)"
            style={{ width: 260, border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left' }}>
            <Ic.search size={16} aria-hidden="true" />
            <span style={{ flex: 1, color: 'var(--ink-4)', fontWeight: 500, fontSize: 13 }}>
              Cari nasabah, petugas, …
            </span>
            <kbd style={{
              fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
              background: 'var(--surface-2)', color: 'var(--ink-3)', border: '1px solid var(--line)',
            }}>Ctrl K</kbd>
          </button>
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
            {page === 'branch' && <ScreenBranch />}
            {page === 'audit' && <ScreenAudit />}
            {page === 'settings' && <ScreenSettings />}
            {page === 'users' && <ScreenUsers />}
            {page === 'petugas' && <ScreenPetugas />}
            {page === 'nasabah' && <ScreenNasabah />}
            {page === 'performa' && <ScreenPerforma />}
            {page === 'analytics' && <ScreenAnalytics />}
            {page === 'scorecard' && <ScreenScorecard />}
            {page === 'aging' && <ScreenAgingReport />}
            {page === 'attendance-map' && <ScreenAttendanceMap />}
            {page === 'churn' && <ScreenChurnRisk />}
            {page === 'activity' && <ScreenActivityFeed />}
            {page === 'leaderboard' && <ScreenLeaderboard />}
            {page === 'commission' && <ScreenCommission />}
            {page === 'escalation' && <ScreenEscalation />}
            {page === 'system-health' && <ScreenSystemHealth />}
            {page === 'notifikasi' && <ScreenNotifikasi go={go} />}
            {page === 'pengumuman' && <ScreenPengumuman />}
            {page === 'wilayah' && <ScreenWilayah />}
            {page === 'feedback' && <ScreenFeedback />}
            {page === 'backup' && <ScreenBackup />}
            {page === 'apikeys' && <ScreenApiKeys />}
            {page === 'webhooks' && <ScreenWebhooks />}
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

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={(p) => go(p)}
      />
    </div>
  );
}
