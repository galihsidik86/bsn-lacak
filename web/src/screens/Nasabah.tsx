import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { KolBadge, Modal } from '../components/UI';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface PetugasRow { id: string; kode: string; nama: string; branchId: string; active?: boolean }

type Kol = 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
type Akad = 'MURABAHAH' | 'MUSYARAKAH' | 'IJARAH' | 'MUSYARAKAH_MUTANAQISAH' | 'ISTISHNA';

interface NasabahRow {
  id: string;
  kode: string;
  nama: string;
  alamat: string;
  hp: string;
  lat: number | null;
  lng: number | null;
  kol: Kol;
  akad: Akad;
  plafon: string | number;
  tenor: number;
  angsuran: string | number;
  sisa: string | number;
  dpd: number;
  dueIn: number;
  active: boolean;
  petugasId: string;
  branchId: string;
}

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const override = useAuth.getState().branchOverride;
  if (override) h['x-branch-id'] = override;
  return h;
}

async function listNasabah(includeInactive: boolean): Promise<NasabahRow[]> {
  return (await axios.get(`${BASE}/nasabah`, {
    withCredentials: true, headers: headers(),
    params: { includeInactive: includeInactive ? '1' : '0' },
  })).data;
}
async function listPetugas(): Promise<PetugasRow[]> {
  return (await axios.get(`${BASE}/petugas`, { withCredentials: true, headers: headers() })).data;
}

interface CreatePayload {
  kode: string;
  nama: string;
  alamat: string;
  hp: string;
  lat?: number;
  lng?: number;
  kol: Kol;
  akad: Akad;
  plafon: number;
  tenor: number;
  angsuran: number;
  sisa: number;
  dpd: number;
  dueIn: number;
  petugasId: string;
}

async function createNasabah(p: CreatePayload) {
  return (await axios.post(`${BASE}/nasabah`, p, { withCredentials: true, headers: headers() })).data;
}
async function patchNasabah(id: string, p: Partial<CreatePayload & { active: boolean }>) {
  return (await axios.patch(`${BASE}/nasabah/${id}`, p, { withCredentials: true, headers: headers() })).data;
}
async function deleteNasabah(id: string) {
  return (await axios.delete(`${BASE}/nasabah/${id}`, { withCredentials: true, headers: headers() })).data;
}

const KOL_LABEL: Record<Kol, string> = {
  K1: 'Lancar', K2: 'DPK', K3: 'Kurang Lancar', K4: 'Diragukan', K5: 'Macet',
};
const AKAD_LABEL: Record<Akad, string> = {
  MURABAHAH: 'Murabahah', MUSYARAKAH: 'Musyarakah', IJARAH: 'Ijarah',
  MUSYARAKAH_MUTANAQISAH: 'Musyarakah Mutanaqisah', ISTISHNA: 'Istishna',
};
const KOL_KEY_MAP: Record<Kol, 1 | 2 | 3 | 4 | 5> = { K1: 1, K2: 2, K3: 3, K4: 4, K5: 5 };

const RP = (v: string | number) => 'Rp ' + Number(v).toLocaleString('id-ID');

export function ScreenNasabah() {
  const qc = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['nasabah', { includeInactive }], queryFn: () => listNasabah(includeInactive) });
  const petugasQ = useQuery({ queryKey: ['petugas'], queryFn: listPetugas });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<NasabahRow | null>(null);

  if (q.isPending) return <div className="content" style={{ display: 'grid', gap: 16 }}><Skeleton h={80} /><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const items = q.data ?? [];
  const filtered = search
    ? items.filter(n => (n.nama + ' ' + n.kode).toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="chip"><Ic.users size={14} />{items.length} nasabah</div>
          <div className="search" style={{ width: 280 }}>
            <Ic.search size={16} />
            <input placeholder="Cari nama / kode…" type="search"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <label className="center gap-2" style={{ fontSize: 13, fontWeight: 600 }}>
            <input type="checkbox" checked={includeInactive}
              onChange={e => setIncludeInactive(e.target.checked)} />
            Tampilkan inactive
          </label>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Ic.plus size={16} />Tambah Nasabah
        </button>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <EmptyState title="Belum ada nasabah" hint="Tambahkan nasabah pertama dengan tombol di atas." />
        ) : (
          <table className="table">
            <thead><tr>
              <th>Kode</th><th>Nama</th><th>Alamat</th><th>Kol</th><th>Akad</th>
              <th style={{ textAlign: 'right' }}>Angsuran</th>
              <th style={{ textAlign: 'right' }}>Sisa</th>
              <th></th>
            </tr></thead>
            <tbody>
              {filtered.map(n => (
                <tr key={n.id} style={{ opacity: n.active ? 1 : 0.45 }}>
                  <td className="mono">{n.kode}</td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{n.nama}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{n.hp}</div>
                  </td>
                  <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.alamat}</td>
                  <td><KolBadge kol={KOL_KEY_MAP[n.kol]} /></td>
                  <td style={{ fontSize: 12, fontWeight: 600 }}>{AKAD_LABEL[n.akad]}</td>
                  <td style={{ textAlign: 'right' }} className="num">{RP(n.angsuran)}</td>
                  <td style={{ textAlign: 'right' }} className="num">{RP(n.sisa)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(n)}>
                      <Ic.settings size={14} />Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <NasabahForm
          mode="create"
          petugas={petugasQ.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['nasabah'] }); }}
        />
      )}
      {editing && (
        <NasabahForm
          mode="edit"
          initial={editing}
          petugas={petugasQ.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['nasabah'] }); }}
        />
      )}
    </div>
  );
}

function NasabahForm({ mode, initial, petugas, onClose, onSaved }: {
  mode: 'create' | 'edit';
  initial?: NasabahRow;
  petugas: PetugasRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [kode, setKode] = useState(initial?.kode ?? '');
  const [nama, setNama] = useState(initial?.nama ?? '');
  const [alamat, setAlamat] = useState(initial?.alamat ?? '');
  const [hp, setHp] = useState(initial?.hp ?? '');
  const [lat, setLat] = useState(initial?.lat != null ? String(initial.lat) : '');
  const [lng, setLng] = useState(initial?.lng != null ? String(initial.lng) : '');
  const [kol, setKol] = useState<Kol>(initial?.kol ?? 'K1');
  const [akad, setAkad] = useState<Akad>(initial?.akad ?? 'MURABAHAH');
  const [plafon, setPlafon] = useState(String(initial?.plafon ?? 0));
  const [tenor, setTenor] = useState(String(initial?.tenor ?? 12));
  const [angsuran, setAngsuran] = useState(String(initial?.angsuran ?? 0));
  const [sisa, setSisa] = useState(String(initial?.sisa ?? 0));
  const [dpd, setDpd] = useState(String(initial?.dpd ?? 0));
  const [dueIn, setDueIn] = useState(String(initial?.dueIn ?? 0));
  const [petugasId, setPetugasId] = useState(initial?.petugasId ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const num = (v: string) => Number(v.replace(/\D/g, '')) || 0;
      const payload: CreatePayload & { active?: boolean } = {
        kode, nama, alamat, hp,
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        kol, akad,
        plafon: num(plafon),
        tenor: Number(tenor) || 12,
        angsuran: num(angsuran),
        sisa: num(sisa),
        dpd: Number(dpd) || 0,
        dueIn: Number(dueIn) || 0,
        petugasId,
      };
      return mode === 'create'
        ? createNasabah(payload)
        : patchNasabah(initial!.id, { ...payload, kode: undefined as any, active });
    },
    onSuccess: onSaved,
    onError: (e: any) => {
      const code = e?.response?.data?.error;
      if (code === 'kode_taken') setErr('Kode nasabah sudah dipakai.');
      else if (code === 'cross_branch_forbidden') setErr('Petugas tujuan beda cabang dari Anda.');
      else if (code === 'petugas_inactive') setErr('Petugas yang dipilih sudah non-aktif.');
      else if (code === 'unknown_petugas') setErr('Petugas tidak ditemukan.');
      else setErr('Gagal menyimpan. Periksa input.');
    },
  });

  const deactivate = useMutation({
    mutationFn: () => deleteNasabah(initial!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nasabah'] }); onClose(); },
    onError: () => setErr('Gagal non-aktifkan.'),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); };

  return (
    <Modal onClose={onClose} max={680}>
      <form onSubmit={submit}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="section-title">{mode === 'create' ? 'Tambah Nasabah' : 'Edit Nasabah'}</div>
            {mode === 'edit' && (
              <div className="muted mono" style={{ fontSize: 12, marginTop: 3 }}>
                {initial!.kode}
                {!active && <span style={{ marginLeft: 8, color: 'var(--col-macet)', fontWeight: 700 }}>· INACTIVE</span>}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
        </div>

        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Kode">
            <input className="input" value={kode} onChange={e => setKode(e.target.value.toUpperCase())}
              required maxLength={20} pattern="N[A-Z0-9]+" disabled={mode === 'edit'}
              placeholder="N2024001" />
          </Field>
          <Field label="Petugas Binaan">
            <select className="input" value={petugasId} onChange={e => setPetugasId(e.target.value)} required>
              <option value="">-- pilih petugas --</option>
              {petugas.filter(p => p.active !== false).map(p =>
                <option key={p.id} value={p.id}>{p.kode} · {p.nama}</option>)}
            </select>
          </Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Nama">
            <input className="input" value={nama} onChange={e => setNama(e.target.value)} required maxLength={200} />
          </Field></div>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Alamat">
            <input className="input" value={alamat} onChange={e => setAlamat(e.target.value)} required maxLength={500} />
          </Field></div>
          <Field label="No. HP">
            <input className="input" value={hp} onChange={e => setHp(e.target.value)} required maxLength={40} placeholder="0812-3456-7890" />
          </Field>
          <Field label="Kolektabilitas">
            <select className="input" value={kol} onChange={e => setKol(e.target.value as Kol)}>
              {(Object.keys(KOL_LABEL) as Kol[]).map(k => <option key={k} value={k}>{k} · {KOL_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Akad">
            <select className="input" value={akad} onChange={e => setAkad(e.target.value as Akad)}>
              {(Object.keys(AKAD_LABEL) as Akad[]).map(a => <option key={a} value={a}>{AKAD_LABEL[a]}</option>)}
            </select>
          </Field>
          <Field label="Tenor (bulan)">
            <input className="input" type="number" min={1} max={360} value={tenor}
              onChange={e => setTenor(e.target.value)} required />
          </Field>
          <Field label="Plafon (Rp)">
            <input className="input" type="text"
              value={Number(plafon.replace(/\D/g, '')).toLocaleString('id-ID')}
              onChange={e => setPlafon(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
          <Field label="Angsuran / bulan (Rp)">
            <input className="input" type="text"
              value={Number(angsuran.replace(/\D/g, '')).toLocaleString('id-ID')}
              onChange={e => setAngsuran(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
          <Field label="Sisa pokok (Rp)">
            <input className="input" type="text"
              value={Number(sisa.replace(/\D/g, '')).toLocaleString('id-ID')}
              onChange={e => setSisa(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
          <Field label="DPD (hari)">
            <input className="input" type="number" min={0} value={dpd} onChange={e => setDpd(e.target.value)} />
          </Field>
          <Field label="DueIn (hari, − = lewat)">
            <input className="input" type="number" value={dueIn} onChange={e => setDueIn(e.target.value)} />
          </Field>
          <Field label="Latitude">
            <input className="input" type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} placeholder="-6.4825" />
          </Field>
          <Field label="Longitude">
            <input className="input" type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} placeholder="106.8595" />
          </Field>
          {mode === 'edit' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="center gap-2" style={{ fontSize: 13, fontWeight: 600 }}>
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                Aktif
              </label>
            </div>
          )}
        </div>

        {err && (
          <div style={{ padding: '0 24px 14px' }}>
            <div className="center gap-2" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600 }}>
              <Ic.alert size={15} />{err}
            </div>
          </div>
        )}

        <div className="modal-foot">
          {mode === 'edit' && active && (
            <button type="button" className="btn"
              onClick={() => { if (window.confirm(`Non-aktifkan ${initial!.nama}?`)) deactivate.mutate(); }}
              disabled={deactivate.isPending}
              style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)', border: 'none' }}>
              <Ic.x size={15} />Non-aktifkan
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}
