import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { Avatar, KolBadge, Modal } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface FotoRef { path: string }
interface KunjunganHit {
  id: string;
  tanggal: string;
  jam: string;
  hasil: string;
  nominal: string | number;
  catatan: string;
  lokasi: string;
  valid: boolean;
  riskScore: number;
  riskFlags: string[];
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  reviewedAt: string | null;
  fotos: FotoRef[];
  petugas: { kode: string; nama: string; inisial: string; hue: number };
  reviewer?: { username: string; nama: string } | null;
}
interface PembayaranRow {
  id: string;
  tanggal: string;
  jam: string;
  nominal: string | number;
  metode: string;
  status: string;
}
interface FeedbackRow {
  id: string;
  rating: number | null;
  comment: string | null;
  repliedAt: string | null;
}
interface NasabahDetail {
  id: string; kode: string; nama: string; alamat: string; hp: string;
  lat: number | null; lng: number | null;
  kol: 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
  akad: string;
  plafon: string | number; tenor: number; angsuran: string | number; sisa: string | number;
  dpd: number; dueIn: number; lastBayar: string | null;
  active: boolean;
  petugas: { kode: string; nama: string; hp: string; inisial: string; hue: number; wilayah: string; branch: { kode: string; nama: string } };
  branch: { kode: string; nama: string; alamat: string | null };
}
interface Stats {
  totalKunjungan: number;
  lastVisit: string | null;
  totalCollected: number;
  paymentCount: number;
  feedbackCount: number;
  avgRating: number | null;
}
interface Detail360 {
  nasabah: NasabahDetail;
  kunjungan: KunjunganHit[];
  pembayaran: PembayaranRow[];
  feedback: FeedbackRow[];
  stats: Stats;
}

const KOL_LABEL: Record<NasabahDetail['kol'], string> = {
  K1: 'Lancar', K2: 'DPK', K3: 'Kurang Lancar', K4: 'Diragukan', K5: 'Macet',
};
const KOL_KEY_MAP: Record<NasabahDetail['kol'], 1 | 2 | 3 | 4 | 5> = { K1: 1, K2: 2, K3: 3, K4: 4, K5: 5 };

const HASIL_LABEL: Record<string, string> = {
  BAYAR: 'Bayar', JANJI: 'Janji', TIDAKADA: 'Tidak ada', TOLAK: 'Tolak',
};

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

async function fetch360(id: string): Promise<Detail360> {
  return (await axios.get(`${BASE}/nasabah/${id}/360`, { withCredentials: true, headers: headers() })).data;
}

function rp(v: string | number): string {
  return 'Rp ' + Number(v).toLocaleString('id-ID');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ScreenNasabah360({ nasabahId, onClose }: { nasabahId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['nasabah-360', nasabahId], queryFn: () => fetch360(nasabahId) });

  if (q.isPending) return <Modal onClose={onClose} max={1100}><div style={{ padding: 24 }}><Skeleton h={400} /></div></Modal>;
  if (q.error) return <Modal onClose={onClose} max={1100}><ErrorState onRetry={() => q.refetch()} /></Modal>;
  if (!q.data) return <Modal onClose={onClose} max={1100}><EmptyState title="Data tidak ditemukan" /></Modal>;

  const { nasabah: n, kunjungan, pembayaran, feedback, stats } = q.data;

  return (
    <Modal onClose={onClose} max={1100}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="center gap-2">
            <span className="section-title">{n.nama}</span>
            <span className="mono muted" style={{ fontSize: 12 }}>{n.kode}</span>
            <KolBadge kol={KOL_KEY_MAP[n.kol]} />
            {!n.active && (
              <span className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
                <Ic.x size={12} />Inactive
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {n.alamat} · {n.hp}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>

      <div className="modal-body">
        {/* Summary stat strip */}
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 18 }}>
          <Stat icon="clipboard" label="Kunjungan" value={String(stats.totalKunjungan)}
            hint={stats.lastVisit ? `Terakhir ${fmtDate(stats.lastVisit)}` : 'Belum ada'} />
          <Stat icon="wallet" label="Tertagih" value={rp(stats.totalCollected)}
            hint={`${stats.paymentCount} transaksi`} />
          <Stat icon="alert" label="Sisa" value={rp(n.sisa)}
            hint={n.dpd > 0 ? `${n.dpd} hari telat` : `Jatuh tempo dalam ${n.dueIn} hari`} />
          <Stat icon="user" label="Rating" value={stats.avgRating !== null ? stats.avgRating.toFixed(1) + ' ★' : '—'}
            hint={`${stats.feedbackCount} balasan`} />
        </div>

        {/* Profile + Petugas */}
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 18 }}>
          <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
            <div className="section-title" style={{ marginBottom: 10, fontSize: 13 }}>Profil Kredit</div>
            <Kv label="Akad" value={n.akad} />
            <Kv label="Kolektabilitas" value={`${n.kol} · ${KOL_LABEL[n.kol]}`} />
            <Kv label="Plafon" value={rp(n.plafon)} />
            <Kv label="Tenor" value={`${n.tenor} bulan`} />
            <Kv label="Angsuran/bln" value={rp(n.angsuran)} />
            <Kv label="Sisa pokok" value={rp(n.sisa)} />
            <Kv label="Last bayar" value={n.lastBayar ?? '—'} />
          </div>
          <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
            <div className="section-title" style={{ marginBottom: 10, fontSize: 13 }}>Petugas Binaan</div>
            <div className="center gap-3" style={{ marginBottom: 10 }}>
              <Avatar inisial={n.petugas.inisial} hue={n.petugas.hue} size={42} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{n.petugas.nama}</div>
                <div className="muted mono" style={{ fontSize: 11.5 }}>{n.petugas.kode} · {n.petugas.hp}</div>
              </div>
            </div>
            <Kv label="Wilayah" value={n.petugas.wilayah} />
            <Kv label="Cabang" value={n.branch.nama} />
            <Kv label="Alamat cabang" value={n.branch.alamat ?? '—'} />
            {n.lat != null && n.lng != null && (
              <Kv label="Koordinat" value={`${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`} />
            )}
          </div>
        </div>

        <UnifiedTimeline nasabahId={n.id} />

        {/* Kunjungan timeline */}
        <Section title={`Riwayat Kunjungan (${kunjungan.length})`}>
          {kunjungan.length === 0 ? <EmptyState title="Belum ada kunjungan" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {kunjungan.map(k => (
                <div key={k.id} style={{
                  display: 'flex', gap: 12, padding: 10, borderRadius: 12,
                  background: 'var(--surface-2)', border: '1px solid var(--line)',
                }}>
                  {k.fotos[0] ? (
                    <img src={`/uploads/${k.fotos[0].path.replace(/^\/?(?:uploads\/)?/, '')}`}
                      alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
                  ) : (
                    <div style={{ width: 64, height: 64, borderRadius: 8, background: 'var(--ink)', flex: 'none' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="between">
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {HASIL_LABEL[k.hasil] ?? k.hasil}
                        {' · '}<span className="num">{rp(k.nominal)}</span>
                      </div>
                      <ReviewBadge status={k.reviewStatus} />
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                      {fmtDate(k.tanggal)} · {k.jam} · oleh {k.petugas.nama}
                    </div>
                    {k.catatan && (
                      <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--ink-2)', lineHeight: 1.4 }}>{k.catatan}</div>
                    )}
                    {k.riskFlags.length > 0 && (
                      <div className="center gap-1" style={{ fontSize: 11, marginTop: 6 }}>
                        <Ic.alert size={11} style={{ color: 'var(--col-macet)' }} />
                        <span className="muted">{k.riskFlags.join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Pembayaran ledger */}
        <Section title={`Pembayaran (${pembayaran.length})`}>
          {pembayaran.length === 0 ? <EmptyState title="Belum ada pembayaran" /> : (
            <table className="table">
              <thead><tr>
                <th>Tanggal</th><th>Metode</th><th>Status</th>
                <th style={{ textAlign: 'right' }}>Nominal</th>
              </tr></thead>
              <tbody>
                {pembayaran.map(p => (
                  <tr key={p.id}>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(p.tanggal)} · {p.jam}</td>
                    <td>{p.metode}</td>
                    <td>
                      <span className="chip" style={{
                        background: p.status === 'berhasil' ? 'var(--accent-soft)' : 'var(--col-macet-soft)',
                        color: p.status === 'berhasil' ? 'var(--accent-ink)' : 'var(--col-macet)',
                      }}>{p.status}</span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="num" >{rp(p.nominal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* DI — internal notes */}
        <NotesSection nasabahId={nasabahId} />

        {/* Feedback */}
        <Section title={`Feedback Nasabah (${feedback.length})`}>
          {feedback.length === 0 ? <EmptyState title="Belum ada feedback" /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {feedback.map(f => (
                <div key={f.id} className="card card-pad" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                  <div className="between">
                    <span className="num" style={{ letterSpacing: 1, fontSize: 16 }}>
                      {[1, 2, 3, 4, 5].map(i => (
                        <span key={i} style={{ color: i <= (f.rating ?? 0) ? '#f5b81f' : 'var(--ink-4)' }}>★</span>
                      ))}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>{fmtDate(f.repliedAt)}</span>
                  </div>
                  {f.comment && (
                    <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: '6px 0 0', lineHeight: 1.4 }}>
                      "{f.comment}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </Modal>
  );
}

function Stat({ icon, label, value, hint }: { icon: 'clipboard' | 'wallet' | 'alert' | 'user'; label: string; value: string; hint: string }) {
  const Icon = Ic[icon];
  return (
    <div className="card card-pad" style={{ background: 'var(--surface)', boxShadow: 'none', border: '1px solid var(--line)' }}>
      <div className="center gap-2" style={{ marginBottom: 6 }}>
        <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', width: 30, height: 30 }}><Icon size={14} /></div>
        <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
      </div>
      <div className="num" style={{ fontWeight: 800, fontSize: 16 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-title" style={{ marginBottom: 10, fontSize: 13 }}>{title}</div>
      {children}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="between" style={{ padding: '5px 0', borderBottom: '1px dashed var(--line)' }}>
      <span className="muted" style={{ fontSize: 11.5 }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function ReviewBadge({ status }: { status: KunjunganHit['reviewStatus'] }) {
  const meta = status === 'APPROVED' ? { c: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Disetujui' }
    : status === 'REJECTED' ? { c: 'var(--col-macet)', bg: 'var(--col-macet-soft)', label: 'Ditolak' }
    : { c: 'var(--gold-ink)', bg: 'var(--gold-soft)', label: 'Pending' };
  return (
    <span className="chip" style={{ background: meta.bg, color: meta.c }}>{meta.label}</span>
  );
}

// CL — unified chronological timeline (kunjungan + pembayaran + feedback +
// reassign + escalation) collapsed to a single column with type badges.
interface TimelineEvent { ts: string; type: string; data: any }
function UnifiedTimeline({ nasabahId }: { nasabahId: string }) {
  const q = useQuery({
    queryKey: ['nasabah-timeline', nasabahId],
    queryFn: async (): Promise<TimelineEvent[]> => {
      const r = await axios.get(`${BASE}/nasabah/${nasabahId}/timeline`,
        { withCredentials: true, headers: headers() });
      return r.data.items as TimelineEvent[];
    },
  });
  if (q.isPending) return null;
  if (q.error) return null;
  const items = q.data ?? [];
  if (items.length === 0) return null;

  const tint: Record<string, { bg: string; fg: string; label: string }> = {
    kunjungan:   { bg: 'var(--accent-soft)',   fg: 'var(--accent-ink)',  label: 'Kunjungan' },
    pembayaran:  { bg: 'var(--gold-soft)',     fg: 'var(--gold-ink)',    label: 'Bayar' },
    feedback:    { bg: 'oklch(0.93 0.04 245)', fg: 'var(--sms)',         label: 'Feedback' },
    reassign:    { bg: 'var(--surface-2)',     fg: 'var(--ink-2)',       label: 'Reassign' },
    escalation:  { bg: 'var(--col-macet-soft)',fg: 'var(--col-macet)',   label: 'Escalation' },
  };

  return (
    <Section title={`Timeline (${items.length})`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
        {items.slice(0, 50).map((it, i) => {
          const t = tint[it.type] ?? tint.reassign;
          const ts = new Date(it.ts);
          return (
            <div key={`${it.type}-${it.data.id ?? i}`} style={{
              display: 'flex', gap: 12, padding: 10, borderRadius: 12,
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderLeft: `3px solid ${t.fg}`,
            }}>
              <div style={{ minWidth: 80, fontSize: 11.5 }}>
                <div style={{ fontWeight: 700 }}>
                  {ts.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                </div>
                <div className="muted mono" style={{ fontSize: 11 }}>
                  {ts.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="center gap-2" style={{ marginBottom: 4 }}>
                  <span className="chip" style={{ background: t.bg, color: t.fg, fontSize: 10.5 }}>{t.label}</span>
                  <TimelineSummary type={it.type} data={it.data} />
                </div>
                {it.type === 'kunjungan' && it.data.catatan && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{it.data.catatan}</div>
                )}
                {it.type === 'feedback' && it.data.comment && (
                  <div className="muted" style={{ fontSize: 12, fontStyle: 'italic', marginTop: 4 }}>
                    "{it.data.comment}"
                  </div>
                )}
                {it.type === 'escalation' && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{it.data.reason}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function TimelineSummary({ type, data }: { type: string; data: any }) {
  if (type === 'kunjungan') {
    return (
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
        {data.hasil} oleh {data.petugas?.nama ?? '—'}
        {Number(data.nominal) > 0 && (
          <> · Rp {Number(data.nominal).toLocaleString('id-ID')}</>
        )}
      </span>
    );
  }
  if (type === 'pembayaran') {
    return (
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
        Rp {Number(data.nominal).toLocaleString('id-ID')} · {data.metode} · {data.status}
      </span>
    );
  }
  if (type === 'feedback') {
    return <span style={{ fontSize: 12.5, fontWeight: 600 }}>Rating {data.rating}/5</span>;
  }
  if (type === 'reassign') {
    return <span style={{ fontSize: 12.5, fontWeight: 600 }}>Dipindah oleh {data.actor ?? '—'}</span>;
  }
  if (type === 'escalation') {
    return (
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
        {data.severity.toUpperCase()} · {data.status}
      </span>
    );
  }
  return null;
}

interface NoteRow {
  id: string; body: string; createdAt: string;
  author: { id: string; username: string; nama: string; role: string };
}

function NotesSection({ nasabahId }: { nasabahId: string }) {
  const qc = useQueryClient();
  const me = useAuth(s => s.user);
  const q = useQuery<NoteRow[]>({
    queryKey: ['nasabah-notes', nasabahId],
    queryFn: async () => (await axios.get(`${BASE}/nasabah/${nasabahId}/notes`,
      { withCredentials: true, headers: headers() })).data,
  });
  const [body, setBody] = useState('');
  const create = useMutation({
    mutationFn: async () => axios.post(`${BASE}/nasabah/${nasabahId}/notes`,
      { body: body.trim() }, { withCredentials: true, headers: headers() }),
    onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: ['nasabah-notes', nasabahId] }); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => axios.delete(`${BASE}/nasabah/${nasabahId}/notes/${id}`,
      { withCredentials: true, headers: headers() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nasabah-notes', nasabahId] }),
  });
  const canDelete = (n: NoteRow) => me?.role === 'ADMIN' || n.author.id === me?.id;
  const notes = q.data ?? [];
  return (
    <Section title={`Catatan Internal (${notes.length})`}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="center gap-2" style={{ alignItems: 'flex-end' }}>
          <textarea className="input" rows={2} maxLength={2000}
            placeholder="Tambahkan catatan internal — tidak terlihat oleh nasabah."
            value={body} onChange={e => setBody(e.target.value)}
            style={{ resize: 'vertical', flex: 1 }} />
          <button className="btn btn-primary"
            disabled={!body.trim() || create.isPending}
            onClick={() => create.mutate()}>
            <Ic.plus size={14} />Tambah
          </button>
        </div>
        {q.isLoading ? <Skeleton h={80} />
          : notes.length === 0 ? <EmptyState title="Belum ada catatan" />
          : notes.map(n => (
            <div key={n.id} className="card card-pad" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
              <div className="between" style={{ marginBottom: 6 }}>
                <div className="center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{n.author.nama || n.author.username}</span>
                  <span className="chip" style={{ fontSize: 10 }}>{n.author.role}</span>
                </div>
                <div className="center gap-2">
                  <span className="muted" style={{ fontSize: 11 }}>
                    {new Date(n.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {canDelete(n) && (
                    <button className="btn btn-sm btn-ghost" disabled={remove.isPending}
                      onClick={() => remove.mutate(n.id)}>
                      <Ic.x size={12} />
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{n.body}</div>
            </div>
          ))}
      </div>
    </Section>
  );
}
