import { useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { tokenStore } from '../lib/api';
import { Map as MlMap, Marker, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Ic, type IconKey } from '../components/Icons';
import { InstallPrompt } from '../components/InstallPrompt';
import { Avatar, Badge, ImgPh, KolBadge, cssVar } from '../components/UI';
import { IOSDevice } from '../components/IosFrame';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  HASIL_KUNJUNGAN, KOL, RP, RPjt,
  useCreateKunjungan, useDeleteKunjungan, useEditKunjungan,
  useKunjunganList, useNasabahList, usePetugasList,
} from '../data/queries';
import { doLogout, useAuth } from '../lib/auth';
import { useGeolocationStream, type GeoFix } from '../lib/geolocation';
import { useScreenWakeLock } from '../lib/wakeLock';
import { distMeters, orderNearest } from '../lib/geo';
import { makeWatermarkedPreview } from '../lib/watermarkPreview';
import { clearPhotos, loadPhotos, savePhotos } from '../lib/photoStore';
import { enqueue as enqueueOffline } from '../lib/submitQueue';
import { useOfflineQueue } from '../lib/useOfflineQueue';
import { pushState, subscribePush, unsubscribePush } from '../lib/webPush';
import { clockIn, clockOut, getMyAttendance, type MyAttendance } from '../lib/attendance';
import { getMyZone, pointInPolygon, type ZoneInfo } from '../lib/wilayah';
import type { HasilKunjungan, Nasabah, Petugas } from '../types';

type Tab = 'beranda' | 'rute' | 'riwayat' | 'profil';

// Local-timezone YYYY-MM-DD. Using ISO/UTC would mis-bucket reports submitted
// between midnight WIB and 07:00 WIB into the previous day on the petugas's
// "Hari Ini" filter.
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Short label for the next-visit chip: "hari ini", "besok", "3 hari lagi",
// or a date when farther away. Past dates surface as "telat N hari".
function nextVisitLabel(iso: string): string {
  const target = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(target); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff < 0) return `telat ${Math.abs(diff)} hari`;
  if (diff === 0) return 'hari ini';
  if (diff === 1) return 'besok';
  if (diff <= 7) return `${diff} hari lagi`;
  return target.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function nextVisitTint(iso: string): string {
  const target = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(target); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff < 0) return 'var(--col-macet)';
  if (diff === 0) return 'var(--gold-ink)';
  if (diff <= 2) return 'var(--col-dpk)';
  return 'var(--ink-3)';
}

const MOBILE_STATE_KEY = 'bsn_mobile_state';
const LAPOR_DRAFT_KEY = 'bsn_lapor_draft';

interface MobileState { tab: Tab; reportForId: string | null }
interface LaporDraft {
  nasabahId: string;
  hasil: HasilKunjungan;
  nominal: string;
  catatan: string;
}

function loadMobileState(): MobileState | null {
  try {
    const v = sessionStorage.getItem(MOBILE_STATE_KEY);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
function saveMobileState(s: MobileState) {
  try { sessionStorage.setItem(MOBILE_STATE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
function loadLaporDraft(nasabahId: string): LaporDraft | null {
  try {
    const v = sessionStorage.getItem(LAPOR_DRAFT_KEY);
    if (!v) return null;
    const d = JSON.parse(v) as LaporDraft;
    return d.nasabahId === nasabahId ? d : null;
  } catch { return null; }
}
function saveLaporDraft(d: LaporDraft) {
  try { sessionStorage.setItem(LAPOR_DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode */ }
}
function clearLaporDraft() {
  try { sessionStorage.removeItem(LAPOR_DRAFT_KEY); } catch { /* ignore */ }
}

export function ScreenMobile() {
  const user = useAuth(s => s.user);
  const petugasQ = usePetugasList();
  const nasabahQ = useNasabahList();
  const { data: PETUGAS } = petugasQ;
  const { data: NASABAH } = nasabahQ;

  // For a real petugas user we look up their own row; supervisors previewing
  // the screen see the first petugas in their scope (the original demo).
  const isPetugasUser = user?.role === 'PETUGAS';
  const ME = isPetugasUser
    ? PETUGAS.find(p => p.id === user?.petugasId) ?? PETUGAS[0]
    : PETUGAS[0];

  // Today's priority list: nasabah yang jatuh tempo minggu ini (dueIn <= 7)
  // ATAU overdue, sortir paling kritis dulu (kol tertinggi → dpd terbesar).
  // Tetap dibatasi 10 supaya layar HP tidak overwhelm — sisanya bisa diakses
  // via dashboard. Definisi ini sinkron dengan `rencana` di petugasStats.
  const MY_TASKS = useMemo(() => {
    if (!ME) return [];
    const base = isPetugasUser
      ? NASABAH
      : NASABAH.filter(n => n.petugas === ME.id);
    return base
      .filter(n => n.dueIn <= 7)
      .sort((a, b) => (b.kol - a.kol) || (b.dpd - a.dpd) || (a.dueIn - b.dueIn))
      .slice(0, 10);
  }, [NASABAH, ME, isPetugasUser]);

  // Server-driven "done" set: nasabah yang sudah punya kunjungan hari ini.
  // Pakai react-query kunjungan list yang sudah di-invalidate setelah submit
  // — jadi konsisten dengan kartu hijau ME.kunjungan tanpa local state.
  const kunjunganQ = useKunjunganList();
  const doneSet = useMemo(() => {
    if (!ME) return new Set<string>();
    const today = localDateKey(new Date());
    const s = new Set<string>();
    for (const k of kunjunganQ.data ?? []) {
      if (k.petugas !== ME.id) continue;
      if (k.tanggal && localDateKey(new Date(k.tanggal)) !== today) continue;
      s.add(k.nasabah);
    }
    return s;
  }, [kunjunganQ.data, ME]);

  // Mobile UI state survives a process-kill via sessionStorage. Android Chrome
  // sometimes wipes the tab when the camera intent launches; without this
  // persistence the user lands back on Beranda after taking a photo. We only
  // restore IDs — the actual Nasabah object is looked up from MY_TASKS once
  // the queries hydrate.
  const persisted = loadMobileState();
  const [tab, setTab] = useState<Tab>(persisted?.tab ?? 'beranda');
  const [reportFor, setReportFor] = useState<Nasabah | null>(null);

  // Onboarding: tampil sekali untuk tiap akun petugas pertama kali login.
  // Disimpan localStorage supaya tidak ulang setiap reload. Tombol "Lihat
  // tutorial lagi" di tab Profil unset flag untuk replay manual.
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!isPetugasUser || !ME) return;
    try {
      const seen = localStorage.getItem(`bsn-lacak:onboarded:${ME.id}`);
      if (!seen) setShowOnboarding(true);
    } catch { /* private mode — show every time, no big deal */ }
  }, [isPetugasUser, ME]);
  const dismissOnboarding = () => {
    setShowOnboarding(false);
    if (ME) {
      try { localStorage.setItem(`bsn-lacak:onboarded:${ME.id}`, '1'); } catch { /* ignore */ }
    }
  };

  // Restore the open report form once tasks have loaded.
  useEffect(() => {
    if (reportFor) return;
    const id = loadMobileState()?.reportForId;
    if (!id) return;
    const n = MY_TASKS.find(t => t.id === id);
    if (n) setReportFor(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [MY_TASKS.length]);

  useEffect(() => {
    saveMobileState({ tab, reportForId: reportFor?.id ?? null });
  }, [tab, reportFor]);

  // Stream GPS to the backend (no-op when the user isn't a petugas — the
  // petugasId check inside the hook gates it out). The hook also exposes the
  // most recent fix so the Rute tab can order stops by nearest-neighbor from
  // wherever the petugas actually is right now.
  const { latest: hereFix, status: gpsStatus } = useGeolocationStream({
    petugasId: isPetugasUser ? user?.petugasId : null,
    enabled: isPetugasUser && !!ME,
  });

  // Fetch attendance status di level atas supaya wake lock bisa diaktifkan
  // selama sesi lapangan (clock-in → clock-out). Polling 60 dtk supaya
  // state sinkron walau petugas clock-out lewat tab Profil. Sederhana —
  // tidak perlu invalidate cache MProfil yang punya state sendiri.
  const [isClockedIn, setIsClockedIn] = useState(false);
  useEffect(() => {
    if (!isPetugasUser) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const a = await getMyAttendance();
        if (!cancelled) setIsClockedIn(!!a.current);
      } catch { /* offline atau session expired — biarkan state lama */ }
    };
    void tick();
    const iv = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [isPetugasUser]);

  // Wake lock aktif HANYA saat petugas clocked-in. Mencegah browser
  // suspend watchPosition saat layar HP idle / lock screen — gap GPS
  // tracking terbesar yang teridentifikasi (lihat ARCHITECTURE notes).
  // Tidak meminta wake lock saat di tab Profil/Riwayat juga — overhead
  // kecil tapi semakin tinggi compliance dengan Wake Lock API contract.
  const wakeLockStatus = useScreenWakeLock(isPetugasUser && isClockedIn);

  // Fetch the petugas's assigned wilayah polygon (if any) so we can draw it
  // on the rute map and surface a live "Anda di luar wilayah" warning.
  const [zone, setZone] = useState<ZoneInfo | null>(null);
  useEffect(() => {
    if (!isPetugasUser) return;
    (async () => {
      try {
        const r = await getMyZone();
        setZone(r.zone);
      } catch { /* ignore */ }
    })();
  }, [isPetugasUser]);

  // Drain any kunjungan that got queued offline. Returns pending count
  // for surfacing in the profile tab.
  const offline = useOfflineQueue();

  if (petugasQ.isPending || nasabahQ.isPending) {
    return <div className="content" style={{ maxWidth: 980, margin: '0 auto' }}><Skeleton h={600} /></div>;
  }
  if (petugasQ.error || nasabahQ.error) {
    return <div className="content"><ErrorState onRetry={() => { petugasQ.refetch(); nasabahQ.refetch(); }} /></div>;
  }
  if (!ME) {
    return <div className="content"><EmptyState title="Belum ada petugas terhubung" hint="Hubungi admin untuk menghubungkan akun Anda ke data petugas." /></div>;
  }

  const app = (
    <div className="m-shell-inner" style={{ fontFamily: 'var(--font)', background: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="m-scroll" style={{ paddingTop: isPetugasUser ? 12 : 54 }}>
        {isPetugasUser && <InstallPrompt />}
        {!reportFor && tab === 'beranda' && <MBeranda me={ME} tasks={MY_TASKS} onReport={setReportFor} doneSet={doneSet} here={hereFix} zone={zone} gpsStatus={gpsStatus} wakeLockStatus={wakeLockStatus} isClockedIn={isClockedIn} />}
        {!reportFor && tab === 'rute' && <MRute me={ME} tasks={MY_TASKS} onReport={setReportFor} here={hereFix} zone={zone} />}
        {!reportFor && tab === 'riwayat' && <MRiwayat me={ME} onLaporUlang={setReportFor} />}
        {!reportFor && tab === 'profil' && <MProfil me={ME} here={hereFix} pendingOffline={offline.pending} />}
        {reportFor && <MLapor n={reportFor} me={ME} here={hereFix} onClose={() => setReportFor(null)}
          onDone={() => { setReportFor(null); setTab('riwayat'); }} />}
      </div>
      {!reportFor && <MTabBar tab={tab} setTab={setTab}
        onReport={() => setReportFor(MY_TASKS.find(t => !doneSet.has(t.id)) || MY_TASKS[0])} />}
    </div>
  );

  // Petugas user → full-screen app (no iOS frame, no marketing column).
  // The shell topbar still chrome's the page; the page body fills with the
  // mobile UI flush. Mobile-first stylesheet handles the small viewport.
  if (isPetugasUser) {
    return (
      <div className="m-app m-shell">
        {app}
        {showOnboarding && <OnboardingTour onClose={dismissOnboarding} />}
      </div>
    );
  }

  // Supervisor preview: keep the iOS frame + marketing column.
  return (
    <div className="content" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 32, alignItems: 'start', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ position: 'relative' }}>
        <IOSDevice width={372} height={806}>{app}</IOSDevice>
      </div>

      <div style={{ paddingTop: 20, maxWidth: 420 }}>
        <span className="chip" style={{ marginBottom: 14 }}><Ic.user size={13} />Sisi Petugas Lapangan</span>
        <h2 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 12px' }}>Aplikasi mobile untuk kolektor di lapangan</h2>
        <p style={{ color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.65, margin: '0 0 22px' }}>
          Petugas membuka rute kunjungan harian, menagih, lalu mengisi laporan langsung di lokasi — lengkap dengan foto bukti dan validasi GPS otomatis. Semua tersinkron real-time ke dashboard supervisor.
        </p>
        {([
          { ic: 'home', t: 'Beranda & target harian', d: 'Ringkasan tugas, perolehan, dan progres target hari ini.' },
          { ic: 'route', t: 'Rute kunjungan optimal', d: 'Urutan nasabah binaan terdekat beserta status tunggakan.' },
          { ic: 'camera', t: 'Lapor kunjungan + foto', d: 'Foto bukti, hasil kunjungan, nominal, dan catatan — terkirim instan.' },
          { ic: 'location', t: 'Validasi lokasi otomatis', d: 'GPS memastikan petugas benar-benar berada di lokasi nasabah.' },
        ] as { ic: IconKey; t: string; d: string }[]).map((f, i) => {
          const Icon = Ic[f.ic];
          return (
            <div key={i} className="center gap-3" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
              <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', flex: 'none' }}><Icon size={18} /></div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{f.t}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 1, lineHeight: 1.45 }}>{f.d}</div>
              </div>
            </div>
          );
        })}
        <div className="card card-pad center gap-3" style={{ marginTop: 6, background: 'var(--accent-soft)', border: 'none' }}>
          <Ic.send size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-ink)' }}>Coba alur lapor: ketuk tombol <strong>+</strong> di tab bar aplikasi.</div>
        </div>
      </div>
    </div>
  );
}

function MHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="m-header">
      <div className="m-header-title">{title}</div>
      {sub && <div className="m-header-sub">{sub}</div>}
    </div>
  );
}

// Greeting + sisa target ringkas, dismissible per hari. Muncul saat
// petugas baru buka aplikasi di pagi hari — semacam shift briefing.
const BRIEFING_KEY = 'bsn_briefing_dismissed_at';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

// GPS health badge — surface ke petugas supaya tahu fix mereka cukup
// presisi untuk laporan diterima. Bukan blocker (laporan tetap bisa
// dikirim), tapi badge merah harus segera dia perbaiki di pengaturan
// browser/device sebelum naik motor.
// Onboarding 5-langkah untuk petugas baru. Modal full-screen overlay,
// progress dots, tombol "Selanjutnya" / "Mulai pakai" di akhir. Dismiss
// menyimpan flag di localStorage sehingga tidak muncul lagi (kecuali
// user tap "Lihat tutorial lagi" di tab Profil).
const ONBOARDING_STEPS = [
  {
    icon: 'clock' as const, title: 'Clock-In sekali di awal hari',
    body: 'Tap tombol Clock-In sebelum berangkat dari kantor. Masukkan KM odometer motor saat itu. Sesi lapangan dimulai dan GPS Anda akan dilacak otomatis.',
  },
  {
    icon: 'pin' as const, title: 'Pastikan GPS presisi',
    body: 'Cek badge GPS di tab Beranda. Hijau (presisi/standar) artinya siap. Merah artinya izin lokasi atau GPS device perlu diperbaiki sebelum jalan.',
  },
  {
    icon: 'phone' as const, title: 'Pasang HP di holder motor + colok charger',
    body: 'Saat berkendara, taruh HP di holder + sambungkan ke charger motor, dan biarkan aplikasi BSN Lacak tetap di depan. Aplikasi otomatis aktifkan "layar tetap nyala" agar GPS terus terlacak — kalau layar mati, jejak Anda bolong.',
  },
  {
    icon: 'clipboard' as const, title: 'Tap LAPOR per kunjungan',
    body: 'Di setiap nasabah, gunakan tombol "+" di bawah untuk submit laporan: foto bukti, hasil (bayar / janji / dll), dan nominal. JANGAN clock-in ulang per visit.',
  },
  {
    icon: 'route' as const, title: 'Kunjungi sesuai rute',
    body: 'Tab Rute menampilkan urutan kunjungan optimal berdasarkan posisi Anda. Boleh diabaikan, tapi mengikuti rute = hemat BBM.',
  },
  {
    icon: 'check' as const, title: 'Clock-Out saat kembali kantor',
    body: 'Tap Clock-Out di sore hari + masukkan KM akhir. JANGAN clock-out di tengah hari — Anda tidak bisa clock-in lagi sampai supervisor reset.',
  },
];

function OnboardingTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const cfg = ONBOARDING_STEPS[step];
  const Icon = cfg.icon === 'clock' ? Ic.clock
    : cfg.icon === 'pin' ? Ic.pin
    : cfg.icon === 'clipboard' ? Ic.clipboard
    : cfg.icon === 'route' ? Ic.route
    : cfg.icon === 'phone' ? Ic.phone
    : Ic.check;
  const isLast = step === ONBOARDING_STEPS.length - 1;
  return (
    <div role="dialog" aria-modal="true" aria-label="Tutorial penggunaan aplikasi"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(15, 23, 42, 0.66)',
        display: 'grid', placeItems: 'center', padding: 16,
      }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 22, maxWidth: 380, width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Icon hero */}
        <div style={{
          background: 'var(--accent-soft)', padding: '32px 16px 28px',
          display: 'grid', placeItems: 'center',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 22,
            background: 'var(--accent)', color: 'white',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 6px 18px oklch(0.55 0.14 156 / 0.45)',
          }}>
            <Icon size={36} />
          </div>
        </div>

        {/* Title + body */}
        <div style={{ padding: '22px 24px 8px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: 'var(--ink)' }}>
            {cfg.title}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>
            {cfg.body}
          </div>
        </div>

        {/* Progress dots */}
        <div className="center" style={{ gap: 6, padding: '12px 0 4px' }}>
          {ONBOARDING_STEPS.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 22 : 7, height: 7, borderRadius: 99,
              background: i === step ? 'var(--accent)' : 'var(--line-2)',
              transition: 'width .18s',
            }} />
          ))}
        </div>

        {/* Action row */}
        <div style={{ padding: '16px 18px 18px', display: 'flex', gap: 10 }}>
          {step > 0 && (
            <button className="btn" type="button"
              onClick={() => setStep(s => Math.max(0, s - 1))}
              style={{ flex: 1 }}>
              Sebelumnya
            </button>
          )}
          {!isLast ? (
            <>
              <button type="button" onClick={onClose}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--ink-4)',
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '0 6px',
                }}>
                Lewati
              </button>
              <button className="btn btn-primary" type="button"
                onClick={() => setStep(s => Math.min(ONBOARDING_STEPS.length - 1, s + 1))}
                style={{ flex: 2 }}>
                Selanjutnya
              </button>
            </>
          ) : (
            <button className="btn btn-primary" type="button" onClick={onClose}
              style={{ flex: 1 }}>
              Mulai pakai aplikasi
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GpsStatusBadge({ status, fix }: {
  status: import('../lib/geolocation').GeoStatus;
  fix: { lat: number; lng: number; accuracy: number | null; ts: number } | null;
}) {
  const MAP: Record<import('../lib/geolocation').GeoStatus, { bg: string; fg: string; icon: 'check' | 'alert' | 'clock' | 'cross'; label: string; hint: string }> = {
    idle:        { bg: 'var(--surface-2)',       fg: 'var(--ink-3)',     icon: 'clock', label: 'GPS belum aktif',          hint: 'Aktifkan saat clock-in.' },
    waiting:     { bg: 'oklch(0.93 0.05 75)',    fg: 'oklch(0.4 0.13 75)', icon: 'clock', label: 'Menunggu fix GPS…',         hint: 'Pastikan di luar ruangan.' },
    precise:     { bg: 'var(--col-lancar-soft)', fg: 'var(--col-lancar)',  icon: 'check', label: 'GPS presisi',                hint: '' },
    moderate:    { bg: 'var(--col-lancar-soft)', fg: 'var(--col-lancar)',  icon: 'check', label: 'GPS standar',                hint: '' },
    poor:        { bg: 'oklch(0.93 0.05 75)',    fg: 'oklch(0.4 0.13 75)', icon: 'alert', label: 'GPS lemah',                  hint: 'Mendekat ke ruang terbuka.' },
    coarse:      { bg: 'var(--col-macet-soft)',  fg: 'var(--col-macet)',   icon: 'alert', label: 'GPS tidak presisi',          hint: 'Aktifkan izin "Precise location" + GPS device.' },
    denied:      { bg: 'var(--col-macet-soft)',  fg: 'var(--col-macet)',   icon: 'cross', label: 'Izin lokasi ditolak',        hint: 'Buka pengaturan browser → izinkan lokasi.' },
    unavailable: { bg: 'var(--col-macet-soft)',  fg: 'var(--col-macet)',   icon: 'cross', label: 'GPS tidak tersedia',         hint: 'Aktifkan GPS device.' },
    timeout:     { bg: 'oklch(0.93 0.05 75)',    fg: 'oklch(0.4 0.13 75)', icon: 'clock', label: 'GPS lambat',                 hint: 'Tetap di luar ruangan beberapa detik.' },
  };
  const cfg = MAP[status];
  const Icon = cfg.icon === 'check' ? Ic.check : cfg.icon === 'alert' ? Ic.alert : cfg.icon === 'cross' ? Ic.x : Ic.clock;
  const ageSec = fix ? Math.round((Date.now() - fix.ts) / 1000) : null;
  const acc = fix?.accuracy != null ? `±${Math.round(fix.accuracy)} m` : null;
  return (
    <div className="center gap-2" style={{
      margin: '10px 16px 0', padding: '8px 12px', borderRadius: 12,
      background: cfg.bg, color: cfg.fg,
      fontSize: 12, fontWeight: 700,
    }}>
      <Icon size={14} />
      <span style={{ flex: 1 }}>
        {cfg.label}
        {acc && <span style={{ marginLeft: 6, fontWeight: 600, opacity: 0.85 }}>· {acc}</span>}
        {ageSec != null && ageSec < 3600 && (
          <span style={{ marginLeft: 6, fontWeight: 600, opacity: 0.7 }}>· {ageSec}s lalu</span>
        )}
      </span>
      {cfg.hint && <span style={{ fontWeight: 500, opacity: 0.85, fontSize: 11 }}>{cfg.hint}</span>}
    </div>
  );
}

// Wake Lock badge — surface ke petugas supaya tahu layar HP akan tetap
// nyala selama sesi lapangan (mencegah watchPosition disuspend browser
// di background). Tampil HANYA saat sedang clocked-in. Status 'denied'
// muncul rare (kalau page kehilangan focus context); 'unsupported' di
// browser lama (iOS Safari pre-16.4 dll).
function WakeLockBadge({ status, isClockedIn }: {
  status: import('../lib/wakeLock').WakeLockStatus;
  isClockedIn: boolean;
}) {
  if (!isClockedIn) return null;
  type Cfg = { bg: string; fg: string; icon: 'check' | 'alert' | 'cross'; label: string; hint: string };
  const MAP: Record<import('../lib/wakeLock').WakeLockStatus, Cfg> = {
    idle: {
      bg: 'oklch(0.93 0.05 75)', fg: 'oklch(0.4 0.13 75)', icon: 'alert',
      label: 'Layar bisa mati', hint: 'Tap layar untuk aktifkan auto-wake.',
    },
    active: {
      bg: 'var(--col-lancar-soft)', fg: 'var(--col-lancar)', icon: 'check',
      label: 'Layar tetap nyala', hint: '',
    },
    denied: {
      bg: 'var(--col-macet-soft)', fg: 'var(--col-macet)', icon: 'cross',
      label: 'Auto-wake diblok', hint: 'Tap layar atau interaksi tombol.',
    },
    unsupported: {
      bg: 'var(--surface-2)', fg: 'var(--ink-3)', icon: 'alert',
      label: 'Auto-wake tidak didukung', hint: 'Aktifkan "Stay awake" di Settings device.',
    },
  };
  const cfg = MAP[status];
  const Icon = cfg.icon === 'check' ? Ic.check : cfg.icon === 'alert' ? Ic.alert : Ic.x;
  return (
    <div className="center gap-2" style={{
      margin: '6px 16px 0', padding: '8px 12px', borderRadius: 12,
      background: cfg.bg, color: cfg.fg,
      fontSize: 12, fontWeight: 700,
    }}>
      <Icon size={14} />
      <span style={{ flex: 1 }}>{cfg.label}</span>
      {cfg.hint && <span style={{ fontWeight: 500, opacity: 0.85, fontSize: 11 }}>{cfg.hint}</span>}
    </div>
  );
}

function BriefingCard({ me, doneInTasks, tasksCount }: {
  me: Petugas; doneInTasks: number; tasksCount: number;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(BRIEFING_KEY) === todayKey(); }
    catch { return false; }
  });
  // Lazy holiday probe — single GET so an offline phone still renders the
  // briefing card without blocking. The chip only shows on hit; on error
  // we silently fall back to the regular briefing.
  const [holiday, setHoliday] = useState<{ name: string; type: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tok = (await import('../lib/api')).tokenStore.get();
        if (!tok) return;
        const r = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/holidays/today`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && d.holiday) setHoliday({ name: d.holiday.name, type: d.holiday.type });
      } catch { /* offline — ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (dismissed || tasksCount === 0) return null;

  const dismiss = () => {
    try { localStorage.setItem(BRIEFING_KEY, todayKey()); } catch { /* ignore */ }
    setDismissed(true);
  };

  const remaining = tasksCount - doneInTasks;
  const targetSisa = Math.max(0, me.target - me.terkumpul);

  return (
    <div style={{
      margin: '10px 16px 0', padding: '12px 14px', borderRadius: 14,
      background: 'linear-gradient(145deg, var(--gold-soft), var(--surface-2))',
      border: '1px solid var(--line)',
    }}>
      <div className="between">
        <div className="center gap-2">
          <span style={{ fontSize: 18 }}>👋</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13.5 }}>{greeting()}, {me.nama.split(' ')[0]}!</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
              Brief hari ini · {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
        </div>
        <button onClick={dismiss} aria-label="Tutup briefing"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4 }}>
          <Ic.x size={14} />
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.55 }}>
        {remaining > 0 ? (
          <>Anda punya <strong style={{ color: 'var(--gold-ink)' }}>{remaining} kunjungan</strong> menunggu hari ini.</>
        ) : (
          <>Semua jadwal sudah selesai 🎉</>
        )}
        {' '}
        Sisa target: <strong className="num">{RPjt(targetSisa)}</strong>.
      </div>
      {holiday && (
        <div className="center gap-2" style={{
          marginTop: 10, padding: '6px 10px', borderRadius: 10,
          background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
          fontSize: 11.5, fontWeight: 700,
        }}>
          <Ic.alert size={13} />
          Hari ini libur nasional: {holiday.name}
        </div>
      )}
    </div>
  );
}

function MBeranda({ me: ME, tasks: MY_TASKS, onReport, doneSet, here, zone, gpsStatus, wakeLockStatus, isClockedIn }: {
  me: Petugas; tasks: Nasabah[]; onReport: (n: Nasabah) => void; doneSet: Set<string>;
  // here memuat full GeoFix (accuracy + ts) supaya GpsStatusBadge bisa
  // tampilkan akurasi & umur fix; field lat/lng tetap dipakai zone check.
  here: GeoFix | null; zone: ZoneInfo | null;
  gpsStatus: import('../lib/geolocation').GeoStatus;
  wakeLockStatus: import('../lib/wakeLock').WakeLockStatus;
  isClockedIn: boolean;
}) {
  const pct = ME.target > 0 ? Math.round(ME.terkumpul / ME.target * 100) : 0;
  // Live "Anda di dalam zona?" computed from the latest GPS fix vs the
  // petugas's assigned polygon. Falls back silently if either is missing.
  const inZone = zone && here ? pointInPolygon(here.lat, here.lng, zone.polygon) : null;
  // "selesai" mengacu pada tugas hari ini (MY_TASKS) yang sudah dikunjungi —
  // bukan total kunjungan ME.kunjungan, karena petugas bisa kunjungi nasabah
  // di luar daftar prioritas.
  const doneInTasks = MY_TASKS.filter(t => doneSet.has(t.id)).length;
  return (
    <div>
      <BriefingCard me={ME} doneInTasks={doneInTasks} tasksCount={MY_TASKS.length} />
      <div className="m-status-stack">
        <GpsStatusBadge status={gpsStatus} fix={here} />
        <WakeLockBadge status={wakeLockStatus} isClockedIn={isClockedIn} />
      </div>
      {zone && inZone === false && (
        <div className="center gap-2" style={{
          margin: '10px 16px 0', padding: '10px 12px', borderRadius: 12,
          background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
          fontSize: 12.5, fontWeight: 700,
        }}>
          <Ic.alert size={15} />
          <span>Anda berada <u>di luar</u> wilayah binaan <strong>{zone.nama}</strong> — laporan akan ditandai untuk review.</span>
        </div>
      )}
      {zone && inZone === true && (
        <div className="center gap-2" style={{
          margin: '10px 16px 0', padding: '8px 12px', borderRadius: 12,
          background: 'var(--accent-soft)', color: 'var(--accent-ink)',
          fontSize: 12, fontWeight: 700,
        }}>
          <Ic.checkCircle size={14} />Di dalam wilayah {zone.nama}
        </div>
      )}
      <div style={{ padding: '8px 20px 0' }}>
        <div className="center gap-3">
          <Avatar inisial={ME.inisial} hue={ME.hue} size={44} />
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Selamat pagi,</div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{ME.nama}</div>
          </div>
        </div>
      </div>
      <div style={{
        margin: '16px 16px 0', borderRadius: 22, padding: 18, color: 'white',
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(145deg, var(--accent), var(--accent-700))',
        boxShadow: '0 10px 26px oklch(0.50 0.12 162 / 0.32)',
      }}>
        <div className="islamic-on-green" style={{ position: 'absolute', inset: 0, opacity: 0.08, pointerEvents: 'none' }} />
        <div className="between" style={{ position: 'relative' }}>
          <div>
            <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 600 }}>Tertagih hari ini</div>
            <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 2 }}>{RPjt(ME.terkumpul)}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }} className="num">target {RPjt(ME.target)}</div>
          </div>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
            <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="7" />
              <circle cx="32" cy="32" r="27" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${pct / 100 * 2 * Math.PI * 27} 999`} />
            </svg>
            <div className="num" style={{ position: 'absolute', fontWeight: 800, fontSize: 15 }}>{pct}%</div>
          </div>
        </div>
        <div className="center gap-2" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.2)', position: 'relative' }}>
          <MiniStatW label="Kunjungan / Jadwal" value={`${ME.kunjungan}/${ME.rencana}`} />
          <MiniStatW label="Sisa target" value={RPjt(ME.target - ME.terkumpul)} />
        </div>
      </div>

      <div className="m-section-head">
        <div className="m-section-title">Jadwal Hari Ini</div>
        <span className="m-section-meta">{doneInTasks}/{MY_TASKS.length} selesai</span>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {MY_TASKS.map((n, i) => {
          const isDone = doneSet.has(n.id);
          return (
            <button key={n.id} type="button" onClick={() => !isDone && onReport(n)}
              disabled={isDone}
              className={'m-task-card' + (isDone ? ' is-done' : '')}>
              <div className="m-task-num num">
                {isDone ? <Ic.check size={16} aria-hidden="true" /> : i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-task-name">{n.nama}</div>
                <div className="m-task-addr">{n.alamat}</div>
                {n.nextVisitAt && (
                  <div className="center gap-2" style={{
                    marginTop: 4, fontSize: 10.5, fontWeight: 700, color: nextVisitTint(n.nextVisitAt),
                  }}>
                    <Ic.clock size={10} aria-hidden="true" />Jadwal {nextVisitLabel(n.nextVisitAt)}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <KolBadge kol={n.kol} />
                <div className="num" style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{RP(n.angsuran)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniStatW({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>{label}</div>
      <div className="num" style={{ fontWeight: 800, fontSize: 15, marginTop: 1 }}>{value}</div>
    </div>
  );
}

// Default hub center (Depok area). Nasabah lat/lng isn't persisted yet, so we
// derive deterministic offsets from the nasabah id so markers cluster around
// the petugas's wilayah and don't jump between renders.
const RUTE_HUB = { lat: -6.4025, lng: 106.7942 };

function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

// Prefer the persisted coords. Fall back to a deterministic offset only when
// the nasabah row pre-dates the lat/lng feature so we never blank the map.
function stopCoords(n: Nasabah): { lat: number; lng: number } {
  if (typeof n.lat === 'number' && typeof n.lng === 'number') {
    return { lat: n.lat, lng: n.lng };
  }
  return {
    lat: RUTE_HUB.lat + (hash01(n.id, 1) - 0.5) * 0.04,
    lng: RUTE_HUB.lng + (hash01(n.id, 2) - 0.5) * 0.05,
  };
}

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY;
const MAPTILER_STYLE = import.meta.env.VITE_MAPTILER_STYLE || 'streets-v2';

// Sum of consecutive distances along a sequence of stops — used to show the
// distance saved when optimization is on.
function tourLength(stops: { lat: number; lng: number }[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distMeters(stops[i - 1], stops[i]);
  return total;
}

function MRute({ me: ME, tasks: MY_TASKS, onReport, here, zone }: {
  me: Petugas; tasks: Nasabah[]; onReport: (n: Nasabah) => void;
  here: { lat: number; lng: number } | null;
  zone: ZoneInfo | null;
}) {
  const accent = cssVar('--accent') || '#1f8a5b';
  const styleUrl = `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`;
  const [optimize, setOptimize] = useState(true);

  const rawStops = useMemo(
    () => MY_TASKS.map(n => ({ n, ...stopCoords(n) })),
    [MY_TASKS],
  );

  // Nearest-neighbor ordering from the current GPS fix; falls back to the
  // first stop as the start so the recommendation still works before the
  // first GPS fix arrives.
  const { stops, totalMeters } = useMemo(() => {
    if (!optimize || rawStops.length === 0) {
      return { stops: rawStops, totalMeters: tourLength(rawStops) };
    }
    const start = here ?? rawStops[0];
    const { ordered, meters } = orderNearest(start, rawStops);
    return { stops: ordered, totalMeters: meters };
  }, [rawStops, optimize, here]);

  const routeGeo = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: stops.length < 2 ? [] : [{
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: stops.map(s => [s.lng, s.lat] as [number, number]),
      },
    }],
  }), [stops]);

  const initialView = useMemo(() => {
    // Include the live "here" pin in the initial fit when we have one.
    const pts: { lat: number; lng: number }[] = [...stops];
    if (here) pts.push(here);
    if (pts.length === 0) {
      return { longitude: RUTE_HUB.lng, latitude: RUTE_HUB.lat, zoom: 12 };
    }
    if (pts.length === 1) {
      return { longitude: pts[0].lng, latitude: pts[0].lat, zoom: 13.5 };
    }
    const lats = pts.map(s => s.lat);
    const lngs = pts.map(s => s.lng);
    return {
      bounds: [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ] as [[number, number], [number, number]],
      fitBoundsOptions: { padding: 32 },
    };
    // Only refit when the set of stop ids changes, not on every GPS update —
    // otherwise the camera jumps every few seconds while the petugas walks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map(s => s.n.id).join(',')]);

  return (
    <div>
      <MHeader title="Rute Saya" sub={`${MY_TASKS.length} kunjungan · ${ME.wilayah}`} />
      <div style={{ margin: '0 16px 16px', borderRadius: 18, overflow: 'hidden', border: '1px solid var(--line)', height: 220, position: 'relative' }}>
        {MAPTILER_KEY ? (
          <MlMap
            initialViewState={initialView}
            style={{ width: '100%', height: '100%' }}
            mapStyle={styleUrl}
            attributionControl={{ compact: true }}>
            {zone && (
              <Source id="rute-zone" type="geojson"
                data={{ type: 'Feature', properties: {}, geometry: zone.polygon }}>
                <Layer id="rute-zone-fill" type="fill"
                  paint={{ 'fill-color': accent, 'fill-opacity': 0.10 }} />
                <Layer id="rute-zone-line" type="line"
                  paint={{ 'line-color': accent, 'line-width': 1.5, 'line-dasharray': [2, 2] }} />
              </Source>
            )}
            <Source id="rute-line" type="geojson" data={routeGeo}>
              <Layer
                id="rute-line-stroke"
                type="line"
                paint={{ 'line-color': accent, 'line-width': 4, 'line-opacity': 0.85 }}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              />
            </Source>
            {stops.map((s, i) => (
              <Marker key={s.n.id} longitude={s.lng} latitude={s.lat} anchor="center"
                onClick={(e) => { e.originalEvent.stopPropagation(); onReport(s.n); }}>
                <div className="num" style={{
                  width: 26, height: 26, borderRadius: 99, background: accent, color: 'white',
                  display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12,
                  border: '2.5px solid white', boxShadow: '0 2px 6px rgba(0,0,0,0.35)', cursor: 'pointer',
                }}>{i + 1}</div>
              </Marker>
            ))}
            {here && (
              <Marker longitude={here.lng} latitude={here.lat} anchor="center">
                <div style={{ position: 'relative', width: 22, height: 22 }} title="Posisi Anda">
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 99,
                    background: '#3b82f6', opacity: 0.25, animation: 'mlpulse 2.2s ease-out infinite',
                  }} />
                  <div style={{
                    position: 'absolute', inset: 5, borderRadius: 99,
                    background: '#3b82f6', border: '3px solid white',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  }} />
                </div>
              </Marker>
            )}
          </MlMap>
        ) : (
          <div className="center gap-2" style={{ height: '100%', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 12.5, fontWeight: 600, background: 'var(--surface-2)' }}>
            <Ic.alert size={14} />Map key belum dipasang
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'var(--ink)', color: 'white', borderRadius: 8, padding: '4px 9px', fontSize: 11, fontWeight: 700 }} className="center gap-2">
          <Ic.nav size={12} />{stops.length} stop · {(totalMeters / 1000).toFixed(1)} km
        </div>
      </div>
      <div style={{ margin: '0 16px 12px' }}>
        <div className="m-settings-row" style={{ borderBottom: 'none', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}>
          <div className="m-settings-ic">
            <Ic.route size={16} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="m-settings-label">Optimasi Rute</div>
            <div className="m-settings-value" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)' }}>
              {here
                ? 'Urut dari posisi Anda · nearest-neighbor'
                : 'Menunggu GPS · urut dari stop pertama'}
            </div>
          </div>
          <button type="button"
            className={'m-switch' + (optimize ? ' is-on' : '')}
            onClick={() => setOptimize(v => !v)}
            aria-label={optimize ? 'Matikan optimasi rute' : 'Nyalakan optimasi rute'}
            aria-pressed={optimize} />
        </div>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {MY_TASKS.map((n, i) => (
          <div key={n.id} className="m-stop-card">
            <div className="m-stop-num">
              <span className="m-stop-num-pill num">{i + 1}</span>
              {i < MY_TASKS.length - 1 && <span className="m-stop-num-line" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{n.nama}</div>
              <div className="center gap-2" style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                <Ic.pin size={12} aria-hidden="true" />{n.alamat}
              </div>
            </div>
            <button onClick={() => onReport(n)} className="btn-action is-primary" type="button" style={{ flex: 'none', minHeight: 36, padding: '8px 14px' }}>
              Lapor
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MRiwayat({ me: ME, onLaporUlang }: { me: Petugas; onLaporUlang: (n: Nasabah) => void }) {
  const kunjunganQ = useKunjunganList();
  const nasabahQ = useNasabahList();
  const { data: ALL_K } = kunjunganQ;
  const { data: ALL_N } = nasabahQ;
  const [scope, setScope] = useState<'today' | 'all'>('today');
  const [editing, setEditing] = useState<import('../types').Kunjungan | null>(null);
  const delMut = useDeleteKunjungan();
  const [delErr, setDelErr] = useState<string | null>(null);

  const nasabahById = useMemo(() => {
    const m = new Map<string, Nasabah>();
    for (const n of ALL_N) m.set(n.id, n);
    return m;
  }, [ALL_N]);

  // Server already scopes to ME via PETUGAS role; the filter is defensive
  // for supervisor preview and back-compat with mock mode.
  const mine = useMemo(() => {
    const today = localDateKey(new Date());
    return ALL_K.filter(k => {
      if (k.petugas !== ME.id) return false;
      if (scope === 'today' && k.tanggal && localDateKey(new Date(k.tanggal)) !== today) return false;
      return true;
    });
  }, [ALL_K, ME.id, scope]);

  if (kunjunganQ.isPending) {
    return <div className="content"><Skeleton h={400} /></div>;
  }

  return (
    <div>
      <MHeader title="Riwayat" sub={`${mine.length} laporan ${scope === 'today' ? 'hari ini' : 'tersimpan'}`} />
      <div className="m-chip-group">
        {([
          { k: 'today' as const, label: 'Hari Ini' },
          { k: 'all' as const, label: 'Semua' },
        ]).map(t => (
          <button key={t.k} type="button" onClick={() => setScope(t.k)}
            className={'m-chip' + (scope === t.k ? ' is-on' : '')}
            aria-pressed={scope === t.k}>{t.label}</button>
        ))}
      </div>
      {mine.length === 0 ? (
        <div className="m-empty">
          <div className="m-empty-icon">
            <Ic.clipboard size={28} aria-hidden="true" />
          </div>
          <div className="m-empty-title">Belum ada laporan</div>
          <div className="m-empty-body">Laporan kunjungan yang Anda kirim akan muncul di sini.</div>
        </div>
      ) : (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mine.map(k => {
            const n = nasabahById.get(k.nasabah);
            const meta = HASIL_KUNJUNGAN[k.hasil];
            const photo = k.fotoUrls?.[0];
            return (
              <div key={k.id} className="m-visit-card">
                {photo ? (
                  <img src={photo} alt={`Foto kunjungan ${n?.nama ?? ''}`} />
                ) : (
                  <ImgPh label={`◦ tanpa foto ◦`} h={88} style={{ borderRadius: 0, border: 'none' }} />
                )}
                <div className="m-visit-body">
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{n?.nama ?? '—'}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {k.lokasi || n?.alamat || '—'}
                      </div>
                    </div>
                    <Badge c={meta.c} soft={meta.soft} icon={Ic.checkCircle}>{meta.label}</Badge>
                  </div>
                  {k.hasil === 'bayar' && k.nominal > 0 && (
                    <div className="num" style={{ fontWeight: 800, fontSize: 16, color: 'var(--accent)', marginTop: 6 }}>
                      {RP(k.nominal)}
                    </div>
                  )}
                  {k.catatan && (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 6, lineHeight: 1.45 }}>
                      {k.catatan}
                    </div>
                  )}
                  <div className="muted center gap-2" style={{ fontSize: 11.5, marginTop: 8 }}>
                    <Ic.location size={11} style={{ color: 'var(--accent)' }} />
                    {k.valid ? 'Lokasi tervalidasi' : 'Lokasi tidak tervalidasi'}
                    <span style={{ opacity: 0.5 }}>·</span>
                    <Ic.clipboard size={11} />{k.jam}
                  </div>

                  {k.reviewStatus === 'PENDING' && (
                    <div className="center gap-2" style={{
                      marginTop: 10, padding: '7px 10px', borderRadius: 10,
                      background: 'var(--gold-soft)', color: 'var(--gold-ink)',
                      fontSize: 12, fontWeight: 700,
                    }}>
                      <Ic.clock size={13} />Menunggu review supervisor
                    </div>
                  )}
                  {k.reviewStatus === 'APPROVED' && (
                    <div className="center gap-2" style={{
                      marginTop: 10, padding: '7px 10px', borderRadius: 10,
                      background: 'var(--accent-soft)', color: 'var(--accent-ink)',
                      fontSize: 12, fontWeight: 700,
                    }}>
                      <Ic.checkCircle size={13} />Disetujui supervisor
                      {k.reviewNote && (
                        <span style={{ fontWeight: 500, opacity: 0.9, marginLeft: 4 }}>· {k.reviewNote}</span>
                      )}
                    </div>
                  )}
                  {k.reviewStatus === 'REJECTED' && (
                    <div style={{
                      marginTop: 10, padding: '8px 10px', borderRadius: 10,
                      background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
                    }}>
                      <div className="center gap-2" style={{ fontSize: 12, fontWeight: 700 }}>
                        <Ic.alert size={13} />Ditolak supervisor
                      </div>
                      {k.reviewNote && (
                        <div style={{ fontSize: 11.5, fontWeight: 500, marginTop: 4, lineHeight: 1.4 }}>
                          {k.reviewNote}
                        </div>
                      )}
                      {n && (
                        <button onClick={() => onLaporUlang(n)} className="btn btn-sm"
                          style={{
                            marginTop: 8, background: 'var(--col-macet)', color: 'white',
                            border: 'none', width: '100%',
                          }}>
                          <Ic.camera size={14} />Lapor Ulang
                        </button>
                      )}
                    </div>
                  )}
                  {(() => {
                    // Edit/delete window: 30 min from createdAt, PENDING only.
                    // Server is the source of truth; this just hides buttons
                    // when they'd certainly fail so the petugas isn't tempted.
                    if (k.reviewStatus !== 'PENDING') return null;
                    if (!k.createdAt) return null;
                    const ageMin = (Date.now() - new Date(k.createdAt).getTime()) / 60_000;
                    if (ageMin > 30) return null;
                    const remaining = Math.max(0, Math.round(30 - ageMin));
                    return (
                      <div className="center gap-2" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                        <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                          Bisa diedit/hapus {remaining} mnt lagi
                        </span>
                        <div className="center gap-2">
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(k)}
                            style={{ padding: '5px 10px', fontSize: 11.5 }}>
                            <Ic.settings size={12} />Edit
                          </button>
                          <button className="btn btn-sm" onClick={() => {
                            if (!confirm('Hapus laporan ini? Tindakan tidak bisa dibatalkan.')) return;
                            setDelErr(null);
                            delMut.mutate(k.id, {
                              onError: (e: any) => {
                                const code = e?.response?.data?.error;
                                setDelErr(code === 'edit_window_expired' ? 'Window 30 menit sudah lewat.'
                                  : code === 'already_reviewed' ? 'Sudah direview supervisor.'
                                  : 'Gagal menghapus.');
                              },
                            });
                          }}
                            style={{
                              padding: '5px 10px', fontSize: 11.5,
                              background: 'var(--col-macet-soft)', color: 'var(--col-macet)', border: 'none',
                            }}>
                            <Ic.x size={12} />Hapus
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {delErr && (
        <div className="center gap-2" style={{
          margin: '0 16px 12px', background: 'var(--col-macet-soft)',
          color: 'var(--col-macet)', borderRadius: 10, padding: '8px 12px',
          fontSize: 12.5, fontWeight: 600,
        }}>
          <Ic.alert size={14} />{delErr}
        </div>
      )}
      {editing && (
        <EditKunjunganModal k={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function EditKunjunganModal({ k, onClose }: {
  k: import('../types').Kunjungan; onClose: () => void;
}) {
  const editMut = useEditKunjungan();
  const [hasil, setHasil] = useState<HasilKunjungan>(k.hasil);
  const [nominal, setNominal] = useState(String(k.nominal));
  const [catatan, setCatatan] = useState(k.catatan);
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    setErr(null);
    editMut.mutate(
      { id: k.id, patch: { hasil, nominal: Number(nominal), catatan } },
      {
        onSuccess: onClose,
        onError: (e: any) => {
          const code = e?.response?.data?.error;
          setErr(code === 'edit_window_expired' ? 'Window 30 menit sudah lewat.'
            : code === 'already_reviewed' ? 'Sudah direview supervisor.'
            : 'Gagal menyimpan.');
        },
      },
    );
  };

  return (
    <div role="dialog" aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: '20px 20px 0 0',
          padding: 16, width: '100%', maxWidth: 480, display: 'grid', gap: 12,
        }}>
        <div className="between">
          <div style={{ fontWeight: 800, fontSize: 15 }}>Edit Laporan</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
        </div>
        <div>
          <MLabel>Hasil</MLabel>
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(Object.entries(HASIL_KUNJUNGAN) as [HasilKunjungan, typeof HASIL_KUNJUNGAN[HasilKunjungan]][]).map(([key, v]) => (
              <button key={key} onClick={() => setHasil(key)} style={{
                padding: '10px 8px', borderRadius: 12, fontWeight: 700, fontSize: 12,
                border: hasil === key ? `1.5px solid ${v.c}` : '1px solid var(--line)',
                background: hasil === key ? v.soft : 'var(--surface)',
                color: hasil === key ? v.c : 'var(--ink-2)',
              }}>{v.label}</button>
            ))}
          </div>
        </div>
        {hasil === 'bayar' && (
          <div>
            <MLabel>Nominal</MLabel>
            <div className="search" style={{ background: 'var(--surface)' }}>
              <span style={{ fontWeight: 800, color: 'var(--ink-3)' }}>Rp</span>
              <input value={Number(nominal).toLocaleString('id-ID')} inputMode="numeric"
                onChange={e => setNominal(e.target.value.replace(/\D/g, ''))}
                style={{ fontWeight: 700 }} />
            </div>
          </div>
        )}
        <div>
          <MLabel>Catatan</MLabel>
          <textarea className="input" rows={3} value={catatan} onChange={e => setCatatan(e.target.value)}
            style={{ resize: 'none' }} />
        </div>
        {err && (
          <div className="center gap-2" style={{
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600,
          }}>
            <Ic.alert size={14} />{err}
          </div>
        )}
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button className="btn" onClick={onClose} disabled={editMut.isPending}>Batal</button>
          <button className="btn btn-primary" onClick={save} disabled={editMut.isPending}>
            {editMut.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtElapsed(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} menit`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
}

function MProfil({ me: ME, here, pendingOffline }: { me: Petugas; here: { lat: number; lng: number } | null; pendingOffline: number }) {
  const user = useAuth(s => s.user);
  const pct = ME.target > 0 ? Math.round(ME.terkumpul / ME.target * 100) : 0;
  const [push, setPush] = useState<{ supported: boolean; permission: NotificationPermission; subscribed: boolean } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [att, setAtt] = useState<MyAttendance | null>(null);
  const [attBusy, setAttBusy] = useState(false);

  useEffect(() => {
    void (async () => setPush(await pushState()))();
    void refreshAtt();
  }, []);

  const refreshAtt = async () => {
    try { setAtt(await getMyAttendance()); } catch { /* ignore */ }
  };

  // Tick label every 60s so "Lapangan sejak HH:MM" stays current.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const toggleAtt = async () => {
    if (attBusy) return;
    setAttBusy(true);
    try {
      const coords = here ? { lat: here.lat, lng: here.lng } : {};
      if (att?.current) {
        if (!window.confirm('Akhiri sesi lapangan?')) { setAttBusy(false); return; }
        const raw = window.prompt('KM odometer saat ini (kosongkan jika tidak pakai kendaraan dinas)') ?? '';
        const km = raw.trim() === '' ? undefined : Number(raw.replace(/[^\d]/g, ''));
        await clockOut({ ...coords, ...(Number.isFinite(km) ? { km } : {}) });
      } else {
        const raw = window.prompt('KM odometer saat ini (kosongkan jika tidak pakai kendaraan dinas)') ?? '';
        const km = raw.trim() === '' ? undefined : Number(raw.replace(/[^\d]/g, ''));
        await clockIn({ ...coords, ...(Number.isFinite(km) ? { km } : {}) });
      }
      await refreshAtt();
    } catch (e: any) {
      const code = e?.response?.data?.error;
      if (code === 'already_clocked_in') alert('Anda sudah clock-in.');
      else if (code === 'not_clocked_in') alert('Belum clock-in.');
      else if (code === 'km_end_below_start') alert('KM akhir tidak boleh lebih kecil dari KM awal.');
      else alert('Gagal. Coba lagi.');
    } finally {
      setAttBusy(false);
    }
  };

  const togglePush = async () => {
    if (pushBusy || !push) return;
    setPushBusy(true);
    try {
      if (push.subscribed) {
        await unsubscribePush();
      } else {
        const r = await subscribePush();
        if (!r.ok && r.reason === 'permission') alert('Anda harus mengizinkan notifikasi di pengaturan browser.');
      }
      setPush(await pushState());
    } finally {
      setPushBusy(false);
    }
  };

  const handleLogout = () => {
    if (window.confirm('Keluar dari aplikasi?')) void doLogout();
  };

  return (
    <div>
      <MHeader title="Profil" sub={user?.branch?.nama ?? ME.wilayah} />

      <div style={{ margin: '0 16px 16px' }}>
        <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar inisial={ME.inisial} hue={ME.hue} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>{ME.nama}</div>
            <div className="muted mono" style={{ fontSize: 12, marginTop: 2 }}>
              {user?.username ?? '—'} · {user?.role ?? 'PETUGAS'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="card card-pad">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
            Capaian Hari Ini
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <ProfilStat label="Tertagih" value={RPjt(ME.terkumpul)} accent />
            <ProfilStat label="Target" value={RPjt(ME.target)} />
            <ProfilStat label="Kunjungan" value={`${ME.kunjungan}/${ME.rencana}`} />
            <ProfilStat label="% Pencapaian" value={`${pct}%`} accent />
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <ProfilRow icon="user" label="Wilayah Binaan" value={ME.wilayah} />
          <ProfilRow icon="phone" label="No. HP" value={ME.hp} />
          <ProfilRow icon="layers" label="Cabang" value={user?.branch?.nama ?? '—'} last />
        </div>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <button type="button" onClick={toggleAtt} disabled={attBusy}
          className={'m-session-card' + (att?.current ? '' : ' is-idle')}>
          <div className="m-session-icon">
            <Ic.clock size={20} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="m-session-label">Sesi Lapangan</div>
            <div className="m-session-state">
              {att?.current
                ? `Aktif sejak ${new Date(att.current.clockInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
                : 'Belum clock-in'}
            </div>
            {att?.current && (
              <div className="m-session-meta">
                {fmtElapsed(Date.now() - new Date(att.current.clockInAt).getTime())} di lapangan
              </div>
            )}
          </div>
          <span className="m-session-cta">
            {att?.current ? 'Selesai' : 'Mulai'}
          </span>
        </button>
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <div className="m-card">
          <div className="m-settings-row">
            <div className="m-settings-ic">
              <Ic.send size={17} aria-hidden="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="m-settings-label">Antrian Offline</div>
              <div className="m-settings-value">
                {pendingOffline === 0 ? 'Tidak ada laporan tertunda' : `${pendingOffline} laporan menunggu kirim`}
              </div>
            </div>
          </div>
          <div className="m-settings-row">
            <div className="m-settings-ic">
              <Ic.bell size={17} aria-hidden="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="m-settings-label">Notifikasi Push</div>
              <div className="m-settings-value">
                {!push?.supported ? 'Tidak didukung di browser ini'
                  : push.subscribed ? 'Aktif — alert OS aktif'
                  : push.permission === 'denied' ? 'Diblokir — buka pengaturan browser'
                  : 'Nyalakan untuk notifikasi review/assignment'}
              </div>
            </div>
            {push?.supported && push.permission !== 'denied' && (
              <button type="button" onClick={togglePush} disabled={pushBusy}
                className={'m-switch' + (push.subscribed ? ' is-on' : '')}
                aria-label={push.subscribed ? 'Matikan notifikasi push' : 'Nyalakan notifikasi push'}
                aria-pressed={push.subscribed} />
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <button type="button" className="btn"
          onClick={() => {
            try { localStorage.removeItem(`bsn-lacak:onboarded:${ME.id}`); } catch { /* ignore */ }
            window.location.reload();
          }}
          style={{ width: '100%', padding: 12, fontSize: 13.5, fontWeight: 700 }}>
          <Ic.eye size={15} />Lihat tutorial lagi
        </button>
      </div>

      <div style={{ padding: '0 16px 28px' }}>
        <button onClick={handleLogout} className="btn"
          style={{
            width: '100%', padding: 13, fontSize: 14, fontWeight: 700,
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)', border: 'none',
          }}>
          <Ic.logout size={16} />Keluar
        </button>
        <div className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 14 }}>
          BSN Lacak · v0.1.0
        </div>
      </div>
    </div>
  );
}

function ProfilStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'var(--accent-soft)' : 'var(--surface-2)',
      borderRadius: 12, padding: '10px 12px',
    }}>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div className="num" style={{
        fontSize: 16, fontWeight: 800, marginTop: 3,
        color: accent ? 'var(--accent-ink)' : 'var(--ink)',
      }}>{value}</div>
    </div>
  );
}

function ProfilRow({ icon, label, value, last = false }: { icon: IconKey; label: string; value: string; last?: boolean }) {
  const Icon = Ic[icon];
  return (
    <div className="center gap-3" style={{
      padding: '12px 14px',
      borderBottom: last ? 'none' : '1px solid var(--line)',
    }}>
      <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', flex: 'none', width: 32, height: 32 }}>
        <Icon size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      </div>
    </div>
  );
}

function MLapor({ n, me: ME, here, onClose, onDone }: {
  n: Nasabah; me: Petugas; here: GeoFix | null;
  onClose: () => void; onDone: (id: string) => void;
}) {
  const create = useCreateKunjungan();
  // Restore any draft from a prior tab-kill so the form survives an Android
  // camera roundtrip. Photos are File objects and can't be persisted — those
  // need to be retaken if the tab process was killed.
  const draft = loadLaporDraft(n.id);
  const [hasil, setHasil] = useState<HasilKunjungan>(draft?.hasil ?? 'bayar');
  const [nominal, setNominal] = useState(draft?.nominal ?? String(n.angsuran));
  // `photos` keeps the ORIGINAL camera bytes so the server's EXIF check
  // (lapis C) still sees real metadata. `previews` holds canvas-watermarked
  // data URLs purely for the in-form thumbnail so the petugas can see the
  // stamp immediately after taking the photo.
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [catatan, setCatatan] = useState(draft?.catatan ?? '');
  // Date picker for backdating up to BACKDATE_MAX_DAYS (= 7) in the past.
  // Defaults to today; petugas can pick yesterday/-2/-3 etc. when logging
  // a visit they actually did earlier. Server rejects future dates and
  // anything older than the window.
  const [tanggal, setTanggal] = useState<string>(() => localDateKey(new Date()));
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);

  const todayKeyStr = localDateKey(new Date());
  const minDateStr = (() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return localDateKey(d);
  })();

  // Persist the draft on every change so a camera intent that kills the tab
  // doesn't take the typed input with it.
  useEffect(() => {
    saveLaporDraft({ nasabahId: n.id, hasil, nominal, catatan });
  }, [n.id, hasil, nominal, catatan]);

  // Restore photos from IndexedDB if the tab was killed mid-form. We
  // regenerate previews from the loaded files (data URLs aren't persisted).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await loadPhotos(n.id);
      if (cancelled || restored.length === 0) return;
      setPhotos(restored);
      const ps = await Promise.all(restored.map(f => makeWatermarkedPreview(f, {
        petugasNama: ME.nama,
        nasabahNama: n.nama,
        timestamp: new Date(),
        lat: here?.lat,
        lng: here?.lng,
      })));
      if (!cancelled) setPreviews(ps);
    })();
    return () => { cancelled = true; };
    // Only restore once per form open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id]);

  // Mirror the live photo array to IDB so a tab-kill mid-capture doesn't
  // lose the photos already taken. Cleared on submit / cancel.
  useEffect(() => {
    if (photos.length === 0) {
      void clearPhotos(n.id);
    } else {
      void savePhotos(n.id, photos);
    }
  }, [photos, n.id]);

  const handleClose = () => { clearLaporDraft(); void clearPhotos(n.id); onClose(); };
  const handleDone = (id: string) => { clearLaporDraft(); void clearPhotos(n.id); onDone(id); };

  const foto = photos.length;
  const MAX_PHOTOS = 3;
  const MAX_BYTES = 8 * 1024 * 1024;   // matches backend multer limit

  const addPhoto = async (file: File) => {
    setErr(null);
    if (!/^image\//.test(file.type)) {
      setErr('File harus berupa gambar.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr('Foto maksimum 8 MB.');
      return;
    }
    const preview = await makeWatermarkedPreview(file, {
      petugasNama: ME.nama,
      nasabahNama: n.nama,
      timestamp: new Date(),
      lat: here?.lat,
      lng: here?.lng,
    });
    setPhotos(p => [...p, file].slice(0, MAX_PHOTOS));
    setPreviews(p => [...p, preview].slice(0, MAX_PHOTOS));
  };
  const removePhoto = (i: number) => {
    setPhotos(p => p.filter((_, idx) => idx !== i));
    setPreviews(p => p.filter((_, idx) => idx !== i));
  };

  // Capture a fresh GPS fix at submit time so the server can run the
  // gps-vs-nasabah plausibility check. Falls back silently if the user
  // didn't grant permission — server records "gps_missing" instead.
  const getCurrentPosition = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 15_000 },
      );
    });

  const submit = async () => {
    setErr(null);
    if (photos.length === 0) return;
    setSending(true);
    try {
      const here = await getCurrentPosition();
      await create.mutateAsync({
        nasabah: n.id, petugas: ME.id, hasil, nominal: Number(nominal),
        catatan, lokasi: n.alamat, photos,
        lat: here?.lat, lng: here?.lng,
        // Only send tanggal when the petugas actually backdated — keeps the
        // server default (now) for the common case.
        ...(tanggal !== todayKeyStr ? { tanggal } : {}),
      });
      setTimeout(() => handleDone(n.id), 600);
    } catch (e: any) {
      const code = e?.response?.data?.error;
      const status = e?.response?.status;
      // Surface unambiguous validation errors immediately.
      if (code === 'invalid_file_type') { setErr('File tidak dikenali sebagai foto. Coba foto ulang.'); setSending(false); return; }
      if (status === 413) { setErr('Foto terlalu besar.'); setSending(false); return; }
      // If there's no HTTP response at all, treat as offline and queue.
      const isOffline = !status || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (isOffline) {
        try {
          const here2 = await getCurrentPosition();
          await enqueueOffline({
            nasabah: n.id, petugas: ME.id, hasil, nominal: Number(nominal),
            catatan, lokasi: n.alamat, lat: here2?.lat, lng: here2?.lng,
          }, photos);
          setErr('Tersimpan offline. Akan dikirim otomatis saat online.');
          setTimeout(() => handleDone(n.id), 1200);
          return;
        } catch {
          setErr('Tidak online dan gagal menyimpan offline. Coba lagi.');
          setSending(false);
          return;
        }
      }
      setErr('Gagal mengirim laporan. Periksa koneksi.');
      setSending(false);
    }
  };

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="between" style={{ padding: '8px 16px 12px' }}>
        <button onClick={handleClose} className="btn btn-ghost btn-sm"><Ic.x size={16} />Batal</button>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Lapor Kunjungan</div>
        <span style={{ width: 56 }} />
      </div>
      <div style={{ flex: 1, padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 13 }} className="center gap-3">
          <div className="stat-ic" style={{ background: KOL[n.kol].soft, color: KOL[n.kol].ink }}><Ic.user size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{n.nama}</div>
            <div className="muted" style={{ fontSize: 12 }}>{n.alamat}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowGallery(true)}>
            <Ic.eye size={14} />Galeri
          </button>
          <KolBadge kol={n.kol} />
        </div>
        {showGallery && (
          <NasabahPhotoGalleryModal nasabahId={n.id} nasabahNama={n.nama}
            onClose={() => setShowGallery(false)} />
        )}

        <div>
          <MLabel>Foto Bukti Kunjungan</MLabel>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            {[0, 1, 2].map(i => {
              const file = photos[i];
              if (file) {
                // previews[i] is a data URL produced by the canvas watermarker;
                // fall back to the raw object URL while it's still resolving.
                const src = previews[i] ?? URL.createObjectURL(file);
                return (
                  <div key={i} style={{
                    position: 'relative', height: 76, borderRadius: 12, overflow: 'hidden',
                    background: 'var(--ink)', boxShadow: 'inset 0 0 0 1.5px var(--accent)',
                  }}>
                    <img src={src} alt={`Foto ${i + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <button type="button" onClick={() => removePhoto(i)}
                      aria-label={`Hapus foto ${i + 1}`}
                      style={{
                        position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                        borderRadius: 99, border: 'none', background: 'rgba(0,0,0,0.6)',
                        color: 'white', display: 'grid', placeItems: 'center', cursor: 'pointer',
                      }}>
                      <Ic.x size={13} />
                    </button>
                  </div>
                );
              }
              return (
                <label key={i} style={{
                  height: 76, borderRadius: 12, border: '1.5px dashed var(--line-2)',
                  background: 'var(--surface-2)', color: 'var(--ink-4)', display: 'grid', placeItems: 'center',
                  cursor: 'pointer',
                }}>
                  <input type="file" accept="image/*" capture="environment"
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) addPhoto(f); e.target.value = ''; }}
                    aria-label={`Ambil foto ${i + 1}`} />
                  <Ic.camera size={20} aria-hidden="true" />
                </label>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            {foto > 0 ? `${foto} foto siap kirim` : 'Ketuk untuk ambil foto dari kamera'}
          </div>
        </div>

        <div>
          <MLabel>Hasil Kunjungan</MLabel>
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(Object.entries(HASIL_KUNJUNGAN) as [HasilKunjungan, typeof HASIL_KUNJUNGAN[HasilKunjungan]][]).map(([k, v]) => (
              <button key={k} onClick={() => setHasil(k)} style={{
                padding: '11px 10px', borderRadius: 12, fontWeight: 700, fontSize: 12.5,
                border: hasil === k ? `1.5px solid ${v.c}` : '1px solid var(--line)',
                background: hasil === k ? v.soft : 'var(--surface)',
                color: hasil === k ? v.c : 'var(--ink-2)',
              }}>{v.label}</button>
            ))}
          </div>
        </div>

        {hasil === 'bayar' && (
          <div>
            <MLabel>Nominal Pembayaran</MLabel>
            <div className="search" style={{ background: 'var(--surface)' }}>
              <span style={{ fontWeight: 800, color: 'var(--ink-3)' }}>Rp</span>
              <input value={Number(nominal).toLocaleString('id-ID')} inputMode="numeric"
                onChange={e => setNominal(e.target.value.replace(/\D/g, ''))} style={{ fontWeight: 700 }} />
            </div>
            <OcrNominalButton
              photos={photos}
              disabled={photos.length === 0}
              onResult={(n) => { setNominal(String(n)); }}
            />
          </div>
        )}

        <div>
          <MLabel>Tanggal Kunjungan</MLabel>
          <input className="input" type="date" value={tanggal} min={minDateStr} max={todayKeyStr}
            onChange={e => setTanggal(e.target.value || todayKeyStr)}
            style={{ background: 'var(--surface)' }} />
          {tanggal !== todayKeyStr && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              Laporan backdate — pastikan tanggal sesuai kunjungan sebenarnya.
            </div>
          )}
        </div>

        <div>
          <MLabel>Catatan</MLabel>
          <textarea className="input" rows={3} placeholder="Kondisi usaha, kesepakatan, dll…"
            value={catatan} onChange={e => setCatatan(e.target.value)}
            style={{ resize: 'none', background: 'var(--surface)' }} />
        </div>

        <div className="center gap-3" style={{ background: 'var(--accent-soft)', borderRadius: 12, padding: '11px 13px' }}>
          <Ic.location size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--accent-ink)' }}>Lokasi terdeteksi otomatis</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--accent-ink)', opacity: 0.8 }}>-6.4823, 106.8541 · akurasi 6m</div>
          </div>
          <Ic.checkCircle size={18} style={{ color: 'var(--accent)' }} />
        </div>

        {err && (
          <div className="center gap-2" style={{
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
          }}>
            <Ic.alert size={15} />{err}
          </div>
        )}
      </div>

      <div style={{ padding: 16, borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button onClick={submit} disabled={sending || foto === 0} className="btn btn-primary"
          style={{ width: '100%', padding: 14, fontSize: 15, opacity: foto === 0 ? 0.5 : 1 }}>
          {sending ? 'Mengirim…' : foto === 0 ? 'Ambil foto dulu' : <><Ic.send size={16} />Kirim Laporan</>}
        </button>
      </div>
    </div>
  );
}

function MLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div>;
}

// Reads the latest receipt photo through Tesseract.js (lazy-loaded) and
// fills the nominal input with the largest detected rupiah amount. Soft
// fails — OCR is best-effort, not a blocker.
function OcrNominalButton({ photos, disabled, onResult }: {
  photos: File[]; disabled: boolean; onResult: (n: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setStatus('Membaca foto…');
    try {
      const { ocrLargestRupiah } = await import('../lib/ocrNominal');
      const target = photos[photos.length - 1];
      const r = await ocrLargestRupiah(target);
      if (r.nominal != null) {
        onResult(r.nominal);
        setStatus(`Terbaca: Rp ${r.nominal.toLocaleString('id-ID')} (${Math.round(r.confidence)}% confidence)`);
      } else {
        setStatus('Tidak ada angka yang jelas — isi manual.');
      }
    } catch {
      setStatus('Gagal baca foto — coba lagi atau isi manual.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" onClick={run} disabled={disabled || busy} className="btn btn-sm btn-ghost"
        style={{ padding: '4px 10px', fontSize: 11.5 }}>
        <Ic.eye size={12} />{busy ? 'Membaca…' : 'Baca nominal dari foto'}
      </button>
      {status && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{status}</div>
      )}
    </div>
  );
}

function MTabBar({ tab, setTab, onReport }: { tab: Tab; setTab: (t: Tab) => void; onReport: () => void }) {
  const tabs: ({ k: Tab; ic: IconKey; label: string } | { k: '_add' })[] = [
    { k: 'beranda', ic: 'home', label: 'Beranda' },
    { k: 'rute', ic: 'route', label: 'Rute' },
    { k: '_add' },
    { k: 'riwayat', ic: 'clipboard', label: 'Riwayat' },
    { k: 'profil', ic: 'user', label: 'Profil' },
  ];
  return (
    <div className="m-tab-bar">
      {tabs.map(t => {
        if (t.k === '_add') return (
          <div key="add" className="m-fab-slot">
            <button type="button" onClick={onReport} className="m-fab"
              aria-label="Laporkan kunjungan baru">
              <Ic.plus size={24} aria-hidden="true" />
            </button>
          </div>
        );
        const Icon = Ic[t.ic];
        const on = tab === t.k;
        return (
          <button key={t.k} type="button" onClick={() => setTab(t.k)}
            className={'m-tab' + (on ? ' is-active' : '')}
            aria-current={on ? 'page' : undefined}>
            <Icon size={22} aria-hidden="true" />
            <span className="m-tab-label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface GalleryFoto {
  id: string; path: string;
  kunjungan: {
    id: string; tanggal: string; jam: string; hasil: string;
    petugas: { kode: string; nama: string };
  };
}

function NasabahPhotoGalleryModal({ nasabahId, nasabahNama, onClose }: {
  nasabahId: string; nasabahNama: string; onClose: () => void;
}) {
  const BASE = (import.meta as any).env?.VITE_API_URL || '/api';
  const [active, setActive] = useState<GalleryFoto | null>(null);
  const q = useQuery<GalleryFoto[]>({
    queryKey: ['nasabah-foto-gallery', nasabahId],
    queryFn: async () => {
      const t = tokenStore.get();
      return (await axios.get(`${BASE}/foto/by-nasabah/${nasabahId}`, {
        withCredentials: true,
        headers: t ? { Authorization: `Bearer ${t}` } : {},
      })).data;
    },
  });
  const fotos = q.data ?? [];
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 50, display: 'grid', placeItems: 'center', padding: 16,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: 'var(--surface)', borderRadius: 16, maxWidth: 520,
          width: '100%', maxHeight: '90vh', overflow: 'auto',
        }}>
          <div className="between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Galeri Foto</div>
              <div className="muted" style={{ fontSize: 11 }}>{nasabahNama}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
          </div>
          <div style={{ padding: 12 }}>
            {q.isLoading ? <Skeleton h={200} />
              : q.isError ? <ErrorState onRetry={() => q.refetch()} />
              : fotos.length === 0 ? <EmptyState title="Belum ada foto" />
              : (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  {fotos.map(f => (
                    <button key={f.id} onClick={() => setActive(f)} style={{
                      padding: 0, border: 'none', borderRadius: 10, overflow: 'hidden',
                      background: 'var(--ink)', cursor: 'pointer', aspectRatio: '1',
                    }}>
                      <img src={`/${f.path}`} alt={`Foto ${f.kunjungan.tanggal}`}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>
      </div>
      {active && (
        <div onClick={() => setActive(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
          zIndex: 60, display: 'grid', placeItems: 'center', padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{ display: 'grid', gap: 10, maxWidth: 560, width: '100%' }}>
            <img src={`/${active.path}`} alt="Foto"
              style={{ width: '100%', borderRadius: 10, maxHeight: '70vh', objectFit: 'contain' }} />
            <div style={{ color: '#fff', fontSize: 12.5, padding: '6px 4px' }}>
              <div style={{ fontWeight: 700 }}>{new Date(active.kunjungan.tanggal).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} · {active.kunjungan.jam}</div>
              <div style={{ opacity: 0.8, marginTop: 2 }}>
                {active.kunjungan.hasil} · {active.kunjungan.petugas.nama} ({active.kunjungan.petugas.kode})
              </div>
            </div>
            <button className="btn" onClick={() => setActive(null)}>Tutup</button>
          </div>
        </div>
      )}
    </>
  );
}
