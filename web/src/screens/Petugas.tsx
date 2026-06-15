import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { Avatar, Modal, StatusPill } from '../components/UI';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { PetugasStatus } from '../types';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Branch { id: string; kode: string; nama: string; active: boolean }

interface PetugasRow {
  id: string;
  kode: string;
  nama: string;
  inisial: string;
  wilayah: string;
  hp: string;
  status: 'LAPANGAN' | 'ISTIRAHAT' | 'KANTOR' | 'lapangan' | 'istirahat' | 'kantor';
  branchId: string;
  target: number;
  hue: number;
  active?: boolean;
  kunjungan?: number;
  rencana?: number;
  terkumpul?: number;
}

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const override = useAuth.getState().branchOverride;
  if (override) h['x-branch-id'] = override;
  return h;
}

async function listPetugas(): Promise<PetugasRow[]> {
  return (await axios.get(`${BASE}/petugas`, { withCredentials: true, headers: headers() })).data;
}
async function listBranches(): Promise<Branch[]> {
  return (await axios.get(`${BASE}/branches`, { withCredentials: true, headers: headers() })).data;
}

interface CreatePayload {
  kode: string;
  nama: string;
  inisial: string;
  wilayah: string;
  hp: string;
  branchId: string;
  target: number;
  status: 'LAPANGAN' | 'ISTIRAHAT' | 'KANTOR';
  hue: number;
}

async function createPetugas(p: CreatePayload) {
  return (await axios.post(`${BASE}/petugas`, p, { withCredentials: true, headers: headers() })).data;
}
async function patchPetugas(id: string, p: Partial<CreatePayload & { active: boolean }>) {
  return (await axios.patch(`${BASE}/petugas/${id}`, p, { withCredentials: true, headers: headers() })).data;
}
async function deletePetugas(id: string) {
  return (await axios.delete(`${BASE}/petugas/${id}`, { withCredentials: true, headers: headers() })).data;
}

function normalizeStatus(s: PetugasRow['status']): PetugasStatus {
  const lower = String(s).toLowerCase();
  if (lower === 'lapangan' || lower === 'istirahat' || lower === 'kantor') return lower;
  return 'kantor';
}

export function ScreenPetugas() {
  const me = useAuth(s => s.user);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['petugas'], queryFn: listPetugas });
  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: listBranches });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PetugasRow | null>(null);

  if (q.isPending) return <div className="content" style={{ display: 'grid', gap: 16 }}><Skeleton h={80} /><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const items = q.data ?? [];
  const isAdmin = me?.role === 'ADMIN';

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18 }}>
        <div className="chip"><Ic.users size={14} />{items.length} petugas</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Ic.plus size={16} />Tambah Petugas
        </button>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        {items.length === 0 ? (
          <EmptyState title="Belum ada petugas" hint="Tambahkan petugas pertama dengan tombol di atas." />
        ) : (
          <table className="table">
            <thead><tr>
              <th>Kode</th><th>Petugas</th><th>Wilayah</th><th>HP</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Target Harian</th>
              <th></th>
            </tr></thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id}>
                  <td className="mono">{p.kode}</td>
                  <td>
                    <div className="center gap-2">
                      <Avatar inisial={p.inisial} hue={p.hue} size={28} />
                      <div style={{ fontWeight: 700 }}>{p.nama}</div>
                    </div>
                  </td>
                  <td className="muted">{p.wilayah}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{p.hp}</td>
                  <td><StatusPill status={normalizeStatus(p.status)} /></td>
                  <td style={{ textAlign: 'right' }} className="num">
                    Rp {Number(p.target).toLocaleString('id-ID')}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>
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
        <PetugasForm
          mode="create"
          isAdmin={isAdmin}
          myBranchId={me?.branchId ?? null}
          branches={branchesQ.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['petugas'] }); }}
        />
      )}
      {editing && (
        <PetugasForm
          mode="edit"
          initial={editing}
          isAdmin={isAdmin}
          myBranchId={me?.branchId ?? null}
          branches={branchesQ.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['petugas'] }); }}
        />
      )}
    </div>
  );
}

function PetugasForm({ mode, initial, isAdmin, myBranchId, branches, onClose, onSaved }: {
  mode: 'create' | 'edit';
  initial?: PetugasRow;
  isAdmin: boolean;
  myBranchId: string | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kode, setKode] = useState(initial?.kode ?? '');
  const [nama, setNama] = useState(initial?.nama ?? '');
  const [inisial, setInisial] = useState(initial?.inisial ?? '');
  const [wilayah, setWilayah] = useState(initial?.wilayah ?? '');
  const [hp, setHp] = useState(initial?.hp ?? '');
  const [branchId, setBranchId] = useState(initial?.branchId ?? (myBranchId ?? ''));
  const [target, setTarget] = useState(String(initial?.target ?? 0));
  const [status, setStatus] = useState<'LAPANGAN' | 'ISTIRAHAT' | 'KANTOR'>(
    String(initial?.status ?? 'LAPANGAN').toUpperCase() as 'LAPANGAN' | 'ISTIRAHAT' | 'KANTOR'
  );
  const [hue, setHue] = useState(initial?.hue ?? 156);
  const [active, setActive] = useState(initial?.active ?? true);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => {
      const payload: CreatePayload = {
        kode, nama, inisial: inisial || nama.slice(0, 2).toUpperCase(),
        wilayah, hp, branchId,
        target: Number(target.replace(/\D/g, '')) || 0,
        status, hue,
      };
      return mode === 'create'
        ? createPetugas(payload)
        // For edit, omit kode (immutable on the server).
        : patchPetugas(initial!.id, { ...payload, kode: undefined as any, active });
    },
    onSuccess: onSaved,
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      if (c === 'kode_taken') setErr('Kode petugas sudah dipakai.');
      else if (c === 'forbidden') setErr('Anda tidak punya wewenang di cabang ini.');
      else setErr('Gagal menyimpan. Periksa input.');
    },
  });

  const deactivate = useMutation({
    mutationFn: () => deletePetugas(initial!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['petugas'] }); onClose(); },
    onError: () => setErr('Gagal non-aktifkan.'),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate(); };

  return (
    <Modal onClose={onClose} max={580}>
      <form onSubmit={submit}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="section-title">{mode === 'create' ? 'Tambah Petugas' : 'Edit Petugas'}</div>
            {mode === 'edit' && <div className="muted mono" style={{ fontSize: 12, marginTop: 3 }}>{initial!.kode}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
        </div>

        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Kode">
            <input className="input" value={kode} onChange={e => setKode(e.target.value.toUpperCase())}
              required maxLength={20} pattern="[A-Z0-9]+" disabled={mode === 'edit'}
              placeholder="P7" />
          </Field>
          <Field label="Inisial">
            <input className="input" value={inisial} onChange={e => setInisial(e.target.value.toUpperCase())} maxLength={8} placeholder="AP" />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Nama Lengkap">
            <input className="input" value={nama} onChange={e => setNama(e.target.value)} required maxLength={200} />
          </Field></div>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Wilayah Binaan">
            <input className="input" value={wilayah} onChange={e => setWilayah(e.target.value)} required maxLength={200} placeholder="Cibinong – Bojonggede" />
          </Field></div>
          <Field label="No. HP">
            <input className="input" value={hp} onChange={e => setHp(e.target.value)} required maxLength={40} placeholder="0812-3456-7890" />
          </Field>
          <Field label="Cabang">
            <select className="input" value={branchId} onChange={e => setBranchId(e.target.value)} disabled={!isAdmin} required>
              <option value="">-- pilih cabang --</option>
              {branches.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.kode} · {b.nama}</option>)}
            </select>
          </Field>
          <Field label="Target Harian (Rp)">
            <input className="input" type="text" value={Number(target.replace(/\D/g, '')).toLocaleString('id-ID')}
              onChange={e => setTarget(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={e => setStatus(e.target.value as any)}>
              <option value="LAPANGAN">Lapangan</option>
              <option value="ISTIRAHAT">Istirahat</option>
              <option value="KANTOR">Kantor</option>
            </select>
          </Field>
          <Field label="Warna avatar (hue 0–360)">
            <input className="input" type="number" min={0} max={360} value={hue} onChange={e => setHue(Number(e.target.value))} />
          </Field>
          {mode === 'edit' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="center gap-2" style={{ fontSize: 13, fontWeight: 600 }}>
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                Aktif (uncheck untuk non-aktifkan)
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
