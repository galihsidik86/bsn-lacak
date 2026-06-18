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

      <CertPanel petugasId={d.petugas.id} />

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
