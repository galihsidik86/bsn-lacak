import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import type { ReactNode } from 'react';
import { Avatar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { listTodayAttendance } from '../lib/attendance';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Row {
  petugasId: string;
  nama: string;
  kode: string;
  inisial: string;
  hue: number;
  wilayah: string;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  rejectionRate: number;
  flagged: number;
  flaggedRate: number;
  avgRiskScore: number;
  avgResponseMinutes: number | null;
  lastKunjunganAt: string | null;
}

interface Response { since: string; windowDays: number; rows: Row[] }

function headers(): Record<string, string> {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

async function fetchPerformance(days: number): Promise<Response> {
  return (await axios.get(`${BASE}/petugas/performance`, {
    params: { days }, withCredentials: true, headers: headers(),
  })).data;
}

function pct(n: number): string {
  return Math.round(n * 100) + '%';
}

function fmtMinutes(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)}j`;
  return `${(m / (60 * 24)).toFixed(1)}h`;
}

function fmtLast(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

// Sort key picker — clicking a column header cycles between desc on that
// column and the previous sort. Default sort by rejection rate desc puts the
// problem petugas at the top, which is what supervisors actually care about.
type SortKey = 'rejectionRate' | 'flaggedRate' | 'avgRiskScore' | 'total' | 'avgResponseMinutes';

export function ScreenPerforma() {
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<SortKey>('rejectionRate');
  const q = useQuery({
    queryKey: ['petugas-performance', days],
    queryFn: () => fetchPerformance(days),
  });
  const attQ = useQuery({
    queryKey: ['attendance-today'],
    queryFn: listTodayAttendance,
    refetchInterval: 60_000,
  });

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  if (!q.data || q.data.rows.length === 0) {
    return <div className="content"><EmptyState title="Belum ada data" hint="Tidak ada kunjungan dalam window yang dipilih." /></div>;
  }

  // Petugas with zero kunjungan land at the bottom — irrelevant for review.
  const rows = [...q.data.rows].sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    const an = typeof av === 'number' ? av : -1;
    const bn = typeof bv === 'number' ? bv : -1;
    return bn - an;
  });

  const totalKunjungan = rows.reduce((s, r) => s + r.total, 0);
  const totalRejected = rows.reduce((s, r) => s + r.rejected, 0);
  const totalFlagged = rows.reduce((s, r) => s + r.flagged, 0);
  const overallReject = rows.reduce((s, r) => s + r.approved + r.rejected, 0);

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="seg">
            {[7, 30, 90].map(d => (
              <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} hari</button>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            sejak {new Date(q.data.since).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
          </span>
        </div>
        <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="chip"><Ic.clipboard size={13} />{totalKunjungan} kunjungan</div>
          <div className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
            <Ic.alert size={13} />{totalFlagged} di-flag
          </div>
          <div className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
            <Ic.x size={13} />{totalRejected} ditolak ({overallReject > 0 ? pct(totalRejected / overallReject) : '0%'})
          </div>
        </div>
      </div>

      <AttendanceCard data={attQ.data ?? []} loading={attQ.isPending} />

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Petugas</th>
              <SortTh col="total" sort={sort} setSort={setSort}>Total</SortTh>
              <th style={{ textAlign: 'center' }}>Status</th>
              <SortTh col="rejectionRate" sort={sort} setSort={setSort}>Tolak %</SortTh>
              <SortTh col="flaggedRate" sort={sort} setSort={setSort}>Flag %</SortTh>
              <SortTh col="avgRiskScore" sort={sort} setSort={setSort}>Risk Avg</SortTh>
              <SortTh col="avgResponseMinutes" sort={sort} setSort={setSort}>Avg Review</SortTh>
              <th>Aktivitas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.petugasId}>
                <td>
                  <div className="center gap-2">
                    <Avatar inisial={r.inisial} hue={r.hue} size={28} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{r.nama}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>{r.kode} · {r.wilayah}</div>
                    </div>
                  </div>
                </td>
                <td className="num" style={{ fontWeight: 700 }}>{r.total}</td>
                <td>
                  <div className="center gap-1" style={{ justifyContent: 'center', fontSize: 11.5, fontWeight: 700 }}>
                    <span title="Disetujui" style={{ color: 'var(--accent)' }}>{r.approved}</span>
                    <span style={{ opacity: 0.4 }}>/</span>
                    <span title="Pending" style={{ color: 'var(--gold)' }}>{r.pending}</span>
                    <span style={{ opacity: 0.4 }}>/</span>
                    <span title="Ditolak" style={{ color: 'var(--col-macet)' }}>{r.rejected}</span>
                  </div>
                </td>
                <RateCell value={r.rejectionRate} warnAt={0.15} />
                <RateCell value={r.flaggedRate} warnAt={0.10} />
                <td className="num" style={{
                  fontWeight: 700,
                  color: r.avgRiskScore > 5 ? 'var(--col-macet)' : 'var(--ink)',
                }}>{r.avgRiskScore.toFixed(1)}</td>
                <td className="num">{fmtMinutes(r.avgResponseMinutes)}</td>
                <td className="muted mono" style={{ fontSize: 11.5 }}>{fmtLast(r.lastKunjunganAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.6 }}>
        <strong>Tolak %</strong> = ditolak ÷ (disetujui + ditolak). <strong>Flag %</strong> = kunjungan dengan riskScore &gt; 0
        ÷ total. <strong>Risk Avg</strong> = rata-rata riskScore tiap kunjungan. <strong>Avg Review</strong> = jeda
        rata-rata antara petugas submit dan supervisor review.
      </div>
    </div>
  );
}

function SortTh({ col, sort, setSort, children }: {
  col: SortKey; sort: SortKey; setSort: (k: SortKey) => void; children: ReactNode;
}) {
  const active = sort === col;
  return (
    <th onClick={() => setSort(col)} style={{
      cursor: 'pointer', textAlign: 'right', userSelect: 'none',
      color: active ? 'var(--accent)' : undefined,
    }}>
      <span className="center gap-2" style={{ justifyContent: 'flex-end' }}>
        {children}{active && <span style={{ fontSize: 10 }}>▾</span>}
      </span>
    </th>
  );
}

type AttendanceRow = Awaited<ReturnType<typeof listTodayAttendance>>[number];

function fmtElapsedMin(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}j` : `${h}j ${m}m`;
}

function AttendanceCard({ data, loading }: { data: AttendanceRow[]; loading: boolean }) {
  const active = data.filter(r => r.clockOutAt === null);
  const done = data.filter(r => r.clockOutAt !== null);
  return (
    <div className="card fade-up" style={{ marginBottom: 16 }}>
      <div className="between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <div className="section-title">Kehadiran Hari Ini</div>
        <div className="center gap-2">
          <div className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
            <Ic.user size={13} />{active.length} aktif
          </div>
          <div className="chip">{done.length} selesai</div>
        </div>
      </div>
      {loading ? (
        <div style={{ padding: 16 }}><Skeleton h={80} /></div>
      ) : data.length === 0 ? (
        <div className="muted" style={{ padding: '18px', fontSize: 13, textAlign: 'center' }}>
          Belum ada petugas yang clock-in hari ini.
        </div>
      ) : (
        <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {data.map(r => {
            const isActive = r.clockOutAt === null;
            const start = new Date(r.clockInAt).getTime();
            const end = isActive ? Date.now() : new Date(r.clockOutAt!).getTime();
            return (
              <div key={r.id} style={{
                background: isActive ? 'var(--accent-soft)' : 'var(--surface-2)',
                border: `1px solid ${isActive ? 'var(--accent-soft-2, var(--accent))' : 'var(--line)'}`,
                borderRadius: 12, padding: '10px 12px',
              }}>
                <div className="center gap-2">
                  <Avatar inisial={r.petugas.inisial} hue={r.petugas.hue} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.petugas.nama}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>{r.petugas.kode} · {r.branch.kode}</div>
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 99,
                    background: isActive ? 'var(--accent)' : 'var(--ink-4)', color: 'white',
                  }}>{isActive ? 'AKTIF' : 'SELESAI'}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  <strong>{new Date(r.clockInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</strong>
                  {isActive
                    ? <> – sekarang · <strong>{fmtElapsedMin(end - start)}</strong></>
                    : <> – {new Date(r.clockOutAt!).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · <strong>{fmtElapsedMin(end - start)}</strong></>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RateCell({ value, warnAt }: { value: number; warnAt: number }) {
  const warn = value >= warnAt;
  return (
    <td className="num" style={{
      textAlign: 'right', fontWeight: 700,
      color: warn ? 'var(--col-macet)' : 'var(--ink)',
    }}>{pct(value)}</td>
  );
}
