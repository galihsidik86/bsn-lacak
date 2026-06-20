import { useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { Avatar, Badge, Kv, Modal } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { useAuth } from '../lib/auth';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

interface Profile {
  petugas: {
    id: string; kode: string; nama: string; inisial: string; hue: number;
    wilayah: string; hp: string; status: string; target: string | number;
    active: boolean;
    branch: { kode: string; nama: string };
    wilayahZone: { id: string; nama: string } | null;
  };
  rollup30d: {
    nasabahActive: number;
    visits: { BAYAR: number; JANJI: number; TIDAKADA: number; TOLAK: number };
    totalVisits: number;
    collected: number;
  };
  attendanceLast: { clockInAt: string; clockOutAt: string | null } | null;
  recentKunjungan: Array<{
    id: string; tanggal: string; jam: string; hasil: string;
    nominal: string | number; reviewStatus: string; riskFlags: string[];
    nasabah: { kode: string; nama: string };
  }>;
}

async function fetchProfile(id: string): Promise<Profile> {
  return (await axios.get(`${BASE}/petugas/${id}/profile`,
    { withCredentials: true, headers: headers() })).data;
}

function fmtRp(n: number): string {
  if (n >= 1_000_000_000) return 'Rp ' + (n / 1_000_000_000).toFixed(1) + ' M';
  if (n >= 1_000_000) return 'Rp ' + (n / 1_000_000).toFixed(1) + ' jt';
  if (n >= 1_000) return 'Rp ' + (n / 1_000).toFixed(0) + ' rb';
  return 'Rp ' + n.toLocaleString('id-ID');
}

const HASIL_TINT: Record<string, { bg: string; fg: string; label: string }> = {
  BAYAR: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', label: 'Bayar' },
  JANJI: { bg: 'var(--gold-soft)', fg: 'var(--gold-ink)', label: 'Janji' },
  TIDAKADA: { bg: 'var(--surface-2)', fg: 'var(--ink-3)', label: 'Tidak ada' },
  TOLAK: { bg: 'var(--col-macet-soft)', fg: 'var(--col-macet)', label: 'Tolak' },
};

export function ScreenPetugasProfile({ petugasId, onClose }: { petugasId: string; onClose?: () => void }) {
  const q = useQuery({ queryKey: ['petugas-profile', petugasId], queryFn: () => fetchProfile(petugasId) });

  if (q.isPending) return <div className="content"><Skeleton h={500} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const d = q.data!;

  return (
    <div className="content" style={{ display: 'grid', gap: 18 }}>
      <div className="card card-pad fade-up">
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div className="center gap-3">
            <Avatar inisial={d.petugas.inisial} hue={d.petugas.hue} size={64} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{d.petugas.nama}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>
                {d.petugas.kode} · {d.petugas.branch.kode} {d.petugas.active ? '' : '· (nonaktif)'}
              </div>
              <div style={{ marginTop: 6 }} className="center gap-2">
                <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.map}>{d.petugas.wilayah}</Badge>
                {d.petugas.wilayahZone && (
                  <Badge c="var(--sms)" soft="oklch(0.93 0.04 245)" icon={Ic.layers}>
                    Zone: {d.petugas.wilayahZone.nama}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {onClose && (
            <button className="btn btn-sm btn-ghost" onClick={onClose}><Ic.x size={14} />Tutup</button>
          )}
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
          <Kv label="No. HP" value={d.petugas.hp} />
          <Kv label="Status" value={d.petugas.status} />
          <Kv label="Target bulanan" value={fmtRp(Number(d.petugas.target))} />
          <Kv label="Cabang" value={d.petugas.branch.nama} />
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Tile icon="users" label="Nasabah aktif" value={d.rollup30d.nasabahActive} />
        <Tile icon="clipboard" label="Kunjungan 30d" value={d.rollup30d.totalVisits} />
        <Tile icon="wallet" label="Tertagih 30d" value={fmtRp(d.rollup30d.collected)} />
        <Tile icon="clock" label="Clock-in terakhir"
          value={d.attendanceLast ? new Date(d.attendanceLast.clockInAt).toLocaleString('id-ID',
            { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} />
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Komposisi Hasil 30 Hari</div>
        </div>
        <div className="grid gap-3" style={{ padding: 16, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(Object.keys(HASIL_TINT) as Array<keyof typeof HASIL_TINT>).map(h => {
            const meta = HASIL_TINT[h];
            const v = d.rollup30d.visits[h as 'BAYAR' | 'JANJI' | 'TIDAKADA' | 'TOLAK'];
            const pct = d.rollup30d.totalVisits === 0 ? 0 : Math.round(v / d.rollup30d.totalVisits * 100);
            return (
              <div key={h} style={{ background: meta.bg, color: meta.fg, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {meta.label}
                </div>
                <div className="num" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{v}</div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>{pct}% dari total</div>
              </div>
            );
          })}
        </div>
      </div>

      <KpiScorecardCard petugasId={d.petugas.id} />
      <CertPanel petugasId={d.petugas.id} />
      <LeavePanel petugasId={d.petugas.id} />
      <TransferHistory petugasId={d.petugas.id} />

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">10 Kunjungan Terakhir</div>
        </div>
        {d.recentKunjungan.length === 0 ? (
          <EmptyState title="Belum ada kunjungan" />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Tanggal</th><th>Nasabah</th><th>Hasil</th><th>Review</th>
                  <th style={{ textAlign: 'right' }}>Nominal</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {d.recentKunjungan.map(k => (
                <tr key={k.id}>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {new Date(k.tanggal).toLocaleDateString('id-ID',
                      { day: '2-digit', month: 'short', year: 'numeric' })} · {k.jam}
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{k.nasabah.nama}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{k.nasabah.kode}</div>
                  </td>
                  <td>
                    <span className="chip" style={{
                      background: HASIL_TINT[k.hasil]?.bg, color: HASIL_TINT[k.hasil]?.fg,
                    }}>{HASIL_TINT[k.hasil]?.label ?? k.hasil}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{k.reviewStatus}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>
                    {Number(k.nominal) > 0 ? fmtRp(Number(k.nominal)) : '—'}
                  </td>
                  <td>
                    {k.riskFlags.length === 0
                      ? <span className="muted" style={{ fontSize: 11 }}>—</span>
                      : <span className="chip" style={{
                          background: 'var(--col-macet-soft)', color: 'var(--col-macet)', fontSize: 10.5,
                        }}>{k.riskFlags.length}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: 'users' | 'clipboard' | 'wallet' | 'clock'; label: string; value: string | number }) {
  const Icon = Ic[icon];
  return (
    <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Icon size={18} />
      </div>
      <div>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {label}
        </div>
        <div className="num" style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

// AV — certification panel: list of certs sorted by validUntil, color-coded
// by days-to-expiry, plus inline create/edit modal for SUPERVISOR+.
interface CertRow {
  id: string; nama: string; penerbit: string | null; noSertifikat: string | null;
  issuedAt: string; validUntil: string | null; status: string; catatan: string | null;
  createdAt: string;
  createdBy: { username: string; nama: string } | null;
}
function certHeaders() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

function CertPanel({ petugasId }: { petugasId: string }) {
  const role = useAuth(s => s.user?.role);
  const canEdit = role === 'SUPERVISOR' || role === 'ADMIN';
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['certs', petugasId],
    queryFn: () => axios.get<CertRow[]>(`${import.meta.env.VITE_API_URL || '/api'}/certifications?petugasId=${petugasId}`,
      { withCredentials: true, headers: certHeaders() }).then(r => r.data),
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CertRow | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => axios.delete(`${import.meta.env.VITE_API_URL || '/api'}/certifications/${id}`,
      { withCredentials: true, headers: certHeaders() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['certs', petugasId] }),
  });

  return (
    <div className="card fade-up" style={{ overflow: 'hidden' }}>
      <div className="between card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="section-title">Sertifikasi / Kompetensi</div>
          <div className="page-sub">Daftar sertifikat aktif & yang segera lapse.</div>
        </div>
        {canEdit && (
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            <Ic.plus size={14} />Tambah
          </button>
        )}
      </div>
      {q.isPending ? <Skeleton h={120} />
        : (q.data ?? []).length === 0 ? <EmptyState title="Belum ada sertifikat" />
        : (
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th><th>Penerbit</th><th>No</th>
                <th style={{ textAlign: 'right' }}>Diterbitkan</th>
                <th style={{ textAlign: 'right' }}>Berlaku s/d</th>
                <th>Status</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {q.data!.map(c => (
                <CertRow key={c.id} c={c}
                  canEdit={canEdit}
                  onEdit={() => setEditing(c)}
                  onDelete={() => { if (confirm(`Hapus sertifikat "${c.nama}"?`)) del.mutate(c.id); }} />
              ))}
            </tbody>
          </table>
        )}
      {(adding || editing) && (
        <CertForm petugasId={petugasId} initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => {
            setAdding(false); setEditing(null);
            qc.invalidateQueries({ queryKey: ['certs', petugasId] });
          }} />
      )}
    </div>
  );
}

function CertRow({ c, canEdit, onEdit, onDelete }: {
  c: CertRow; canEdit: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const validUntil = c.validUntil ? new Date(c.validUntil) : null;
  const daysLeft = validUntil ? Math.round((validUntil.getTime() - Date.now()) / 86400000) : null;
  const tint = c.status !== 'aktif' ? { bg: 'var(--surface-2)', fg: 'var(--ink-3)' }
    : daysLeft == null ? { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }
    : daysLeft < 0 ? { bg: 'var(--col-macet-soft)', fg: 'var(--col-macet)' }
    : daysLeft <= 30 ? { bg: 'var(--gold-soft)', fg: 'var(--gold-ink)' }
    : daysLeft <= 90 ? { bg: 'var(--col-dpk-soft)', fg: 'var(--col-dpk)' }
    : { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' };
  const statusLabel = c.status !== 'aktif' ? c.status
    : daysLeft == null ? 'Aktif'
    : daysLeft < 0 ? `Expired ${-daysLeft}d`
    : `${daysLeft}d tersisa`;
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{c.nama}</div>
        {c.catatan && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{c.catatan}</div>
        )}
      </td>
      <td className="muted">{c.penerbit ?? '—'}</td>
      <td className="mono" style={{ fontSize: 11.5 }}>{c.noSertifikat ?? '—'}</td>
      <td className="mono" style={{ textAlign: 'right', fontSize: 11.5 }}>
        {new Date(c.issuedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
      </td>
      <td className="mono" style={{ textAlign: 'right', fontSize: 11.5 }}>
        {validUntil ? validUntil.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
      </td>
      <td>
        <span className="chip" style={{ background: tint.bg, color: tint.fg, fontSize: 11 }}>
          {statusLabel}
        </span>
      </td>
      {canEdit && (
        <td style={{ textAlign: 'right' }}>
          <div className="center gap-2" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-ghost" onClick={onEdit}><Ic.settings size={12} /></button>
            <button className="btn btn-sm btn-ghost" onClick={onDelete}><Ic.x size={12} /></button>
          </div>
        </td>
      )}
    </tr>
  );
}

function CertForm({ petugasId, initial, onClose, onSaved }: {
  petugasId: string;
  initial?: CertRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [nama, setNama] = useState(initial?.nama ?? '');
  const [penerbit, setPenerbit] = useState(initial?.penerbit ?? '');
  const [noSertifikat, setNoSertifikat] = useState(initial?.noSertifikat ?? '');
  const [issuedAt, setIssuedAt] = useState(
    initial ? initial.issuedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [validUntil, setValidUntil] = useState(initial?.validUntil ? initial.validUntil.slice(0, 10) : '');
  const [status, setStatus] = useState(initial?.status ?? 'aktif');
  const [catatan, setCatatan] = useState(initial?.catatan ?? '');
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nama, penerbit: penerbit || null, noSertifikat: noSertifikat || null,
        issuedAt, validUntil: validUntil || null, status,
        catatan: catatan || null,
        ...(isEdit ? {} : { petugasId }),
      };
      const url = `${import.meta.env.VITE_API_URL || '/api'}/certifications${isEdit ? '/' + initial!.id : ''}`;
      return isEdit
        ? axios.patch(url, body, { withCredentials: true, headers: certHeaders() })
        : axios.post(url, body, { withCredentials: true, headers: certHeaders() });
    },
    onSuccess: () => onSaved(),
    onError: () => setErr('Gagal menyimpan.'),
  });

  return (
    <Modal onClose={onClose} max={520}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">{isEdit ? 'Edit Sertifikat' : 'Tambah Sertifikat'}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
        <Field label="Nama sertifikat">
          <input className="input" value={nama} onChange={e => setNama(e.target.value)} required maxLength={200} />
        </Field>
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Penerbit"><input className="input" value={penerbit ?? ''} onChange={e => setPenerbit(e.target.value)} /></Field>
          <Field label="No. sertifikat"><input className="input" value={noSertifikat ?? ''} onChange={e => setNoSertifikat(e.target.value)} /></Field>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Diterbitkan"><input className="input" type="date" value={issuedAt} onChange={e => setIssuedAt(e.target.value)} required /></Field>
          <Field label="Berlaku s/d (opsional)"><input className="input" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></Field>
        </div>
        <Field label="Status">
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="aktif">Aktif</option>
            <option value="dicabut">Dicabut</option>
            <option value="expired">Expired</option>
          </select>
        </Field>
        <Field label="Catatan">
          <textarea className="input" rows={2} value={catatan ?? ''} onChange={e => setCatatan(e.target.value)} style={{ resize: 'none' }} />
        </Field>
        {err && (
          <div className="center gap-2" style={{
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600,
          }}><Ic.alert size={14} />{err}</div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={save.isPending || !nama.trim()}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Menyimpan…' : isEdit ? 'Simpan' : 'Tambah'}
        </button>
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

// CS — leave/cuti panel mirroring the cert panel structure.
interface LeaveRow {
  id: string; startDate: string; endDate: string; type: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null; decisionAt: string | null;
  approvedBy: { username: string; nama: string } | null;
  substitutePetugasId?: string | null;
}
function LeavePanel({ petugasId }: { petugasId: string }) {
  const role = useAuth(s => s.user?.role);
  const canEdit = role === 'SUPERVISOR' || role === 'ADMIN';
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['leaves', petugasId],
    queryFn: () => axios.get<LeaveRow[]>(`${import.meta.env.VITE_API_URL || '/api'}/leaves?petugasId=${petugasId}`,
      { withCredentials: true, headers: certHeaders() }).then(r => r.data),
  });
  const [adding, setAdding] = useState(false);

  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' }) =>
      axios.patch(`${import.meta.env.VITE_API_URL || '/api'}/leaves/${id}`,
        { status },
        { withCredentials: true, headers: certHeaders() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leaves', petugasId] }),
  });

  const bulkReassign = useMutation({
    mutationFn: (id: string) =>
      axios.post(`${import.meta.env.VITE_API_URL || '/api'}/leaves/${id}/bulk-reassign`, {},
        { withCredentials: true, headers: certHeaders() }),
    onSuccess: (r: any) => {
      alert(`Berhasil. ${r?.data?.moved ?? 0} nasabah dipindah ke substitute.`);
      qc.invalidateQueries({ queryKey: ['leaves', petugasId] });
      qc.invalidateQueries({ queryKey: ['nasabah'] });
    },
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      if (c === 'not_approved') alert('Hanya cuti yang sudah APPROVED yang bisa di-bulk reassign.');
      else if (c === 'no_substitute') alert('Cuti ini belum punya substitute petugas.');
      else if (c === 'substitute_invalid') alert('Substitute petugas tidak valid (mungkin sudah resign).');
      else alert('Gagal memindah nasabah.');
    },
  });

  return (
    <div className="card fade-up" style={{ overflow: 'hidden' }}>
      <div className="between card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="section-title">Cuti / Izin</div>
          <div className="page-sub">Reminder + inactivity detector skip petugas pada hari cuti.</div>
        </div>
        {canEdit && (
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            <Ic.plus size={14} />Tambah
          </button>
        )}
      </div>
      {q.isPending ? <Skeleton h={120} />
        : (q.data ?? []).length === 0 ? <EmptyState title="Belum ada catatan cuti" />
        : (
          <table className="table">
            <thead>
              <tr><th>Periode</th><th>Tipe</th><th>Status</th><th>Approver</th>
                {canEdit && <th></th>}</tr>
            </thead>
            <tbody>
              {q.data!.map(l => (
                <tr key={l.id}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {new Date(l.startDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                    {' → '}
                    {new Date(l.endDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td><span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', fontSize: 11 }}>{l.type.replace('_', ' ')}</span></td>
                  <td>
                    <span className="chip" style={{
                      background: l.status === 'approved' ? 'var(--accent-soft)'
                        : l.status === 'pending' ? 'var(--gold-soft)'
                        : l.status === 'cancelled' ? 'var(--surface-2)' : 'var(--col-macet-soft)',
                      color: l.status === 'approved' ? 'var(--accent-ink)'
                        : l.status === 'pending' ? 'var(--gold-ink)'
                        : l.status === 'cancelled' ? 'var(--ink-3)' : 'var(--col-macet)',
                      fontSize: 11,
                    }}>{l.status}</span>
                  </td>
                  <td className="muted mono" style={{ fontSize: 11 }}>
                    {l.approvedBy ? `${l.approvedBy.nama}` : '—'}
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'right' }}>
                      {l.status === 'pending' && (
                        <div className="center gap-2" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => decide.mutate({ id: l.id, status: 'approved' })}
                            style={{ color: 'var(--accent)' }}>
                            <Ic.check size={12} />Setujui
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => decide.mutate({ id: l.id, status: 'rejected' })}
                            style={{ color: 'var(--col-macet)' }}>
                            <Ic.x size={12} />Tolak
                          </button>
                        </div>
                      )}
                      {l.status === 'approved' && l.substitutePetugasId && (
                        <button className="btn btn-sm btn-ghost"
                          disabled={bulkReassign.isPending}
                          onClick={() => {
                            if (!window.confirm('Pindahkan SEMUA nasabah petugas ini ke substitute? Tidak otomatis dikembalikan saat cuti selesai.')) return;
                            bulkReassign.mutate(l.id);
                          }}>
                          <Ic.users size={12} />Reassign semua nasabah
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {adding && (
        <LeaveForm petugasId={petugasId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            qc.invalidateQueries({ queryKey: ['leaves', petugasId] });
          }} />
      )}
    </div>
  );
}

function LeaveForm({ petugasId, onClose, onSaved }: {
  petugasId: string; onClose: () => void; onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [type, setType] = useState<'cuti_tahunan' | 'sakit' | 'dinas_luar' | 'lain'>('cuti_tahunan');
  const [reason, setReason] = useState('');
  const [substituteId, setSubstituteId] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Petugas list for substitute picker. Filter out the current petugas
  // since they can't be their own substitute.
  const petugasQ = useQuery({
    queryKey: ['petugas-substitute-list'],
    queryFn: async () => {
      const r = await axios.get(`${import.meta.env.VITE_API_URL || '/api'}/petugas`,
        { withCredentials: true, headers: certHeaders() });
      return (r.data as Array<{ id: string; kode: string; nama: string; branchId: string; active?: boolean }>)
        .filter(p => p.id !== petugasId && p.active !== false);
    },
  });
  const save = useMutation({
    mutationFn: () => axios.post(`${import.meta.env.VITE_API_URL || '/api'}/leaves`,
      {
        petugasId, startDate: start, endDate: end, type,
        reason: reason || null,
        status: autoApprove ? 'approved' : 'pending',
        substitutePetugasId: substituteId || null,
      },
      { withCredentials: true, headers: certHeaders() }),
    onSuccess: () => onSaved(),
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      setErr(c === 'date_range_invalid' ? 'Tanggal akhir harus ≥ tanggal mulai.' : 'Gagal menyimpan.');
    },
  });
  return (
    <Modal onClose={onClose} max={520}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">Tambah Cuti</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Mulai"><input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} /></Field>
          <Field label="Sampai"><input className="input" type="date" value={end} onChange={e => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Tipe">
          <select className="input" value={type} onChange={e => setType(e.target.value as any)}>
            <option value="cuti_tahunan">Cuti tahunan</option>
            <option value="sakit">Sakit</option>
            <option value="dinas_luar">Dinas luar</option>
            <option value="lain">Lain-lain</option>
          </select>
        </Field>
        <Field label="Alasan / catatan">
          <textarea className="input" rows={2} value={reason} onChange={e => setReason(e.target.value)} style={{ resize: 'none' }} />
        </Field>
        <Field label="Substitute petugas (opsional)">
          <select className="input" value={substituteId} onChange={e => setSubstituteId(e.target.value)}>
            <option value="">— Tidak ada —</option>
            {(petugasQ.data ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.kode} · {p.nama}</option>
            ))}
          </select>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Saat cuti dimulai, nasabah akan dipindah ke substitute, lalu dikembalikan otomatis.
          </div>
        </Field>
        <label className="center gap-2" style={{ fontSize: 12.5, fontWeight: 600 }}>
          <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
          Setujui sekarang
        </label>
        {err && (
          <div className="center gap-2" style={{
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 600,
          }}><Ic.alert size={14} />{err}</div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Menyimpan…' : 'Tambah'}
        </button>
      </div>
    </Modal>
  );
}

interface Scorecard {
  petugasId: string; petugasKode: string; petugasNama: string;
  metrics: {
    collectionRate: number; visitConsistency: number;
    approvalRate: number; nasabahHealth: number; followupSpeed: number;
  };
  raw: {
    collected: number; target: number;
    visitDays: number; approved: number; rejected: number;
    avgDpd: number; janjiTotal: number; janjiFollowed: number;
  };
}

const SCORECARD_AXES: Array<{ key: keyof Scorecard['metrics']; label: string }> = [
  { key: 'collectionRate', label: 'Tertagih' },
  { key: 'visitConsistency', label: 'Konsistensi' },
  { key: 'approvalRate', label: 'Approval' },
  { key: 'nasabahHealth', label: 'Sehat' },
  { key: 'followupSpeed', label: 'Follow-up' },
];

function KpiScorecardCard({ petugasId }: { petugasId: string }) {
  const { user } = useAuth();
  const enabled = user?.role !== 'PETUGAS';
  const q = useQuery<Scorecard>({
    queryKey: ['petugas-scorecard', petugasId],
    enabled,
    queryFn: async () => (await axios.get(`${BASE}/analytics/petugas-scorecard/${petugasId}`,
      { withCredentials: true, headers: headers() })).data,
  });
  if (!enabled) return null;
  return (
    <div className="card fade-up" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <div className="section-title">KPI Scorecard (30 Hari)</div>
      </div>
      <div className="card-pad">
        {q.isLoading ? <Skeleton h={200} /> :
         q.isError ? <ErrorState onRetry={() => q.refetch()} /> :
         q.data ? <RadarPanel data={q.data} /> : null}
      </div>
    </div>
  );
}

function RadarPanel({ data }: { data: Scorecard }) {
  const size = 220;
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 24;
  const axes = SCORECARD_AXES;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, frac: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac] as const;
  };
  const polygon = axes.map((ax, i) => {
    const v = data.metrics[ax.key] / 100;
    const [x, y] = pt(i, v);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(frac => {
    const pts = axes.map((_, i) => {
      const [x, y] = pt(i, frac);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return <polygon key={frac} points={pts} fill="none" stroke="var(--line)" strokeWidth={1} />;
  });
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: '220px 1fr', alignItems: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {grid}
        {axes.map((_, i) => {
          const [x, y] = pt(i, 1);
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth={1} />;
        })}
        <polygon points={polygon} fill="var(--col-brand-soft)" stroke="var(--col-brand)" strokeWidth={2} />
        {axes.map((ax, i) => {
          const [x, y] = pt(i, 1.15);
          return (
            <text key={ax.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
              style={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-muted)' }}>
              {ax.label}
            </text>
          );
        })}
      </svg>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', fontSize: 12 }}>
        <Kv label="Tertagih" value={`${data.metrics.collectionRate}%`} />
        <Kv label="Hari kunjungan" value={`${data.raw.visitDays} / 22`} />
        <Kv label="Approval" value={`${data.metrics.approvalRate}% (${data.raw.approved}/${data.raw.approved + data.raw.rejected})`} />
        <Kv label="Avg DPD" value={`${data.raw.avgDpd} hari`} />
        <Kv label="Follow-up JANJI" value={`${data.raw.janjiFollowed}/${data.raw.janjiTotal}`} />
        <Kv label="Konsistensi" value={`${data.metrics.visitConsistency}%`} />
      </div>
    </div>
  );
}

interface Transfer {
  id: string; createdAt: string; reason: string | null;
  fromBranch: { kode: string; nama: string } | null;
  toBranch: { kode: string; nama: string };
  movedBy: { username: string; nama: string | null } | null;
}

function TransferHistory({ petugasId }: { petugasId: string }) {
  const q = useQuery<Transfer[]>({
    queryKey: ['petugas-transfers', petugasId],
    queryFn: async () => (await axios.get(`${BASE}/petugas/${petugasId}/transfers`,
      { withCredentials: true, headers: headers() })).data,
  });
  if (q.isLoading) return null;
  if (q.isError || !q.data || q.data.length === 0) return null;
  return (
    <div className="card fade-up" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <div className="section-title">Riwayat Pindah Cabang</div>
      </div>
      <table className="table">
        <thead><tr><th>Tanggal</th><th>Dari</th><th>Ke</th><th>Oleh</th><th>Alasan</th></tr></thead>
        <tbody>
          {q.data.map(t => (
            <tr key={t.id}>
              <td>{new Date(t.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td>{t.fromBranch ? `${t.fromBranch.kode} · ${t.fromBranch.nama}` : '—'}</td>
              <td>{t.toBranch.kode} · {t.toBranch.nama}</td>
              <td>{t.movedBy?.nama ?? t.movedBy?.username ?? '—'}</td>
              <td className="muted">{t.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
