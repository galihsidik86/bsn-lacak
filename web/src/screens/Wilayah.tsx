import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Map as MlMap, Marker, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { Modal } from '../components/UI';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_API_KEY;
const MAPTILER_STYLE = import.meta.env.VITE_MAPTILER_STYLE || 'streets-v2';
const HUB = { lat: -6.4025, lng: 106.7942 };

interface PetugasRef { id: string; kode: string; nama: string }
interface PolygonGeom { type: 'Polygon'; coordinates: number[][][] }
interface Wilayah {
  id: string;
  branchId: string;
  nama: string;
  polygon: PolygonGeom;
  active: boolean;
  petugas: PetugasRef[];
}

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

async function listWilayah(): Promise<Wilayah[]> {
  return (await axios.get(`${BASE}/wilayah`, { withCredentials: true, headers: headers() })).data;
}
async function listPetugas(): Promise<PetugasRef[]> {
  return (await axios.get(`${BASE}/petugas`, { withCredentials: true, headers: headers() })).data;
}
async function createWilayah(p: { nama: string; polygon: PolygonGeom; petugasIds: string[] }) {
  return (await axios.post(`${BASE}/wilayah`, p, { withCredentials: true, headers: headers() })).data;
}
async function patchWilayah(id: string, p: Partial<{ nama: string; polygon: PolygonGeom; petugasIds: string[] }>) {
  return (await axios.patch(`${BASE}/wilayah/${id}`, p, { withCredentials: true, headers: headers() })).data;
}
async function deleteWilayah(id: string) {
  return (await axios.delete(`${BASE}/wilayah/${id}`, { withCredentials: true, headers: headers() })).data;
}

export function ScreenWilayah() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['wilayah'], queryFn: listWilayah });
  const petugasQ = useQuery({ queryKey: ['petugas'], queryFn: listPetugas });
  const [editing, setEditing] = useState<Wilayah | null>(null);
  const [creating, setCreating] = useState(false);

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const rows = q.data ?? [];

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="chip"><Ic.layers size={14} />{rows.length} wilayah</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Ic.plus size={16} />Tambah Wilayah
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card"><EmptyState title="Belum ada wilayah" hint="Gambar polygon di peta untuk membuat wilayah binaan pertama." /></div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {rows.map(w => (
            <button key={w.id} onClick={() => setEditing(w)}
              className="card fade-up" style={{ textAlign: 'left', overflow: 'hidden', cursor: 'pointer', padding: 0 }}>
              <WilayahPreview polygon={w.polygon} />
              <div style={{ padding: 14 }}>
                <div className="between">
                  <div style={{ fontWeight: 800 }}>{w.nama}</div>
                  <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
                    <Ic.user size={12} />{w.petugas.length}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.petugas.length === 0 ? 'Belum ada petugas ditugaskan' : w.petugas.map(p => p.nama).join(', ')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <WilayahForm
          initial={editing ?? undefined}
          petugas={petugasQ.data ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false); setEditing(null);
            qc.invalidateQueries({ queryKey: ['wilayah'] });
            qc.invalidateQueries({ queryKey: ['petugas'] });
          }}
        />
      )}
    </div>
  );
}

function WilayahPreview({ polygon }: { polygon: PolygonGeom }) {
  const accent = 'var(--accent)';
  const geo = useMemo(() => ({ type: 'Feature' as const, properties: {}, geometry: polygon }), [polygon]);
  const styleUrl = `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`;
  const bounds = useMemo(() => {
    const ring = polygon.coordinates[0] ?? [];
    const lngs = ring.map(p => p[0]);
    const lats = ring.map(p => p[1]);
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] as [[number, number], [number, number]];
  }, [polygon]);

  if (!MAPTILER_KEY) {
    return <div style={{ height: 140, background: 'var(--surface-2)' }} />;
  }
  return (
    <div style={{ height: 140 }}>
      <MlMap
        initialViewState={{ bounds, fitBoundsOptions: { padding: 24 } }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={styleUrl}
        interactive={false}
        attributionControl={false}>
        <Source id="zone" type="geojson" data={geo}>
          <Layer id="zone-fill" type="fill" paint={{ 'fill-color': accent, 'fill-opacity': 0.18 }} />
          <Layer id="zone-line" type="line" paint={{ 'line-color': accent, 'line-width': 2 }} />
        </Source>
      </MlMap>
    </div>
  );
}

// Polygon editor — click map to add vertex, drag vertex to adjust, "Undo"
// removes the last vertex. A finished polygon needs ≥ 3 distinct vertices;
// the closure ring is appended automatically on save.
function WilayahForm({ initial, petugas, onClose, onSaved }: {
  initial?: Wilayah; petugas: PetugasRef[];
  onClose: () => void; onSaved: () => void;
}) {
  const [nama, setNama] = useState(initial?.nama ?? '');
  const initialVerts = initial
    ? (initial.polygon.coordinates[0] ?? []).slice(0, -1).map(p => ({ lng: p[0], lat: p[1] }))
    : [] as { lat: number; lng: number }[];
  const [vertices, setVertices] = useState(initialVerts);
  const [assigned, setAssigned] = useState<string[]>(initial?.petugas.map(p => p.id) ?? []);
  const [err, setErr] = useState<string | null>(null);

  const qc = useQueryClient();
  const accent = 'var(--accent)';

  const onMapClick = (e: MapLayerMouseEvent) => {
    setVertices(v => [...v, { lat: e.lngLat.lat, lng: e.lngLat.lng }]);
  };
  const undo = () => setVertices(v => v.slice(0, -1));
  const reset = () => setVertices([]);
  const onVertexDrag = (i: number, lng: number, lat: number) => {
    setVertices(v => v.map((p, idx) => idx === i ? { lat, lng } : p));
  };
  const removeVertex = (i: number) => setVertices(v => v.filter((_, idx) => idx !== i));

  const polygon: PolygonGeom | null = vertices.length >= 3 ? {
    type: 'Polygon',
    coordinates: [[...vertices.map(p => [p.lng, p.lat]), [vertices[0].lng, vertices[0].lat]]],
  } : null;

  const previewGeo = useMemo(() => polygon ? {
    type: 'FeatureCollection' as const,
    features: [{ type: 'Feature' as const, properties: {}, geometry: polygon }],
  } : { type: 'FeatureCollection' as const, features: [] }, [polygon]);

  const save = useMutation({
    mutationFn: async () => {
      if (!polygon) throw new Error('need at least 3 vertices');
      return initial
        ? patchWilayah(initial.id, { nama, polygon, petugasIds: assigned })
        : createWilayah({ nama, polygon, petugasIds: assigned });
    },
    onSuccess: onSaved,
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      if (c === 'cross_branch_forbidden') setErr('Salah satu petugas yang dipilih beda cabang.');
      else setErr('Gagal menyimpan. Periksa input.');
    },
  });

  const deactivate = useMutation({
    mutationFn: () => deleteWilayah(initial!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wilayah'] }); onClose(); },
    onError: () => setErr('Gagal non-aktifkan.'),
  });

  const styleUrl = `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${MAPTILER_KEY}`;

  return (
    <Modal onClose={onClose} max={820}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">{initial ? 'Edit Wilayah' : 'Tambah Wilayah'}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            Klik di peta untuk menambah vertex polygon. Drag vertex untuk geser. Min. 3 vertex.
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>

      <div className="modal-body">
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Nama Wilayah</span>
            <input className="input" value={nama} onChange={e => setNama(e.target.value)}
              required maxLength={200} placeholder="Cibinong Selatan, Citayam Barat, dst." />
          </label>

          <div style={{ position: 'relative', height: 380, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
            {MAPTILER_KEY ? (
              <MlMap
                initialViewState={polygon
                  ? { bounds: getBounds(vertices), fitBoundsOptions: { padding: 24 } }
                  : { longitude: HUB.lng, latitude: HUB.lat, zoom: 12 }}
                style={{ width: '100%', height: '100%' }}
                mapStyle={styleUrl}
                onClick={onMapClick}
                cursor="crosshair">
                <Source id="draft" type="geojson" data={previewGeo}>
                  <Layer id="draft-fill" type="fill" paint={{ 'fill-color': accent, 'fill-opacity': 0.18 }} />
                  <Layer id="draft-line" type="line" paint={{ 'line-color': accent, 'line-width': 2.5 }} />
                </Source>
                {vertices.map((v, i) => (
                  <Marker key={i} longitude={v.lng} latitude={v.lat} draggable
                    onDragEnd={(e) => onVertexDrag(i, e.lngLat.lng, e.lngLat.lat)}>
                    <button onClick={(e) => { e.stopPropagation(); removeVertex(i); }}
                      title="Klik untuk hapus, drag untuk geser"
                      style={{
                        width: 18, height: 18, borderRadius: 99, border: '2.5px solid white',
                        background: accent, cursor: 'move', padding: 0,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.35)',
                      }} />
                  </Marker>
                ))}
              </MlMap>
            ) : (
              <div className="center" style={{ height: '100%', justifyContent: 'center', color: 'var(--ink-3)' }}>
                Map key belum dipasang
              </div>
            )}
            <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={undo} disabled={vertices.length === 0}
                style={{ background: 'rgba(255,255,255,0.95)' }}>
                <Ic.x size={13} />Undo
              </button>
              <button className="btn btn-sm" onClick={reset} disabled={vertices.length === 0}
                style={{ background: 'rgba(255,255,255,0.95)' }}>
                Reset
              </button>
            </div>
            <div style={{
              position: 'absolute', bottom: 10, left: 10, background: 'var(--ink)', color: 'white',
              borderRadius: 8, padding: '4px 9px', fontSize: 11, fontWeight: 700,
            }}>
              {vertices.length} vertex {polygon ? '· polygon valid ✓' : '· min. 3 untuk valid'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 5 }}>
              Tugaskan Petugas (multi-select)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, maxHeight: 160, overflow: 'auto', padding: 8, border: '1px solid var(--line)', borderRadius: 10 }}>
              {petugas.length === 0
                ? <div className="muted" style={{ fontSize: 12, gridColumn: '1 / -1', padding: 6 }}>Belum ada petugas.</div>
                : petugas.map(p => {
                    const on = assigned.includes(p.id);
                    return (
                      <label key={p.id} className="center gap-2" style={{
                        padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
                        background: on ? 'var(--accent-soft)' : 'transparent',
                      }}>
                        <input type="checkbox" checked={on}
                          onChange={e => setAssigned(a => e.target.checked ? [...a, p.id] : a.filter(x => x !== p.id))} />
                        <span><strong className="mono">{p.kode}</strong> · {p.nama}</span>
                      </label>
                    );
                  })}
            </div>
          </div>
        </div>

        {err && (
          <div className="center gap-2" style={{
            marginTop: 12, background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
          }}>
            <Ic.alert size={15} />{err}
          </div>
        )}
      </div>

      <div className="modal-foot">
        {initial && (
          <button type="button" className="btn"
            onClick={() => { if (window.confirm(`Non-aktifkan wilayah "${initial.nama}"?`)) deactivate.mutate(); }}
            disabled={deactivate.isPending}
            style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)', border: 'none' }}>
            <Ic.x size={15} />Non-aktifkan
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>Batal</button>
        <button type="button" className="btn btn-primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || !polygon || !nama.trim()}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </Modal>
  );
}

function getBounds(verts: { lat: number; lng: number }[]): [[number, number], [number, number]] {
  const lngs = verts.map(v => v.lng);
  const lats = verts.map(v => v.lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}
