import { useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { Modal } from '../components/UI';
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

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface Dispute {
  id: string; status: Status; reason: string;
  proposedClockIn: string | null; proposedClockOut: string | null;
  decisionNote: string | null; decidedAt: string | null;
  createdAt: string;
  petugas: { id: string; kode: string; nama: string; branch: { kode: string } };
  attendance: { id: string; clockInAt: string; clockOutAt: string | null };
  decidedBy: { username: string; nama: string } | null;
}

const STATUS: Record<Status, { bg: string; fg: string; label: string }> = {
  PENDING:   { bg: 'oklch(0.93 0.05 75)',    fg: 'oklch(0.4 0.13 75)', label: 'Pending' },
  APPROVED:  { bg: 'var(--col-lancar-soft)', fg: 'var(--col-lancar)',  label: 'Disetujui' },
  REJECTED:  { bg: 'var(--col-macet-soft)',  fg: 'var(--col-macet)',   label: 'Ditolak' },
  CANCELLED: { bg: 'var(--surface-2)',       fg: 'var(--ink-3)',       label: 'Dibatalkan' },
};

function fmtDT(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ScreenAttendanceDisputes() {
  const qc = useQueryClient();
  const me = useAuth(s => s.user);
  const [status, setStatus] = useState<Status | 'ALL'>('PENDING');
  const q = useQuery<Dispute[]>({
    queryKey: ['attendance-disputes', status],
    queryFn: async () => (await axios.get(`${BASE}/attendance-disputes`, {
      withCredentials: true, headers: headers(),
      params: status === 'ALL' ? {} : { status },
    })).data,
  });
  const decide = useMutation({
    mutationFn: async (p: { id: string; decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
      axios.patch(`${BASE}/attendance-disputes/${p.id}/decision`,
        { decision: p.decision, note: p.note },
        { withCredentials: true, headers: headers() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-disputes'] }),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) =>
      axios.delete(`${BASE}/attendance-disputes/${id}`, { withCredentials: true, headers: headers() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-disputes'] }),
  });
  const canDecide = me?.role === 'SUPERVISOR' || me?.role === 'ADMIN';
  const rows = q.data ?? [];

  return (
    <div className="grid gap-3">
      <div className="card fade-up card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Status</div>
        <select className="input" value={status} onChange={e => setStatus(e.target.value as any)} style={{ width: 160 }}>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Disetujui</option>
          <option value="REJECTED">Ditolak</option>
          <option value="CANCELLED">Dibatalkan</option>
          <option value="ALL">Semua</option>
        </select>
        {me?.role === 'PETUGAS' && (
          <span className="muted" style={{ fontSize: 12 }}>
            Tampilan hanya dispute milikmu. Ajukan dari layar Aplikasi.
          </span>
        )}
      </div>

      {q.isLoading && <div className="card card-pad"><Skeleton h={300} /></div>}
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data && (rows.length === 0
        ? <EmptyState title="Tidak ada dispute pada filter ini" />
        : (
          <div className="card fade-up" style={{ overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Petugas</th>
                  <th>Attendance asli</th>
                  <th>Usulan baru</th>
                  <th>Alasan</th>
                  <th>Diputus</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(d => {
                  const s = STATUS[d.status];
                  const canCancel = d.status === 'PENDING' && (me?.role === 'ADMIN' || me?.petugasId === d.petugas.id);
                  return (
                    <tr key={d.id}>
                      <td><span className="chip" style={{ background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span></td>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{d.petugas.nama}</div>
                        <div className="muted mono" style={{ fontSize: 11 }}>{d.petugas.kode} · {d.petugas.branch.kode}</div>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        <div>In: {fmtDT(d.attendance.clockInAt)}</div>
                        <div>Out: {fmtDT(d.attendance.clockOutAt)}</div>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        <div>{d.proposedClockIn ? `In: ${fmtDT(d.proposedClockIn)}` : <span className="muted">In tidak diubah</span>}</div>
                        <div>{d.proposedClockOut ? `Out: ${fmtDT(d.proposedClockOut)}` : <span className="muted">Out tidak diubah</span>}</div>
                      </td>
                      <td style={{ maxWidth: 260, fontSize: 12 }}>
                        <div>{d.reason}</div>
                        {d.decisionNote && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Note: {d.decisionNote}</div>}
                      </td>
                      <td className="muted" style={{ fontSize: 11.5 }}>
                        {d.decidedAt ? (
                          <>
                            <div>{fmtDT(d.decidedAt)}</div>
                            {d.decidedBy && <div>oleh {d.decidedBy.nama || d.decidedBy.username}</div>}
                          </>
                        ) : '—'}
                      </td>
                      <td>
                        <div className="center gap-1">
                          {d.status === 'PENDING' && canDecide && (
                            <>
                              <button className="btn btn-sm btn-primary"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: d.id, decision: 'APPROVED' })}>
                                <Ic.check size={12} />
                              </button>
                              <button className="btn btn-sm"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: d.id, decision: 'REJECTED' })}>
                                <Ic.x size={12} />
                              </button>
                            </>
                          )}
                          {canCancel && (
                            <button className="btn btn-sm btn-ghost"
                              disabled={cancel.isPending} onClick={() => cancel.mutate(d.id)}>
                              Batal
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
