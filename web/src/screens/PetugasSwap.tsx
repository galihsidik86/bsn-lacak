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

interface SwapRow {
  id: string; status: Status; reason: string;
  decisionNote: string | null; decidedAt: string | null;
  createdAt: string;
  proposer: { id: string; kode: string; nama: string };
  counterpart: { id: string; kode: string; nama: string };
  proposerNasabah: { id: string; kode: string; nama: string };
  counterpartNasabah: { id: string; kode: string; nama: string };
  decidedBy: { username: string; nama: string } | null;
}

interface PetugasOpt { id: string; kode: string; nama: string }
interface NasabahOpt { id: string; kode: string; nama: string; petugasId: string }

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

export function ScreenPetugasSwap() {
  const qc = useQueryClient();
  const me = useAuth(s => s.user);
  const [status, setStatus] = useState<Status | 'ALL'>('PENDING');
  const [proposing, setProposing] = useState(false);
  const q = useQuery<SwapRow[]>({
    queryKey: ['petugas-swaps', status],
    queryFn: async () => (await axios.get(`${BASE}/petugas-swaps`, {
      withCredentials: true, headers: headers(),
      params: status === 'ALL' ? {} : { status },
    })).data,
  });
  const decide = useMutation({
    mutationFn: async (p: { id: string; decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
      axios.patch(`${BASE}/petugas-swaps/${p.id}/decision`,
        { decision: p.decision, note: p.note },
        { withCredentials: true, headers: headers() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['petugas-swaps'] }),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) =>
      axios.delete(`${BASE}/petugas-swaps/${id}`, { withCredentials: true, headers: headers() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['petugas-swaps'] }),
  });
  const canDecide = me?.role === 'SUPERVISOR' || me?.role === 'ADMIN';
  const canPropose = me?.role === 'PETUGAS';
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
        {canPropose && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
            onClick={() => setProposing(true)}>
            <Ic.plus size={14} />Ajukan tukar
          </button>
        )}
      </div>

      {q.isLoading && <div className="card card-pad"><Skeleton h={300} /></div>}
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data && (rows.length === 0
        ? <EmptyState title="Tidak ada pengajuan pada filter ini" />
        : (
          <div className="card fade-up" style={{ overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Proposer</th>
                  <th>Counterpart</th>
                  <th>Nasabah ditukar</th>
                  <th>Alasan</th>
                  <th>Diputus</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const s = STATUS[r.status];
                  const isMe = me?.petugasId === r.proposer.id || me?.petugasId === r.counterpart.id;
                  const canCancel = r.status === 'PENDING' && (me?.role === 'ADMIN' || isMe);
                  return (
                    <tr key={r.id}>
                      <td><span className="chip" style={{ background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</span></td>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{r.proposer.nama}</div>
                        <div className="muted mono" style={{ fontSize: 11 }}>{r.proposer.kode}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{r.counterpart.nama}</div>
                        <div className="muted mono" style={{ fontSize: 11 }}>{r.counterpart.kode}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <div><span className="muted">{r.proposer.kode}:</span> {r.proposerNasabah.nama} ({r.proposerNasabah.kode})</div>
                        <div style={{ marginTop: 2 }}><span className="muted">{r.counterpart.kode}:</span> {r.counterpartNasabah.nama} ({r.counterpartNasabah.kode})</div>
                      </td>
                      <td style={{ maxWidth: 220, fontSize: 12 }}>
                        <div>{r.reason}</div>
                        {r.decisionNote && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Note: {r.decisionNote}</div>}
                      </td>
                      <td className="muted" style={{ fontSize: 11.5 }}>
                        {r.decidedAt ? (
                          <>
                            <div>{fmtDT(r.decidedAt)}</div>
                            {r.decidedBy && <div>oleh {r.decidedBy.nama || r.decidedBy.username}</div>}
                          </>
                        ) : '—'}
                      </td>
                      <td>
                        <div className="center gap-1">
                          {r.status === 'PENDING' && canDecide && (
                            <>
                              <button className="btn btn-sm btn-primary"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })}>
                                <Ic.check size={12} />
                              </button>
                              <button className="btn btn-sm"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: r.id, decision: 'REJECTED' })}>
                                <Ic.x size={12} />
                              </button>
                            </>
                          )}
                          {canCancel && (
                            <button className="btn btn-sm btn-ghost"
                              disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
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

      {proposing && (
        <ProposeModal onClose={() => setProposing(false)}
          onSaved={() => { setProposing(false); q.refetch(); }} />
      )}
    </div>
  );
}

function ProposeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const me = useAuth(s => s.user);
  const petugasQ = useQuery<PetugasOpt[]>({
    queryKey: ['petugas-list-for-swap'],
    queryFn: async () => (await axios.get(`${BASE}/petugas`, { withCredentials: true, headers: headers() })).data,
  });
  // All nasabah (server scopes to branch for PETUGAS via owner check is none —
  // we filter client-side by petugasId for the counterpart picker).
  const nasabahQ = useQuery<Array<NasabahOpt & { active: boolean }>>({
    queryKey: ['nasabah-list-for-swap'],
    queryFn: async () => (await axios.get(`${BASE}/nasabah`, { withCredentials: true, headers: headers() })).data,
  });
  const [mineNasabahId, setMineNasabahId] = useState('');
  const [counterpartPetugasId, setCounterpartPetugasId] = useState('');
  const [counterpartNasabahId, setCounterpartNasabahId] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const myPetugasId = me?.petugasId ?? '';
  const myNasabah = (nasabahQ.data ?? []).filter(n => n.petugasId === myPetugasId && n.active);
  const otherPetugas = (petugasQ.data ?? []).filter(p => p.id !== myPetugasId);
  const counterpartChoices = (nasabahQ.data ?? []).filter(n => n.petugasId === counterpartPetugasId && n.active);

  const save = useMutation({
    mutationFn: async () => axios.post(`${BASE}/petugas-swaps`, {
      proposerNasabahId: mineNasabahId,
      counterpartNasabahId,
      reason: reason.trim(),
    }, { withCredentials: true, headers: headers() }),
    onSuccess: () => onSaved(),
    onError: (e: any) => {
      const c = e?.response?.data?.error;
      if (c === 'pending_exists') setErr('Sudah ada pengajuan PENDING yang melibatkan salah satu nasabah ini.');
      else if (c === 'cross_branch_forbidden') setErr('Tidak bisa tukar nasabah lintas cabang.');
      else if (c === 'not_owner') setErr('Nasabah pertama bukan milik Anda.');
      else if (c === 'same_petugas') setErr('Kedua nasabah dimiliki petugas yang sama.');
      else setErr('Gagal menyimpan.');
    },
  });

  return (
    <Modal onClose={onClose} max={500}>
      <div className="modal-head">
        <div style={{ flex: 1 }}><div className="section-title">Ajukan Tukar Nasabah</div></div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body" style={{ display: 'grid', gap: 10 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Pilih nasabah milikmu dan satu nasabah milik petugas lain dalam cabang yang sama.
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Nasabah Anda</div>
          <select className="input" value={mineNasabahId} onChange={e => setMineNasabahId(e.target.value)}>
            <option value="">Pilih nasabah Anda…</option>
            {myNasabah.map(n => <option key={n.id} value={n.id}>{n.kode} · {n.nama}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Petugas counterpart</div>
          <select className="input" value={counterpartPetugasId} onChange={e => { setCounterpartPetugasId(e.target.value); setCounterpartNasabahId(''); }}>
            <option value="">Pilih petugas counterpart…</option>
            {otherPetugas.map(p => <option key={p.id} value={p.id}>{p.kode} · {p.nama}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Nasabah counterpart</div>
          <select className="input" value={counterpartNasabahId} onChange={e => setCounterpartNasabahId(e.target.value)} disabled={!counterpartPetugasId}>
            <option value="">{counterpartPetugasId ? 'Pilih nasabah counterpart…' : 'Pilih petugas dulu'}</option>
            {counterpartChoices.map(n => <option key={n.id} value={n.id}>{n.kode} · {n.nama}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Alasan</div>
          <textarea className="input" rows={3} maxLength={2000} value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Mis. lokasi nasabah lebih dekat dengan rute counterpart" />
        </div>
        {err && <div style={{ color: 'var(--col-macet)', fontSize: 12, fontWeight: 600 }}>{err}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary"
          disabled={!mineNasabahId || !counterpartNasabahId || !reason.trim() || save.isPending}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Menyimpan…' : 'Ajukan'}
        </button>
      </div>
    </Modal>
  );
}
