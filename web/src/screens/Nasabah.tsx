import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { KolBadge, Modal } from '../components/UI';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ScreenNasabah360 } from './Nasabah360';

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
async function bulkImport(rows: CreatePayload[]): Promise<{ imported: number; total: number; outcomes: Array<{ index: number; kode: string; status: string; message?: string }> }> {
  return (await axios.post(`${BASE}/nasabah/bulk`, { rows }, { withCredentials: true, headers: headers() })).data;
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
  const [view360, setView360] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
        <div className="center gap-2">
          <button className="btn" onClick={() => setImporting(true)}>
            <Ic.download size={15} style={{ transform: 'rotate(180deg)' }} />Import CSV
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Ic.plus size={16} />Tambah Nasabah
          </button>
        </div>
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
                    <div className="center gap-2" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setView360(n.id)}>
                        <Ic.eye size={14} />360°
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(n)}>
                        <Ic.settings size={14} />Edit
                      </button>
                    </div>
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
      {importing && (
        <BulkImport
          petugas={petugasQ.data ?? []}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); qc.invalidateQueries({ queryKey: ['nasabah'] }); }}
        />
      )}
      {view360 && (
        <ScreenNasabah360 nasabahId={view360} onClose={() => setView360(null)} />
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

interface ParsedRow {
  row: number;
  data?: CreatePayload;
  errors: string[];
}

// Minimal RFC-4180 CSV parser — handles quoted fields with commas + newlines
// inside, and "" escaping. No external dependency keeps the chunk lean.
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (cur !== '' || row.length > 0) { row.push(cur); out.push(row); row = []; cur = ''; }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else cur += c;
  }
  if (cur !== '' || row.length > 0) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(cell => cell !== ''));
}

const CSV_TEMPLATE_HEADERS = [
  'kode', 'nama', 'alamat', 'hp', 'lat', 'lng',
  'kol', 'akad', 'plafon', 'tenor', 'angsuran', 'sisa', 'dpd', 'dueIn', 'petugasKode',
];

const SAMPLE_CSV = CSV_TEMPLATE_HEADERS.join(',') + '\n' +
  'N2024001,Toko Maju,Jl. Mawar 1,08111000111,-6.4825,106.8595,K1,MURABAHAH,5000000,12,500000,5000000,0,5,PT1\n' +
  'N2024002,Warung Sari,Jl. Melati 7,08222333444,,,K2,MUSYARAKAH,3000000,18,200000,2500000,15,-2,PT1\n';

function downloadTemplate() {
  const blob = new Blob(['\ufeff' + SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'template-nasabah.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function BulkImport({ petugas, onClose, onDone }: {
  petugas: PetugasRow[]; onClose: () => void; onDone: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{ imported: number; total: number; outcomes: Array<{ kode: string; status: string }> } | null>(null);
  const [sending, setSending] = useState(false);
  const [globalErr, setGlobalErr] = useState<string | null>(null);

  const petugasByKode = new Map(petugas.map(p => [p.kode, p]));

  const onFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    setGlobalErr(null);
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) { setGlobalErr('File CSV kosong atau tidak punya header.'); return; }
    const header = rows[0].map(h => h.trim());
    const colIdx = (k: string) => header.findIndex(h => h.toLowerCase() === k.toLowerCase());

    const missingCols = CSV_TEMPLATE_HEADERS.filter(c => colIdx(c) < 0 && c !== 'lat' && c !== 'lng' && c !== 'dpd' && c !== 'dueIn');
    if (missingCols.length) { setGlobalErr(`Header CSV kurang kolom: ${missingCols.join(', ')}`); return; }

    const out: ParsedRow[] = [];
    for (let r = 1; r < rows.length; r++) {
      const errs: string[] = [];
      const row = rows[r];
      const get = (k: string) => {
        const i = colIdx(k);
        return i >= 0 ? (row[i] ?? '').trim() : '';
      };
      const num = (v: string) => v === '' ? undefined : Number(v.replace(/[^\d.-]/g, ''));
      const reqNum = (v: string, name: string): number => {
        const n = num(v);
        if (n == null || Number.isNaN(n)) { errs.push(`${name} bukan angka`); return 0; }
        return n;
      };
      const kode = get('kode');
      if (!/^N[A-Z0-9]+$/.test(kode)) errs.push('kode harus awalan N + huruf besar/angka');
      const petKode = get('petugasKode');
      const pet = petugasByKode.get(petKode);
      if (!pet) errs.push(`petugas ${petKode} tidak ditemukan`);
      const kol = (get('kol') || 'K1').toUpperCase();
      if (!['K1', 'K2', 'K3', 'K4', 'K5'].includes(kol)) errs.push('kol tidak valid');
      const akad = (get('akad') || 'MURABAHAH').toUpperCase();
      if (!['MURABAHAH', 'MUSYARAKAH', 'IJARAH', 'MUSYARAKAH_MUTANAQISAH', 'ISTISHNA'].includes(akad)) errs.push('akad tidak valid');
      const data: CreatePayload = {
        kode, nama: get('nama'), alamat: get('alamat'), hp: get('hp'),
        lat: num(get('lat')),
        lng: num(get('lng')),
        kol: kol as Kol,
        akad: akad as Akad,
        plafon: reqNum(get('plafon'), 'plafon'),
        tenor: reqNum(get('tenor'), 'tenor') || 12,
        angsuran: reqNum(get('angsuran'), 'angsuran'),
        sisa: reqNum(get('sisa'), 'sisa'),
        dpd: num(get('dpd')) ?? 0,
        dueIn: num(get('dueIn')) ?? 0,
        petugasId: pet?.id ?? '',
      };
      if (!data.nama) errs.push('nama wajib');
      if (!data.alamat) errs.push('alamat wajib');
      if (!data.hp) errs.push('hp wajib');
      out.push({ row: r + 1, data: errs.length === 0 ? data : undefined, errors: errs });
    }
    setParsed(out);
  };

  const valid = parsed.filter(p => p.data && p.errors.length === 0);
  const invalid = parsed.filter(p => p.errors.length > 0);

  const submit = async () => {
    if (valid.length === 0) return;
    setSending(true);
    try {
      const r = await bulkImport(valid.map(p => p.data!));
      setResult(r);
    } catch (e: any) {
      setGlobalErr(e?.response?.data?.error === 'rate_limited'
        ? 'Terlalu banyak request. Coba lagi sebentar.'
        : 'Gagal import. Periksa data.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={onClose} max={780}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">Bulk Import Nasabah</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            Upload file CSV (max 2.000 baris) untuk import banyak nasabah sekaligus.
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body">
        {!result && (
          <>
            <div className="between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <label className="btn">
                <Ic.download size={15} style={{ transform: 'rotate(180deg)' }} />Pilih file CSV
                <input type="file" accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
              </label>
              <button className="btn btn-sm btn-ghost" onClick={downloadTemplate}>
                <Ic.download size={13} />Unduh template
              </button>
              {fileName && <span className="muted mono" style={{ fontSize: 11.5 }}>{fileName}</span>}
            </div>

            {globalErr && (
              <div className="center gap-2" style={{
                marginBottom: 12, background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
                borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
              }}>
                <Ic.alert size={15} />{globalErr}
              </div>
            )}

            {parsed.length > 0 && (
              <>
                <div className="center gap-3" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                  <div className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
                    <Ic.checkCircle size={13} />{valid.length} valid
                  </div>
                  {invalid.length > 0 && (
                    <div className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
                      <Ic.alert size={13} />{invalid.length} error
                    </div>
                  )}
                </div>
                <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                      <tr><th>Row</th><th>Kode</th><th>Nama</th><th>Petugas</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {parsed.map(p => (
                        <tr key={p.row} style={{ background: p.errors.length ? 'var(--col-macet-soft)' : undefined }}>
                          <td className="mono">{p.row}</td>
                          <td className="mono">{p.data?.kode ?? '—'}</td>
                          <td>{p.data?.nama ?? '—'}</td>
                          <td className="mono">{p.data?.petugasId ? petugas.find(x => x.id === p.data!.petugasId)?.kode ?? '—' : '—'}</td>
                          <td style={{ fontSize: 11.5 }}>
                            {p.errors.length === 0
                              ? <span style={{ color: 'var(--accent)' }}>OK</span>
                              : <span style={{ color: 'var(--col-macet)' }}>{p.errors.join(' · ')}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {result && (
          <div>
            <div className="card card-pad" style={{ background: 'var(--accent-soft)', boxShadow: 'none', marginBottom: 12 }}>
              <div className="center gap-2" style={{ color: 'var(--accent-ink)', fontWeight: 800, fontSize: 14 }}>
                <Ic.checkCircle size={18} />{result.imported} nasabah berhasil di-import dari {result.total} baris.
              </div>
            </div>
            {result.outcomes.filter(o => o.status !== 'imported').length > 0 && (
              <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
                <table className="table" style={{ fontSize: 12 }}>
                  <thead><tr><th>Kode</th><th>Status</th></tr></thead>
                  <tbody>
                    {result.outcomes.filter(o => o.status !== 'imported').map(o => (
                      <tr key={o.kode}>
                        <td className="mono">{o.kode}</td>
                        <td style={{ color: 'var(--col-macet)' }}>{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="modal-foot">
        {result
          ? <button className="btn btn-primary" onClick={onDone}>Selesai</button>
          : <>
              <button className="btn" onClick={onClose}>Batal</button>
              <button className="btn btn-primary" disabled={valid.length === 0 || sending} onClick={submit}>
                {sending ? 'Mengirim…' : `Import ${valid.length} baris`}
              </button>
            </>
        }
      </div>
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
