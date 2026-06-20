import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { Badge, Modal } from '../components/UI';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Branch {
  id: string;
  kode: string;
  nama: string;
  alamat: string | null;
  kepalaCabang: string | null;
  active: boolean;
  targetCollection: string | number;
  targetVisits: number;
  targetApprovalRate: number;
  budgetOperational: string | number;
  budgetCommission: string | number;
  defaultCommissionBps: number | null;
  csatEnabled: boolean;
  _count: { petugas: number; nasabah: number; users: number };
  createdAt: string;
  updatedAt: string;
}

function authHeader() {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function listBranches(): Promise<Branch[]> {
  const r = await axios.get(`${BASE}/branches`, { withCredentials: true, headers: authHeader() });
  return r.data;
}

interface UpsertPayload {
  kode: string;
  nama: string;
  alamat?: string | null;
  kepalaCabang?: string | null;
  active?: boolean;
  targetCollection?: string | number;
  targetVisits?: number;
  targetApprovalRate?: number;
  budgetOperational?: string | number;
  budgetCommission?: string | number;
  defaultCommissionBps?: number | null;
  csatEnabled?: boolean;
}

async function createBranch(p: UpsertPayload) {
  return (await axios.post(`${BASE}/branches`, p, { withCredentials: true, headers: authHeader() })).data;
}
async function updateBranch(id: string, p: Partial<UpsertPayload>) {
  return (await axios.patch(`${BASE}/branches/${id}`, p, { withCredentials: true, headers: authHeader() })).data;
}
async function deactivateBranch(id: string) {
  return (await axios.delete(`${BASE}/branches/${id}`, { withCredentials: true, headers: authHeader() })).data;
}

export function ScreenBranch() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['branches'], queryFn: listBranches });
  const [editing, setEditing] = useState<Branch | null>(null);
  const [creating, setCreating] = useState(false);

  if (q.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <Skeleton h={80} />
        <Skeleton h={400} />
      </div>
    );
  }
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const items = q.data ?? [];

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18 }}>
        <div className="chip"><Ic.layers size={14} />{items.length} cabang · {items.filter(b => b.active).length} aktif</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Ic.plus size={16} />Tambah Cabang
        </button>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        {items.length === 0 ? (
          <EmptyState title="Belum ada cabang" hint="Tambahkan cabang pertama dengan tombol di atas." />
        ) : (
          <table className="table">
            <thead><tr>
              <th>Kode</th><th>Nama Cabang</th><th>Alamat</th><th>Kepala Cabang</th>
              <th style={{ textAlign: 'right' }}>Petugas</th>
              <th style={{ textAlign: 'right' }}>Nasabah</th>
              <th style={{ textAlign: 'right' }}>User</th>
              <th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {items.map(b => (
                <tr key={b.id}>
                  <td className="mono">{b.kode}</td>
                  <td><div style={{ fontWeight: 700 }}>{b.nama}</div></td>
                  <td className="muted">{b.alamat ?? '—'}</td>
                  <td>{b.kepalaCabang ?? '—'}</td>
                  <td style={{ textAlign: 'right' }} className="num">{b._count.petugas}</td>
                  <td style={{ textAlign: 'right' }} className="num">{b._count.nasabah}</td>
                  <td style={{ textAlign: 'right' }} className="num">{b._count.users}</td>
                  <td>
                    {b.active
                      ? <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.checkCircle}>Aktif</Badge>
                      : <Badge c="var(--ink-3)" soft="var(--surface-2)" icon={Ic.x}>Nonaktif</Badge>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(b)} aria-label={`Edit ${b.nama}`}>
                      <Ic.settings size={14} />Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(creating || editing) && (
        <BranchForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ['branches'] })}
        />
      )}
    </div>
  );
}

function BranchForm({ initial, onClose, onSaved }: {
  initial: Branch | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kode, setKode] = useState(initial?.kode ?? '');
  const [nama, setNama] = useState(initial?.nama ?? '');
  const [alamat, setAlamat] = useState(initial?.alamat ?? '');
  const [kepalaCabang, setKepalaCabang] = useState(initial?.kepalaCabang ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [targetCollection, setTargetCollection] = useState(String(initial?.targetCollection ?? '0'));
  const [targetVisits, setTargetVisits] = useState(String(initial?.targetVisits ?? '0'));
  const [targetApprovalRate, setTargetApprovalRate] = useState(String(initial?.targetApprovalRate ?? '85'));
  const [budgetOperational, setBudgetOperational] = useState(String(initial?.budgetOperational ?? '0'));
  const [budgetCommission, setBudgetCommission] = useState(String(initial?.budgetCommission ?? '0'));
  const [defaultCommissionPct, setDefaultCommissionPct] = useState(
    initial?.defaultCommissionBps == null ? '' : String(initial.defaultCommissionBps / 100));
  const [csatEnabled, setCsatEnabled] = useState(initial?.csatEnabled ?? false);
  const [err, setErr] = useState<string | null>(null);

  const targetPayload = () => {
    const pct = defaultCommissionPct.trim();
    const defaultCommissionBps = pct === '' ? null : Math.max(0, Math.min(10_000, Math.round(Number(pct) * 100)));
    return {
      targetCollection: targetCollection.replace(/[^\d]/g, '') || '0',
      targetVisits: Number(targetVisits.replace(/[^\d]/g, '')) || 0,
      targetApprovalRate: Math.max(0, Math.min(100, Number(targetApprovalRate) || 0)),
      budgetOperational: budgetOperational.replace(/[^\d]/g, '') || '0',
      budgetCommission: budgetCommission.replace(/[^\d]/g, '') || '0',
      defaultCommissionBps,
      csatEnabled,
    };
  };

  const isEdit = !!initial;

  const create = useMutation({
    mutationFn: () => createBranch({ kode, nama, alamat: alamat || null, kepalaCabang: kepalaCabang || null, ...targetPayload() }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      if (c === 'duplicate_kode') setErr('Kode cabang sudah dipakai.');
      else if (c === 'bad_request') setErr('Format tidak valid. Kode harus huruf besar + angka, ≥ 3 karakter.');
      else setErr('Gagal menyimpan. Coba lagi.');
    },
  });
  const update = useMutation({
    mutationFn: () => updateBranch(initial!.id, { nama, alamat: alamat || null, kepalaCabang: kepalaCabang || null, active, ...targetPayload() }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      if (c === 'duplicate_kode') setErr('Kode cabang sudah dipakai.');
      else setErr('Gagal menyimpan. Coba lagi.');
    },
  });
  const deact = useMutation({
    mutationFn: () => deactivateBranch(initial!.id),
    onSuccess: () => { onSaved(); onClose(); },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (isEdit) update.mutate();
    else create.mutate();
  };

  const busy = create.isPending || update.isPending || deact.isPending;

  return (
    <Modal onClose={onClose} max={520}>
      <form onSubmit={submit}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="section-title">{isEdit ? 'Edit Cabang' : 'Tambah Cabang'}</div>
            {isEdit && <div className="muted mono" style={{ fontSize: 12, marginTop: 3 }}>{initial.id}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Kode Cabang">
            <input className="input" value={kode} onChange={e => setKode(e.target.value.toUpperCase())}
              disabled={isEdit} required maxLength={20} pattern="[A-Z0-9]+" placeholder="BSN004" />
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Huruf besar + angka. Tidak bisa diubah setelah dibuat.</div>
          </Field>
          <Field label="Nama Cabang">
            <input className="input" value={nama} onChange={e => setNama(e.target.value)} required maxLength={200} />
          </Field>
          <Field label="Alamat">
            <input className="input" value={alamat ?? ''} onChange={e => setAlamat(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Kepala Cabang">
            <input className="input" value={kepalaCabang ?? ''} onChange={e => setKepalaCabang(e.target.value)} maxLength={200} />
          </Field>
          <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none', padding: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 8, color: 'var(--ink-2)' }}>
              KPI Bulanan — dipakai di Scorecard
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <Field label="Target Tertagih (Rp)">
                <input className="input" type="text" inputMode="numeric"
                  value={targetCollection} onChange={e => setTargetCollection(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Target Kunjungan">
                <input className="input" type="text" inputMode="numeric"
                  value={targetVisits} onChange={e => setTargetVisits(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Approval Rate %">
                <input className="input" type="number" min={0} max={100}
                  value={targetApprovalRate} onChange={e => setTargetApprovalRate(e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 10 }}>
              <Field label="Budget Operasional (Rp)">
                <input className="input" type="text" inputMode="numeric"
                  value={budgetOperational} onChange={e => setBudgetOperational(e.target.value)} placeholder="0" />
              </Field>
              <Field label="Budget Komisi (Rp)">
                <input className="input" type="text" inputMode="numeric"
                  value={budgetCommission} onChange={e => setBudgetCommission(e.target.value)} placeholder="0" />
              </Field>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 10 }}>
              <Field label="Komisi Default Petugas (%)">
                <input className="input" type="number" min={0} max={100} step={0.01}
                  value={defaultCommissionPct} onChange={e => setDefaultCommissionPct(e.target.value)}
                  placeholder="Kosongkan = 1.5%" />
              </Field>
              <label className="center gap-2" style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'end' }}>
                <input type="checkbox" checked={csatEnabled} onChange={e => setCsatEnabled(e.target.checked)} />
                Kirim survei kepuasan setelah BAYAR
              </label>
            </div>
          </div>
          {isEdit && (
            <label className="center gap-2" style={{ fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              Cabang aktif (uncheck = nonaktifkan)
            </label>
          )}
          {err && (
            <div className="center gap-2" style={{
              background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
              borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
            }}>
              <Ic.alert size={15} />{err}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {isEdit && initial.active && (
            <button type="button" className="btn"
              style={{ marginRight: 'auto', color: 'var(--col-macet)' }}
              onClick={() => { if (confirm(`Nonaktifkan cabang ${initial.nama}?`)) deact.mutate(); }}
              disabled={busy}>
              Nonaktifkan
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !kode || !nama}>
            {busy ? 'Menyimpan…' : 'Simpan'}
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
