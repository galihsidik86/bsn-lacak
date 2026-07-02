import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Map as MlMap, Marker, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Ic } from '../components/Icons';
import { Avatar, StatusPill } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  HASIL_KUNJUNGAN, RPjt, STATUS_PETUGAS,
  useKunjunganList, useNasabahFinder, useNasabahList, usePetugasFinder, usePetugasList,
} from '../data/queries';
import { usePetugasPositions } from '../lib/useEventStream';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { orderNearest } from '../lib/geo';
import type { Nasabah, Petugas } from '../types';

const BASE = import.meta.env.VITE_API_URL || '/api';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY;
// MapTiler style — `streets-v2` is the default. Other clean options:
//   dataviz-light, basic-v2, hybrid, satellite. Swap to taste.
const MAPTILER_STYLE = import.meta.env.VITE_MAPTILER_STYLE || 'streets-v2';

// Fallback hub center (BSN headquarter — Depok area)
const HUB = { lat: -6.4025, lng: 106.7942 };

const TIMES = ['07:40', '08:15', '08:55', '09:30', '10:10', '10:48', '11:25', '12:30', '13:10', '13:50', '14:35', '15:20'];

// Project geo coords onto the 1000×600 stylized SVG canvas around HUB.
// Inverse of the original makeRoute projection so existing canvas-coords
// renderers (the SVG path map) still work with real lat/lng input.
function projToCanvas(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng - HUB.lng) / 0.10) * 1000 + 500;
  const y = ((HUB.lat - lat) / 0.08) * 600 + 300;
  return {
    x: Math.max(40, Math.min(960, x)),
    y: Math.max(40, Math.min(560, y)),
  };
}

// Real route for a petugas: ordered stops over their nasabah binaan, mirroring
// what the petugas sees on Mobile (Rute tab). Order = nearest-neighbor from
// the petugas's live GPS fix when available, else from the first stop. This
// keeps the admin's tracking map in sync with the petugas's actual path.
function makeRoute(
  p: Petugas,
  nasabahList: Nasabah[],
  live?: { lat: number; lng: number },
): { x: number; y: number; lat: number; lng: number; t: string; idx: number }[] {
  const mine = nasabahList.filter(
    n => n.petugas === p.id && typeof n.lat === 'number' && typeof n.lng === 'number',
  );
  const raw = mine.map(n => ({ lat: n.lat as number, lng: n.lng as number }));
  if (raw.length === 0) {
    // Fallback so downstream code (stops[stops.length-1]) never crashes:
    // synthesize a single pin at the petugas's live position or HUB.
    const pt = live ?? HUB;
    const proj = projToCanvas(pt.lat, pt.lng);
    return [{ x: proj.x, y: proj.y, lat: pt.lat, lng: pt.lng, t: '—', idx: 0 }];
  }
  const start = live ?? raw[0];
  const { ordered } = orderNearest(start, raw);
  return ordered.map((s, i) => {
    const proj = projToCanvas(s.lat, s.lng);
    return { x: proj.x, y: proj.y, lat: s.lat, lng: s.lng, t: TIMES[i] ?? '15:50', idx: i };
  });
}

export function ScreenTracking({ go }: { go: (k: string) => void }) {
  const petugasQ = usePetugasList();
  const kunjunganQ = useKunjunganList();
  const nasabahQ = useNasabahList();
  const { data: PETUGAS } = petugasQ;
  const { data: KUNJUNGAN } = kunjunganQ;
  const { data: NASABAH } = nasabahQ;
  const petugasById = usePetugasFinder();
  const nasabahById = useNasabahFinder();

  const [sel, setSel] = useState<string>(PETUGAS[0]?.id ?? '');
  const [showAll, setShowAll] = useState(true);
  // Toggle overlay "Jejak Kunjungan": marker per laporan kunjungan dengan
  // GPS fix, diurutkan kronologis. Off by default supaya map tidak terlalu
  // ramai untuk supervisor yang baru buka layar.
  const [showJejak, setShowJejak] = useState(false);
  // Toggle "Trail Pergerakan": polyline dari semua PetugasPosition pada
  // tanggal yang dipilih (00:00 → 23:59:59 local). Beda dari jejak
  // kunjungan — ini path GPS mentah, bukan titik laporan. Off by default.
  const [showTrail, setShowTrail] = useState(false);
  const [trail, setTrail] = useState<Array<{ lat: number; lng: number; ts: number }>>([]);
  // Toggle "Heatmap Kunjungan": geographic density semua laporan
  // kunjungan ber-GPS dalam window 7 hari. Cross-petugas / cross-zone —
  // untuk supervisor identifikasi hotspot vs under-served area.
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmap, setHeatmap] = useState<Array<{ lat: number; lng: number; count: number }>>([]);
  // Default trailDate = hari ini (YYYY-MM-DD local timezone). Supervisor
  // bisa pilih tanggal historis untuk audit pergerakan kemarin / minggu
  // lalu. Tanggal masa depan diizinkan tapi datanya pasti kosong.
  const [trailDate, setTrailDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const trailIsToday = trailDate === todayKey;
  useEffect(() => { if (!sel && PETUGAS[0]) setSel(PETUGAS[0].id); }, [sel, PETUGAS]);

  const p = petugasById(sel);
  const visitsOf = (pid: string) => KUNJUNGAN.filter(k => k.petugas === pid);

  // Latest live coordinates, keyed by petugasId. Two feed sources:
  //   1. On mount: GET /petugas/positions/latest seeds with most recent ping
  //      per petugas so the map shows real coords immediately after refresh.
  //   2. SSE 'petugas.position' overrides with newer fixes as they arrive.
  const [livePositions, setLivePositions] = useState<Record<string, { lat: number; lng: number; ts: number }>>({});
  usePetugasPositions(useCallback((d) => {
    setLivePositions(prev => ({ ...prev, [d.petugasId]: { lat: d.lat, lng: d.lng, ts: d.ts } }));
  }, []));
  useEffect(() => {
    const tok = tokenStore.get();
    if (!tok) return;
    const override = useAuth.getState().branchOverride;
    const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
    if (override) h['x-branch-id'] = override;
    let cancelled = false;
    void axios.get<Array<{ petugasId: string; lat: number; lng: number; ts: number }>>(
      `${BASE}/petugas/positions/latest`,
      { withCredentials: true, headers: h },
    ).then(r => {
      if (cancelled) return;
      const seed: Record<string, { lat: number; lng: number; ts: number }> = {};
      for (const row of r.data) seed[row.petugasId] = { lat: row.lat, lng: row.lng, ts: row.ts };
      // Only fill keys that haven't been overridden by an SSE event during fetch.
      setLivePositions(prev => ({ ...seed, ...prev }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Fetch trail pergerakan ketika toggle on + petugas / tanggal berubah.
  // Auto-refresh tiap 30 detik HANYA saat melihat hari ini — tanggal
  // historis tidak akan berubah, jadi polling cuma membakar API.
  useEffect(() => {
    if (!showTrail || !sel) { setTrail([]); return; }
    const tok = tokenStore.get();
    if (!tok) return;
    let cancelled = false;
    const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
    const override = useAuth.getState().branchOverride;
    if (override) headers['x-branch-id'] = override;

    // Compute since (00:00) dan until (23:59:59.999) local timezone untuk
    // trailDate. ISO konversi dilakukan via Date constructor + toISOString
    // supaya backend dapat UTC instant yang sesuai.
    const [y, m, d] = trailDate.split('-').map(Number);
    const sinceLocal = new Date(y, m - 1, d, 0, 0, 0, 0);
    const untilLocal = new Date(y, m - 1, d, 23, 59, 59, 999);
    const params = {
      since: sinceLocal.toISOString(),
      until: untilLocal.toISOString(),
    };
    const fetchTrail = () => {
      void axios.get<{ points: Array<{ lat: number; lng: number; ts: number }> }>(
        `${BASE}/petugas/${sel}/positions/trail`,
        { withCredentials: true, headers, params },
      ).then(r => {
        if (!cancelled) setTrail(r.data.points);
      }).catch(() => { if (!cancelled) setTrail([]); });
    };
    fetchTrail();
    if (!trailIsToday) return () => { cancelled = true; };
    const iv = setInterval(fetchTrail, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [showTrail, sel, trailDate, trailIsToday]);

  // Fetch heatmap saat toggle on (semua kunjungan ber-GPS dalam 7 hari).
  // Tidak per-petugas — heat map cross-cabang scope di backend pakai
  // scopedBranchId. Re-fetch tiap 5 menit.
  useEffect(() => {
    if (!showHeatmap) { setHeatmap([]); return; }
    const tok = tokenStore.get();
    if (!tok) return;
    let cancelled = false;
    const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
    const override = useAuth.getState().branchOverride;
    if (override) headers['x-branch-id'] = override;
    const fetchHeat = () => {
      void axios.get<{ points: Array<{ lat: number; lng: number; count: number }> }>(
        `${BASE}/analytics/visit-heatmap`,
        { withCredentials: true, headers },
      ).then(r => {
        if (!cancelled) setHeatmap(r.data.points);
      }).catch(() => { if (!cancelled) setHeatmap([]); });
    };
    fetchHeat();
    const iv = setInterval(fetchHeat, 5 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [showHeatmap]);

  // Routes are rebuilt whenever the petugas's live fix changes so the order
  // updates as they move — same nearest-neighbor algorithm Mobile uses.
  const routes = useMemo(
    () => PETUGAS.map(pt => ({ pt, stops: makeRoute(pt, NASABAH, livePositions[pt.id]) })),
    [PETUGAS, NASABAH, livePositions],
  );
  const myRoute = routes.find(r => r.pt.id === sel);

  // Jejak kunjungan: laporan dengan GPS fix milik petugas terpilih, urut
  // kronologis (createdAt asc) — bukan nearest-neighbor — supaya line
  // menggambarkan path aktual yang dilewati.
  const jejak = useMemo(() => {
    if (!showJejak) return [];
    return KUNJUNGAN
      .filter(k =>
        k.petugas === sel
        && typeof k.lat === 'number'
        && typeof k.lng === 'number',
      )
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
      .map(k => ({
        id: k.id,
        lat: k.lat as number,
        lng: k.lng as number,
        hasil: k.hasil,
        nominal: k.nominal,
        jam: k.jam,
        nasabahNama: nasabahById(k.nasabah)?.nama ?? '—',
      }));
  }, [showJejak, KUNJUNGAN, sel, nasabahById]);

  if (petugasQ.isPending || kunjunganQ.isPending || nasabahQ.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16, gridTemplateColumns: '318px 1fr' }}>
        <Skeleton h={600} />
        <Skeleton h={600} />
      </div>
    );
  }
  if (petugasQ.error || kunjunganQ.error || nasabahQ.error) {
    return <div className="content"><ErrorState onRetry={() => { petugasQ.refetch(); kunjunganQ.refetch(); nasabahQ.refetch(); }} /></div>;
  }
  if (PETUGAS.length === 0) {
    return (
      <div className="content">
        <EmptyState title="Belum ada petugas terdaftar"
          hint="Tambahkan petugas lapangan dulu dari menu Distribusi atau seed database." />
      </div>
    );
  }
  if (!p || !myRoute) {
    return <div className="content"><div className="muted" style={{ padding: 40 }}>Memilih petugas…</div></div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '318px 1fr', height: '100%', overflow: 'hidden' }}>
      <div style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid var(--line)' }}>
          <div className="between">
            <div className="section-title">Petugas Lapangan</div>
            <span className="chip"><span className="dot" style={{ background: 'var(--accent)' }} />{PETUGAS.filter(x => x.status === 'lapangan').length} aktif</span>
          </div>
          <div className="tracking-controls">
            <label className="toggle-row">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              Tampilkan semua rute di peta
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={showJejak} onChange={e => setShowJejak(e.target.checked)} />
              Tampilkan jejak kunjungan
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={showTrail} onChange={e => setShowTrail(e.target.checked)} />
              Tampilkan trail pergerakan
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} />
              Tampilkan heatmap kunjungan
            </label>
            {showTrail && (
              <div className="trail-detail">
                <div className="trail-detail-row">
                  <span>Tanggal:</span>
                  <input
                    type="date"
                    value={trailDate}
                    max={todayKey}
                    onChange={e => setTrailDate(e.target.value || todayKey)}
                    aria-label="Pilih tanggal trail pergerakan"
                  />
                </div>
                <div className={`trail-status ${trailIsToday ? 'is-live' : 'is-historic'}`}>
                  <span className="trail-status-pill" aria-hidden="true" />
                  {trailIsToday ? 'Live · refresh 30 dtk' : `Historis · ${trail.length} titik`}
                  {!trailIsToday && (
                    <button type="button" className="reset-btn"
                      onClick={() => setTrailDate(todayKey)}>
                      Kembali ke hari ini
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PETUGAS.map(pt => {
            const active = pt.id === sel;
            const pct = Math.round(pt.terkumpul / pt.target * 100);
            const live = livePositions[pt.id];
            return (
              <button key={pt.id} type="button" onClick={() => setSel(pt.id)}
                className={'petugas-card' + (active ? ' is-active' : '')}
                aria-pressed={active}>
                <div style={{ position: 'relative' }}>
                  <Avatar inisial={pt.inisial} hue={pt.hue} size={40} />
                  <span style={{
                    position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 99,
                    background: STATUS_PETUGAS[pt.status].c, border: '2.5px solid var(--surface)',
                  }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="between">
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{pt.nama}</span>
                    <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)' }}>{pct}%</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pt.wilayah}</div>
                  <PingFreshness ts={live?.ts} />
                  <div className="progress" style={{ height: 5, marginTop: 6 }}>
                    <span style={{ width: pct + '%', background: `oklch(0.58 0.12 ${pt.hue})` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateRows: '1fr auto', overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface-2)' }}>
          {MAPTILER_KEY ? (
            <MapTilerMap routes={routes} sel={sel} showAll={showAll} setSel={setSel} live={livePositions} jejak={jejak} trail={trail} heatmap={heatmap} />
          ) : (
            <MapStylized routes={routes} sel={sel} showAll={showAll} setSel={setSel} myRoute={myRoute} jejak={jejak} trail={trail} />
          )}

          <div className="card fade-up" style={{ position: 'absolute', top: 16, left: 16, width: 250, padding: 14, boxShadow: 'var(--sh-2)' }}>
            <div className="center gap-3">
              <Avatar inisial={p.inisial} hue={p.hue} size={42} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{p.nama}</div>
                <StatusPill status={p.status} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
              <MiniKv label="Mulai" value={p.mulai} />
              <MiniKv label="Update" value={p.terakhir} />
              <MiniKv label="Kunjungan" value={`${p.kunjungan}/${p.rencana}`} />
              <MiniKv label="Tertagih" value={RPjt(p.terkumpul)} />
            </div>
            <div className="center gap-2" style={{ marginTop: 12 }}>
              <button className="btn-action is-primary" type="button" style={{ flex: 1 }}>
                <Ic.phone size={15} aria-hidden="true" />Hubungi
              </button>
              <button className="btn-action" type="button" onClick={() => go('laporan')}>
                <Ic.clipboard size={15} aria-hidden="true" />Laporan
              </button>
            </div>
          </div>

          <div className="card" style={{ position: 'absolute', bottom: 16, right: 16, padding: '10px 14px', display: 'flex', gap: 16, fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)', boxShadow: 'var(--sh-2)' }}>
            <span className="center gap-2"><span style={{ width: 16, height: 3, background: 'var(--accent)', borderRadius: 2 }} />Rute hari ini</span>
            <span className="center gap-2"><Ic.pin size={14} style={{ color: 'var(--accent)' }} />Titik kunjungan</span>
            <span className="center gap-2"><span style={{ width: 11, height: 11, borderRadius: 99, background: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft-2)' }} />Posisi live</span>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', background: 'var(--surface)', padding: '14px 20px 18px', maxHeight: 220, overflowY: 'auto' }}>
          <div className="between" style={{ marginBottom: 12 }}>
            <div className="section-title">Linimasa Pergerakan — {p.nama}</div>
            <span className="chip"><Ic.clock size={13} />Mulai {p.mulai}</span>
          </div>
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', paddingBottom: 4 }}>
            {myRoute.stops.map((s, i) => {
              const visit = visitsOf(sel)[i];
              const isNow = i === myRoute.stops.length - 1 && p.status === 'lapangan';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', flex: 'none' }}>
                  <div style={{ width: 168, paddingRight: 14 }}>
                    <div className="center gap-2" style={{ marginBottom: 5 }}>
                      <span style={{
                        width: 26, height: 26, borderRadius: 99, display: 'grid', placeItems: 'center',
                        background: isNow ? 'var(--accent)' : 'var(--accent-soft)',
                        color: isNow ? 'white' : 'var(--accent-ink)',
                        fontWeight: 800, fontSize: 11.5, flex: 'none',
                      }}>{i + 1}</span>
                      <span className="num" style={{ fontWeight: 700, fontSize: 12.5 }}>{s.t}</span>
                      {isNow && <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>kini</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {visit ? nasabahById(visit.nasabah)?.nama : 'Perjalanan'}
                    </div>
                    {visit && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{HASIL_KUNJUNGAN[visit.hasil].label}</div>}
                  </div>
                  {i < myRoute.stops.length - 1 && (
                    <div style={{ alignSelf: 'center', color: 'var(--line-2)', marginTop: -18 }}><Ic.arrowRight size={16} /></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Indicator "kapan ping terakhir" — supervisor langsung tahu kalau trail
// bolong karena petugas vs karena bug sistem. Re-render tiap 30 detik
// supaya angka selalu refresh tanpa harus tunggu data baru.
function PingFreshness({ ts }: { ts: number | undefined }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);
  if (!ts) {
    return (
      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 600, marginTop: 3 }}>
        ⚫ Belum ada ping hari ini
      </div>
    );
  }
  const ageMin = Math.max(0, Math.round((now - ts) / 60_000));
  let color = 'var(--col-lancar)';
  let icon = '🟢';
  let label: string;
  if (ageMin < 2) { label = 'Live · baru saja'; }
  else if (ageMin < 10) { label = `Live · ${ageMin} menit lalu`; }
  else if (ageMin < 30) {
    color = 'oklch(0.5 0.14 75)'; icon = '🟡';
    label = `Update ${ageMin} menit lalu`;
  } else if (ageMin < 60) {
    color = 'oklch(0.5 0.14 75)'; icon = '🟡';
    label = `Stale · ${ageMin} menit lalu`;
  } else {
    color = 'var(--col-macet)'; icon = '🔴';
    const h = Math.floor(ageMin / 60);
    const m = ageMin % 60;
    label = `Stale · ${h}j${m > 0 ? ' ' + m + 'mnt' : ''} lalu`;
  }
  return (
    <div style={{ fontSize: 10.5, color, fontWeight: 700, marginTop: 3 }}>
      {icon} {label}
    </div>
  );
}

function MiniKv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div className="num" style={{ fontWeight: 700, fontSize: 13.5, marginTop: 1 }}>{value}</div>
    </div>
  );
}

type Route = { pt: Petugas; stops: { lat: number; lng: number; x: number; y: number; t: string; idx: number }[] };

// Visit history dengan GPS fix — passed dari ScreenTracking saat toggle
// "Tampilkan jejak kunjungan" aktif. Diurut kronologis di parent.
interface JejakStop {
  id: string; lat: number; lng: number;
  hasil: 'bayar' | 'janji' | 'tidakada' | 'tolak';
  nominal: number; jam: string; nasabahNama: string;
}

// Warna marker per hasil kunjungan — selaras dengan palette HASIL_KUNJUNGAN.
const JEJAK_COLOR: Record<JejakStop['hasil'], string> = {
  bayar: 'oklch(0.57 0.13 162)',     // accent hijau
  janji: 'oklch(0.7 0.15 75)',       // amber
  tidakada: 'oklch(0.55 0.02 0)',    // ink-3 abu
  tolak: 'oklch(0.55 0.17 25)',      // macet merah
};

// MapTiler basemap + route lines + petugas markers via MapLibre GL.
function MapTilerMap({ routes, sel, showAll, setSel, live, jejak, trail, heatmap }: {
  routes: Route[]; sel: string; showAll: boolean; setSel: (s: string) => void;
  live: Record<string, { lat: number; lng: number; ts: number }>;
  jejak: JejakStop[];
  trail: Array<{ lat: number; lng: number; ts: number }>;
  heatmap: Array<{ lat: number; lng: number; count: number }>;
}) {
  // Hex hardcoded karena MapLibre GL JS tidak parse oklch() string.
  // Kalau nanti brand berubah, update di sini + var(--accent) di styles.css.
  const accent = '#1f8a5b';
  const styleUrl = `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`;
  const mapRef = useRef<MapRef | null>(null);

  // Auto-pan ke posisi petugas terpilih supaya supervisor tidak perlu
  // geser map manual. Prioritas target:
  //   1. Live GPS fix dari SSE / endpoint positions/latest
  //   2. Posisi stop terakhir di rute (fallback bila live belum ada)
  // Zoom 14 = ~kotamadya kecil (cukup intim tapi konteks daerah masih ada).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = live[sel] ?? (() => {
      const r = routes.find(rr => rr.pt.id === sel);
      if (!r || r.stops.length === 0) return undefined;
      return r.stops[r.stops.length - 1];
    })();
    if (!target) return;
    map.flyTo({
      center: [target.lng, target.lat],
      zoom: 14,
      duration: 1200,
      essential: true,
    });
  }, [sel, live, routes]);

  // GeoJSON FeatureCollection of route LineStrings — each feature carries a
  // `kind` so the line style picks selected vs. faint via case-expression.
  const routesGeo = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: routes
      .filter(r => showAll || r.pt.id === sel)
      .map(r => ({
        type: 'Feature' as const,
        properties: {
          kind: r.pt.id === sel ? 'sel' : 'other',
          color: r.pt.id === sel ? accent : `hsl(${r.pt.hue}, 60%, 55%)`,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: r.stops.map(s => [s.lng, s.lat] as [number, number]),
        },
      })),
  }), [routes, sel, showAll, accent]);

  // Heatmap GeoJSON — point feature collection dengan property weight
  // untuk maplibre heatmap-weight expression. Max count untuk normalisasi
  // di heatmap-intensity. 0 fallback supaya layer tidak crash saat data
  // belum tiba.
  const heatmapGeo = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: heatmap.map(h => ({
      type: 'Feature' as const,
      properties: { count: h.count },
      geometry: { type: 'Point' as const, coordinates: [h.lng, h.lat] as [number, number] },
    })),
  }), [heatmap]);
  const heatmapMaxCount = useMemo(
    () => heatmap.reduce((m, h) => Math.max(m, h.count), 1),
    [heatmap],
  );

  // Polyline kronologis dari jejak — opacity rendah agar tidak dominasi
  // garis rute terencana.
  const jejakLineGeo = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: jejak.length < 2 ? [] : [{
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: jejak.map(j => [j.lng, j.lat] as [number, number]),
      },
    }],
  }), [jejak]);

  // Trail polyline dari ping GPS petugas — split menjadi beberapa
  // LineString saat ada gap > 5 menit antar ping berurutan. Tanpa split,
  // dua segmen ter-track dipisahkan gap besar akan tersambung straight
  // line yang menyesatkan (cuts through area yang tidak benar-benar
  // dilewati). Kind: 'solid' = path ter-track sebenarnya, 'gap' = jeda
  // coverage yang di-render dashed untuk menunjukkan ketidakpastian.
  const GAP_THRESHOLD_MS = 5 * 60 * 1000;
  const trailLineGeo = useMemo(() => {
    if (trail.length < 2) return { type: 'FeatureCollection' as const, features: [] };
    const features: any[] = [];
    let segStart = 0;
    for (let i = 1; i <= trail.length; i++) {
      const isLast = i === trail.length;
      const gap = !isLast && (trail[i].ts - trail[i - 1].ts) > GAP_THRESHOLD_MS;
      if (gap || isLast) {
        // Solid segment dari segStart ke i-1.
        if (i - 1 > segStart) {
          features.push({
            type: 'Feature' as const,
            properties: { kind: 'solid' },
            geometry: {
              type: 'LineString' as const,
              coordinates: trail.slice(segStart, i).map(t => [t.lng, t.lat] as [number, number]),
            },
          });
        }
        // Dashed gap line dari titik akhir segmen ke titik awal segmen
        // berikut — menandakan "coverage hilang" tanpa menyangka itu path
        // sebenarnya.
        if (gap) {
          features.push({
            type: 'Feature' as const,
            properties: { kind: 'gap' },
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [trail[i - 1].lng, trail[i - 1].lat] as [number, number],
                [trail[i].lng, trail[i].lat] as [number, number],
              ],
            },
          });
          segStart = i;
        }
      }
    }
    return { type: 'FeatureCollection' as const, features };
  }, [trail]);

  return (
    <MlMap
      ref={mapRef}
      initialViewState={{ longitude: HUB.lng, latitude: HUB.lat, zoom: 12 }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={styleUrl}
      attributionControl={{ compact: true }}>
      {/* Visit heatmap — paling bawah supaya routes/trail tetap visible. */}
      <Source id="bsn-heatmap" type="geojson" data={heatmapGeo}>
        <Layer
          id="bsn-heatmap-layer"
          type="heatmap"
          paint={{
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'count'], 0, 0, heatmapMaxCount, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 3],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 16, 15, 40],
            'heatmap-opacity': 0.65,
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(33, 102, 172, 0)',
              0.2, 'rgb(103, 169, 207)',
              0.4, 'rgb(209, 229, 240)',
              0.6, 'rgb(253, 219, 199)',
              0.8, 'rgb(239, 138, 98)',
              1, 'rgb(178, 24, 43)',
            ],
          }}
        />
      </Source>

      <Source id="bsn-routes" type="geojson" data={routesGeo}>
        <Layer
          id="bsn-routes-line"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': ['case', ['==', ['get', 'kind'], 'sel'], 4, 2],
            'line-opacity': ['case', ['==', ['get', 'kind'], 'sel'], 0.9, 0.4],
          }}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        />
      </Source>

      {routes.flatMap(r =>
        (r.pt.id === sel || showAll)
          ? r.stops.map((s, i) => {
              const isSel = r.pt.id === sel;
              const isLastStop = i === r.stops.length - 1;
              const color = isSel ? accent : `hsl(${r.pt.hue}, 60%, 55%)`;
              // The very last stop of each route is the "live position" — when
              // an SSE update arrives for this petugas, override coords.
              const livePos = isLastStop ? live[r.pt.id] : undefined;
              const lng = livePos?.lng ?? s.lng;
              const lat = livePos?.lat ?? s.lat;
              const isLive = isSel && isLastStop;
              return (
                <Marker key={`${r.pt.id}-${i}`} longitude={lng} latitude={lat} anchor="center"
                  onClick={(e) => { e.originalEvent.stopPropagation(); setSel(r.pt.id); }}>
                  {isLive ? (
                    <div style={{ position: 'relative', width: 26, height: 26, cursor: 'pointer' }}>
                      <div style={{
                        position: 'absolute', inset: 0, borderRadius: 99,
                        background: color, opacity: 0.25, animation: 'mlpulse 2.2s ease-out infinite',
                      }} />
                      <div style={{
                        position: 'absolute', inset: 6, borderRadius: 99,
                        background: color, border: '3px solid white',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                      }} />
                    </div>
                  ) : (
                    <div style={{
                      width: isSel ? 16 : 12, height: isSel ? 16 : 12, borderRadius: 99,
                      background: color, border: '2px solid white',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                      cursor: 'pointer',
                    }} />
                  )}
                </Marker>
              );
            })
          : []
      )}

      {/* Trail pergerakan GPS — solid biru untuk segmen ter-track,
          dashed abu untuk gap >5 menit (coverage hilang). */}
      <Source id="bsn-trail" type="geojson" data={trailLineGeo}>
        <Layer
          id="bsn-trail-line-gap"
          type="line"
          filter={['==', 'kind', 'gap']}
          paint={{
            'line-color': '#9ca3af', // abu medium — tidak salah-arti sebagai path nyata
            'line-width': 2,
            'line-opacity': 0.6,
            'line-dasharray': [2, 3],
          }}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        />
        <Layer
          id="bsn-trail-line"
          type="line"
          filter={['==', 'kind', 'solid']}
          paint={{
            'line-color': '#1e88e5', // biru cyan, beda dari accent hijau
            'line-width': 4,
            'line-opacity': 0.75,
          }}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        />
      </Source>
      {trail.length >= 2 && (
        <>
          <Marker longitude={trail[0].lng} latitude={trail[0].lat} anchor="center">
            <div title={`Awal trail · ${new Date(trail[0].ts).toLocaleTimeString('id-ID')}`}
              style={{
                width: 14, height: 14, borderRadius: 99,
                background: '#1e88e5', border: '2.5px solid white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
          </Marker>
          <Marker longitude={trail[trail.length - 1].lng} latitude={trail[trail.length - 1].lat} anchor="center">
            <div title={`Posisi terakhir · ${new Date(trail[trail.length - 1].ts).toLocaleTimeString('id-ID')}`}
              style={{
                width: 14, height: 14, borderRadius: 99,
                background: '#1e88e5', border: '2.5px solid white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
          </Marker>
        </>
      )}

      {/* Jejak Kunjungan — polyline kronologis + marker per laporan ber-GPS */}
      <Source id="bsn-jejak" type="geojson" data={jejakLineGeo}>
        <Layer
          id="bsn-jejak-line"
          type="line"
          paint={{
            'line-color': accent,
            'line-width': 3,
            'line-opacity': 0.55,
            'line-dasharray': [1, 1.5],
          }}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        />
      </Source>
      {jejak.map((j, i) => (
        <Marker key={j.id} longitude={j.lng} latitude={j.lat} anchor="center">
          <div title={`#${i + 1} · ${j.jam} · ${j.nasabahNama}\nHasil: ${j.hasil}${j.nominal ? ` · Rp${j.nominal.toLocaleString('id-ID')}` : ''}`}
            style={{
              width: 22, height: 22, borderRadius: 99,
              background: JEJAK_COLOR[j.hasil],
              border: '2px solid white',
              boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
              color: 'white', fontWeight: 800, fontSize: 10,
              display: 'grid', placeItems: 'center',
              cursor: 'help',
            }}>{i + 1}</div>
        </Marker>
      ))}
    </MlMap>
  );
}

// Fallback stylized map for when no Google Maps API key is provided
function MapStylized({ routes, sel, showAll, setSel, myRoute, jejak, trail }: {
  routes: Route[]; sel: string; showAll: boolean; setSel: (s: string) => void; myRoute: Route;
  jejak: JejakStop[];
  trail: Array<{ lat: number; lng: number; ts: number }>;
}) {
  // Hex hardcoded karena MapLibre GL JS tidak parse oklch() string.
  // Kalau nanti brand berubah, update di sini + var(--accent) di styles.css.
  const accent = '#1f8a5b';
  const W = 1000;
  const H = 620;
  const vRoads = [120, 240, 360, 480, 600, 720, 840];
  const hRoads = [90, 200, 310, 420, 530];
  const pathFor = (stops: { x: number; y: number }[]) => stops.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x} ${s.y}`).join(' ');
  // Project lat/lng jejak ke canvas — pakai helper yang sama dengan makeRoute.
  const jejakXY = jejak.map(j => ({ ...j, ...projToCanvas(j.lat, j.lng) }));
  const trailXY = trail.map(t => projToCanvas(t.lat, t.lng));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
      <rect width={W} height={H} fill="var(--surface-2)" />
      <g stroke="var(--surface)" strokeWidth="14" strokeLinecap="round">
        {vRoads.map((x, i) => <line key={'v' + i} x1={x} y1={20} x2={x} y2={H - 20} />)}
        {hRoads.map((y, i) => <line key={'h' + i} x1={20} y1={y} x2={W - 20} y2={y} />)}
      </g>
      {showAll && routes.filter(r => r.pt.id !== sel).map(r => (
        <g key={r.pt.id} opacity="0.32">
          <path d={pathFor(r.stops)} fill="none" stroke={`oklch(0.6 0.1 ${r.pt.hue})`} strokeWidth="3"
            strokeDasharray="2 6" strokeLinecap="round" />
          <circle cx={r.stops[r.stops.length - 1].x} cy={r.stops[r.stops.length - 1].y} r="7"
            fill={`oklch(0.6 0.12 ${r.pt.hue})`} stroke="var(--surface)" strokeWidth="2"
            style={{ cursor: 'pointer' }} onClick={() => setSel(r.pt.id)} />
        </g>
      ))}
      <g>
        <path d={pathFor(myRoute.stops)} fill="none" stroke={accent} strokeWidth="4.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 2px 6px oklch(0.55 0.14 156 / 0.4))' }} />
        {myRoute.stops.map((s, i) => i < myRoute.stops.length - 1 && (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r="11" fill="var(--surface)" stroke={accent} strokeWidth="3" />
            <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill={accent}>{i + 1}</text>
          </g>
        ))}
        {/* Trail pergerakan GPS — polyline biru solid */}
        {trailXY.length >= 2 && (
          <path
            d={trailXY.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')}
            fill="none" stroke="#1e88e5" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
        )}
        {/* Jejak kunjungan — polyline dashed + marker bernomor per hasil */}
        {jejakXY.length >= 2 && (
          <path
            d={jejakXY.map((j, i) => `${i === 0 ? 'M' : 'L'}${j.x} ${j.y}`).join(' ')}
            fill="none" stroke={accent} strokeWidth="2.4" strokeDasharray="3 5"
            strokeLinecap="round" opacity="0.7" />
        )}
        {jejakXY.map((j, i) => (
          <g key={`jejak-${j.id}`}>
            <circle cx={j.x} cy={j.y} r="11" fill={JEJAK_COLOR[j.hasil]} stroke="white" strokeWidth="2" />
            <text x={j.x} y={j.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="white">{i + 1}</text>
          </g>
        ))}
        {(() => {
          const s = myRoute.stops[myRoute.stops.length - 1];
          return (
            <g>
              <circle cx={s.x} cy={s.y} r="22" fill={accent} opacity="0.18">
                <animate attributeName="r" values="14;26;14" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.28;0;0.28" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx={s.x} cy={s.y} r="13" fill={accent} stroke="var(--surface)" strokeWidth="3.5" />
              <circle cx={s.x} cy={s.y} r="4" fill="var(--surface)" />
            </g>
          );
        })()}
      </g>
    </svg>
  );
}
