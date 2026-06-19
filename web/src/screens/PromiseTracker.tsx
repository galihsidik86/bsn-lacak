import { useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

type Status = 'kept' | 'missed' | 'pending';

interface Row {
  kunjunganId: string;
  tanggal: string;
  status: Status;
  deadline: string;
  followupAt: string | null;
  nasabah: { id: string; kode: string; nama: string };
  petugas: { id: string; kode: string; nama: string; branchKode: string };
}

interface Payload {
  windowDays: number;
  followupHours: number;
  rows: Row[];
  totals: Record<Status, number>;
}

const STATUS_COLOR: Record<Status, { bg: string; fg: string; label: string }> = {
  kept:    { bg: 'var(--col-lancar-soft)', fg: 'var(--col-lancar)', label: 'Ditepati' },
  missed:  { bg: 'var(--col-macet-soft)',  fg: 'var(--col-macet)',  label: 'Wanprestasi' },
  pending: { bg: 'oklch(0.93 0.05 75)',    fg: 'oklch(0.4 0.13 75)', label: 'Menunggu' },
};

function fmtTanggal(iso: string): string {
  return new Date(iso).toLocaleString('id-ID',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ScreenPromiseTracker() {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const q = useQuery<Payload>({
    queryKey: ['janji-tracker', days],
    queryFn: async () => (await axios.get(`${BASE}/analytics/janji-tracker`, {
      withCredentials: true, headers: headers(), params: { days },
    })).data,
  });

  const rows = (q.data?.rows ?? []).filter(r => filter === 'all' || r.status === filter);

  return (
    <div className="grid gap-3">
      <div className="card fade-up card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Window</div>
        <select className="input" value={days} onChange={e => setDays(Number(e.target.value))} style={{ width: 120 }}>
          <option value={7}>7 hari</option>
          <option value={14}>14 hari</option>
          <option value={30}>30 hari</option>
          <option value={60}>60 hari</option>
        </select>
        {q.data && (
          <div className="center gap-2" style={{ marginLeft: 'auto' }}>
            <StatusChip status="kept"    count={q.data.totals.kept}    active={filter === 'kept'}    onClick={() => setFilter(filter === 'kept'    ? 'all' : 'kept')} />
            <StatusChip status="missed"  count={q.data.totals.missed}  active={filter === 'missed'}  onClick={() => setFilter(filter === 'missed'  ? 'all' : 'missed')} />
            <StatusChip status="pending" count={q.data.totals.pending} active={filter === 'pending'} onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')} />
          </div>
        )}
      </div>

      {q.isLoading && <div className="card card-pad"><Skeleton h={300} /></div>}
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data && (rows.length === 0
        ? <EmptyState title="Tidak ada janji pada window ini" />
        : (
          <div className="card fade-up" style={{ overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tgl Janji</th>
                  <th>Status</th>
                  <th>Deadline</th>
                  <th>Nasabah</th>
                  <th>Petugas</th>
                  <th>Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.kunjunganId}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{fmtTanggal(r.tanggal)}</td>
                    <td>
                      <span className="chip" style={{
                        background: STATUS_COLOR[r.status].bg,
                        color: STATUS_COLOR[r.status].fg,
                        fontSize: 11, fontWeight: 700,
                      }}>{STATUS_COLOR[r.status].label}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{fmtTanggal(r.deadline)}</td>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{r.nasabah.nama}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>{r.nasabah.kode}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.petugas.nama}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{r.petugas.kode} · {r.petugas.branchKode}</div>
                    </td>
                    <td className="muted" style={{ fontSize: 11.5 }}>
                      {r.followupAt ? fmtTanggal(r.followupAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

function StatusChip({ status, count, active, onClick }:
  { status: Status; count: number; active: boolean; onClick: () => void }) {
  const c = STATUS_COLOR[status];
  return (
    <button className="chip" onClick={onClick} style={{
      background: active ? c.fg : c.bg,
      color: active ? '#fff' : c.fg,
      fontWeight: 700, fontSize: 11.5, cursor: 'pointer',
      border: active ? 'none' : `1px solid ${c.fg}33`,
    }}>
      <Ic.clock size={12} />{c.label} · {count}
    </button>
  );
}
