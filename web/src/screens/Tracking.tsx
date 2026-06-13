import { useCallback, useEffect, useMemo, useState } from 'react';
import { Map as MlMap, Marker, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Ic } from '../components/Icons';
import { Avatar, StatusPill, cssVar } from '../components/UI';
import {
  HASIL_KUNJUNGAN, RPjt, STATUS_PETUGAS,
  useKunjunganList, useNasabahFinder, usePetugasFinder, usePetugasList,
} from '../data/queries';
import { usePetugasPositions } from '../lib/useEventStream';
import type { Petugas } from '../types';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY;
// MapTiler style — `streets-v2` is the default. Other clean options:
//   dataviz-light, basic-v2, hybrid, satellite. Swap to taste.
const MAPTILER_STYLE = import.meta.env.VITE_MAPTILER_STYLE || 'streets-v2';

// Fallback hub center (BSN headquarter — Depok area)
const HUB = { lat: -6.4025, lng: 106.7942 };

function makeRoute(p: Petugas, seed: number) {
  const cx = 60 + p.posisi.x * 880;
  const cy = 50 + p.posisi.y * 520;
  const rnd = (n: number) => {
    const x = Math.sin(seed * 99 + n * 17.3) * 10000;
    return x - Math.floor(x);
  };
  const stops: { x: number; y: number; lat: number; lng: number; t: string; idx: number }[] = [];
  // Force at least one stop so downstream code that does stops[stops.length-1]
  // (live position pin) never reads `undefined`.
  const n = Math.max(1, p.kunjungan);
  let px = cx - 120;
  let py = cy - 60;
  const times = ['07:40', '08:15', '08:55', '09:30', '10:10', '10:48', '11:25', '12:30', '13:10', '13:50', '14:35', '15:20'];
  for (let i = 0; i < n; i++) {
    px += (rnd(i) - 0.4) * 150;
    py += (rnd(i + 50) - 0.4) * 120;
    px = Math.max(40, Math.min(950, px));
    py = Math.max(40, Math.min(580, py));
    // Project the canvas point to geo coords around HUB
    const lat = HUB.lat + (0.5 - py / 600) * 0.08;
    const lng = HUB.lng + (px / 1000 - 0.5) * 0.10;
    stops.push({ x: px, y: py, lat, lng, t: times[i] || '15:50', idx: i });
  }
  return stops;
}

export function ScreenTracking({ go }: { go: (k: string) => void }) {
  const { data: PETUGAS } = usePetugasList();
  const { data: KUNJUNGAN } = useKunjunganList();
  const petugasById = usePetugasFinder();
  const nasabahById = useNasabahFinder();

  const [sel, setSel] = useState<string>(PETUGAS[0]?.id ?? '');
  const [showAll, setShowAll] = useState(true);
  useEffect(() => { if (!sel && PETUGAS[0]) setSel(PETUGAS[0].id); }, [sel, PETUGAS]);

  const p = petugasById(sel);
  const routes = useMemo(() => PETUGAS.map((pt, i) => ({ pt, stops: makeRoute(pt, i + 1) })), [PETUGAS]);
  const myRoute = routes.find(r => r.pt.id === sel);
  const visitsOf = (pid: string) => KUNJUNGAN.filter(k => k.petugas === pid);

  // Latest live coordinates pushed via SSE, keyed by petugasId. Overrides the
  // stylized last-stop coords for the "live pulse" pin on the map.
  const [livePositions, setLivePositions] = useState<Record<string, { lat: number; lng: number; ts: number }>>({});
  usePetugasPositions(useCallback((d) => {
    setLivePositions(prev => ({ ...prev, [d.petugasId]: { lat: d.lat, lng: d.lng, ts: d.ts } }));
  }, []));

  if (!p || !myRoute) {
    return <div className="content"><div className="muted" style={{ padding: 40 }}>Memuat petugas…</div></div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '318px 1fr', height: '100%', overflow: 'hidden' }}>
      <div style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
        <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid var(--line)' }}>
          <div className="between">
            <div className="section-title">Petugas Lapangan</div>
            <span className="chip"><span className="dot" style={{ background: 'var(--accent)' }} />{PETUGAS.filter(x => x.status === 'lapangan').length} aktif</span>
          </div>
          <label className="center gap-2" style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Tampilkan semua rute di peta
          </label>
        </div>
        <div style={{ overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PETUGAS.map(pt => {
            const active = pt.id === sel;
            const pct = Math.round(pt.terkumpul / pt.target * 100);
            return (
              <button key={pt.id} onClick={() => setSel(pt.id)}
                style={{
                  textAlign: 'left', border: active ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                  background: active ? 'var(--accent-soft)' : 'var(--surface)', borderRadius: 14, padding: 12,
                  display: 'flex', gap: 11, alignItems: 'center', transition: 'all .12s', cursor: 'pointer',
                }}>
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
            <MapTilerMap routes={routes} sel={sel} showAll={showAll} setSel={setSel} live={livePositions} />
          ) : (
            <MapStylized routes={routes} sel={sel} showAll={showAll} setSel={setSel} myRoute={myRoute} />
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
              <button className="btn btn-sm btn-primary" style={{ flex: 1 }}><Ic.phone size={14} />Hubungi</button>
              <button className="btn btn-sm" onClick={() => go('laporan')}><Ic.clipboard size={14} />Laporan</button>
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

function MiniKv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div className="num" style={{ fontWeight: 700, fontSize: 13.5, marginTop: 1 }}>{value}</div>
    </div>
  );
}

type Route = { pt: Petugas; stops: { lat: number; lng: number; x: number; y: number; t: string; idx: number }[] };

// MapTiler basemap + route lines + petugas markers via MapLibre GL.
function MapTilerMap({ routes, sel, showAll, setSel, live }: {
  routes: Route[]; sel: string; showAll: boolean; setSel: (s: string) => void;
  live: Record<string, { lat: number; lng: number; ts: number }>;
}) {
  const accent = cssVar('--accent') || '#1f8a5b';
  const styleUrl = `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`;

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

  return (
    <MlMap
      initialViewState={{ longitude: HUB.lng, latitude: HUB.lat, zoom: 12 }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={styleUrl}
      attributionControl={{ compact: true }}>
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
    </MlMap>
  );
}

// Fallback stylized map for when no Google Maps API key is provided
function MapStylized({ routes, sel, showAll, setSel, myRoute }: {
  routes: Route[]; sel: string; showAll: boolean; setSel: (s: string) => void; myRoute: Route;
}) {
  const accent = cssVar('--accent') || '#1f8a5b';
  const W = 1000;
  const H = 620;
  const vRoads = [120, 240, 360, 480, 600, 720, 840];
  const hRoads = [90, 200, 310, 420, 530];
  const pathFor = (stops: { x: number; y: number }[]) => stops.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x} ${s.y}`).join(' ');

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
