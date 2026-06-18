import { useMemo, useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Map as MlMap, Marker, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Ic } from '../components/Icons';
import { Avatar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY;
const MAPTILER_STYLE = import.meta.env.VITE_MAPTILER_STYLE || 'streets-v2';

// HUB center (Depok area) used as fallback view when no points are returned.
const HUB = { lat: -6.4025, lng: 106.7942 };

function authHeaders() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const override = useAuth.getState().branchOverride;
  if (override) h['x-branch-id'] = override;
  return h;
}

interface MapPoint {
  id: string;
  petugasId: string;
  petugasKode: string;
  petugasNama: string;
  petugasInisial: string;
  petugasHue: number;
  branchKode: string;
  branchNama: string;
  clockInAt: string;
  clockInLat: number;
  clockInLng: number;
  clockOutAt: string | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
}

interface MapResponse {
  since: string;
  windowDays: number;
  points: MapPoint[];
}

async function fetchMap(days: number): Promise<MapResponse> {
  const r = await axios.get(`${BASE}/attendance/map`, {
    withCredentials: true, headers: authHeaders(), params: { days },
  });
  return r.data;
}

export function ScreenAttendanceMap() {
  const [days, setDays] = useState<1 | 7 | 30>(1);
  const [active, setActive] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['attendance-map', days], queryFn: () => fetchMap(days) });

  const points = q.data?.points ?? [];

  const center = useMemo(() => {
    if (points.length === 0) return HUB;
    const lat = points.reduce((s, p) => s + p.clockInLat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.clockInLng, 0) / points.length;
    return { lat, lng };
  }, [points]);

  if (q.isPending) return <div className="content"><Skeleton h={600} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  return (
    <div className="content" style={{ display: 'grid', gap: 14, gridTemplateColumns: '320px 1fr' }}>
      <div className="card fade-up" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Peta Kehadiran</div>
          <div className="page-sub">
            Titik clock-in petugas. Hijau = sudah clock-out, emas = masih on-field.
          </div>
          <div className="seg" style={{ marginTop: 12 }} role="tablist">
            {([1, 7, 30] as const).map(d => (
              <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                {d === 1 ? 'Hari ini' : `${d} hari`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {points.length === 0 ? (
            <EmptyState title="Belum ada clock-in" hint="Petugas yang clock-in dengan izin GPS akan muncul di sini." />
          ) : (
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {points.map(p => {
                const isActive = active === p.id;
                const isOpen = !p.clockOutAt;
                return (
                  <button key={p.id} onClick={() => setActive(p.id)}
                    style={{
                      textAlign: 'left', padding: '10px 12px', borderRadius: 10,
                      border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                      background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                    <Avatar inisial={p.petugasInisial} hue={p.petugasHue} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.petugasNama}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>
                        {p.petugasKode} · {p.branchKode} · {new Date(p.clockInAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span className="chip" style={{
                      background: isOpen ? 'var(--col-dpk-soft)' : 'var(--accent-soft)',
                      color: isOpen ? 'var(--col-dpk)' : 'var(--accent-ink)',
                      fontSize: 10.5,
                    }}>
                      {isOpen ? 'On-field' : 'Selesai'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="card fade-up" style={{ overflow: 'hidden', minHeight: 600 }}>
        {!MAPTILER_KEY ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
            VITE_MAPTILER_API_KEY tidak di-set — peta tidak bisa di-render.
          </div>
        ) : (
          <MlMap
            initialViewState={{ longitude: center.lng, latitude: center.lat, zoom: 11 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={`https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`}
            attributionControl={{ compact: true }}>
            {points.map(p => {
              const isOpen = !p.clockOutAt;
              const isActive = active === p.id;
              return (
                <Marker key={p.id} longitude={p.clockInLng} latitude={p.clockInLat} anchor="bottom"
                  onClick={(e) => { e.originalEvent.stopPropagation(); setActive(p.id); }}>
                  <div style={{
                    width: isActive ? 30 : 22, height: isActive ? 30 : 22,
                    borderRadius: 99, border: '2px solid white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    background: isOpen ? `hsl(${p.petugasHue}, 60%, 50%)` : 'var(--accent)',
                    display: 'grid', placeItems: 'center', color: 'white',
                    fontSize: 9, fontWeight: 800, cursor: 'pointer',
                  }}>
                    {p.petugasInisial}
                  </div>
                </Marker>
              );
            })}
            {active && (() => {
              const p = points.find(x => x.id === active);
              if (!p) return null;
              return (
                <Popup longitude={p.clockInLng} latitude={p.clockInLat} anchor="bottom"
                  onClose={() => setActive(null)} closeButton offset={28}>
                  <div style={{ fontSize: 12 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{p.petugasNama}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>
                      {p.petugasKode} · {p.branchKode}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <Ic.clock size={11} /> {new Date(p.clockInAt).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      {p.clockOutAt && <> → {new Date(p.clockOutAt).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' })}</>}
                    </div>
                    <div className="muted mono" style={{ fontSize: 10, marginTop: 4 }}>
                      {p.clockInLat.toFixed(4)}, {p.clockInLng.toFixed(4)}
                    </div>
                  </div>
                </Popup>
              );
            })()}
          </MlMap>
        )}
      </div>
    </div>
  );
}
