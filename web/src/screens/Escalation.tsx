import { useState } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { KolBadge, Modal } from '../components/UI';
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

type Status = 'open' | 'in_progress' | 'resolved' | 'dismissed';
type Severity = 'critical' | 'high' | 'medium';

interface Ticket {
  id: string;
  nasabahId: string;
  branchId: string;
  severity: Severity;
  reason: string;
  status: Status;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  nasabah: { kode: string; nama: string; kol: string; dpd: number; sisa: string | number; hp: string };
  branch: { kode: string; nama: string };
  assignedTo: { username: string; nama: string } | null;
}

async function fetchTickets(status: Status | 'open-all'): Promise<Ticket[]> {
  return (await axios.get(`${BASE}/escalation`, {
    withCredentials: true, headers: headers(),
    params: { status: status === 'open-all' ? undefined : status },
  })).data;
}

const SEV_TINT: Record<Severity, { bg: string; fg: string; label: string }> = {
  critical: { bg: 'var(--col-macet-soft)', fg: 'var(--col-macet)', label: 'Critical' },
  high: { bg: 'var(--col-kl-soft)', fg: 'var(--col-kl)', label: 'High' },
  medium: { bg: 'var(--col-dpk-soft)', fg: 'var(--col-dpk)', label: 'Medium' },
};
const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

function fmtRp(n: number): string {
  if (n >= 1_000_000_000) return 'Rp ' + (n / 1_000_000_000).toFixed(1) + ' M';
  if (n >= 1_000_000) return 'Rp ' + (n / 1_000_000).toFixed(1) + ' jt';
  return 'Rp ' + n.toLocaleString('id-ID');
}

export function ScreenEscalation() {
  const [filter, setFilter] = useState<Status | 'open-all'>('open-all');
  const [editing, setEditing] = useState<Ticket | null>(null);
  const q = useQuery({ queryKey: ['escalation', filter], queryFn: () => fetchTickets(filter) });

  if (q.isPending) return <div className="content"><Skeleton h={500} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const rows = q.data ?? [];

  const counts = rows.reduce((acc, r) => {
    if (r.status === 'open' || r.status === 'in_progress') {
      acc[r.severity]++;
    }
    return acc;
  }, { critical: 0, high: 0, medium: 0 } as Record<Severity, number>);

  return (
    <div className="content">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        {(['critical', 'high', 'medium'] as Severity[]).map(sev => (
          <div key={sev} style={{
            background: SEV_TINT[sev].bg, color: SEV_TINT[sev].fg,
            borderRadius: 14, padding: 14,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {SEV_TINT[sev].label}
            </div>
            <div className="num" style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{counts[sev]}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.85 }}>
              tiket open
            </div>
          </div>
        ))}
      </div>

      <div className="seg" style={{ marginBottom: 12 }} role="tablist">
        {([
          ['open-all', 'Open + In progress'],
          ['open', 'Open'],
          ['in_progress', 'In progress'],
          ['resolved', 'Resolved'],
          ['dismissed', 'Dismissed'],
        ] as const).map(([k, l]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Tidak ada tiket pada filter ini" />
      ) : (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Nasabah</th>
                <th>Cabang</th>
                <th>Reason</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id}>
                  <td>
                    <span className="chip" style={{
                      background: SEV_TINT[t.severity].bg, color: SEV_TINT[t.severity].fg, fontSize: 11.5,
                    }}>
                      <Ic.alert size={11} />{SEV_TINT[t.severity].label}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{t.nasabah.nama}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{t.nasabah.kode} · DPD {t.nasabah.dpd}d</div>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{t.branch.kode}</td>
                  <td style={{ fontSize: 12 }}>{t.reason}</td>
                  <td>
                    <span className="chip" style={{
                      background: t.status === 'resolved' ? 'var(--accent-soft)'
                        : t.status === 'dismissed' ? 'var(--surface-2)'
                        : t.status === 'in_progress' ? 'var(--col-dpk-soft)' : 'var(--col-macet-soft)',
                      color: t.status === 'resolved' ? 'var(--accent-ink)'
                        : t.status === 'dismissed' ? 'var(--ink-3)'
                        : t.status === 'in_progress' ? 'var(--col-dpk)' : 'var(--col-macet)',
                      fontSize: 11.5,
                    }}>{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtRp(Number(t.nasabah.sisa))}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(t)}>
                      <Ic.settings size={12} />Tindak
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TicketModal ticket={editing}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function TicketModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const [status, setStatus] = useState<Status>(ticket.status);
  const [note, setNote] = useState(ticket.note ?? '');
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => axios.patch(`${BASE}/escalation/${ticket.id}`,
      { status, note: note || null },
      { withCredentials: true, headers: headers() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalation'] });
      onClose();
    },
    onError: () => setErr('Gagal menyimpan.'),
  });
  return (
    <Modal onClose={onClose} max={520}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">Tindak Tiket Escalation</div>
          <div className="muted mono" style={{ fontSize: 11, marginTop: 3 }}>
            {ticket.nasabah.kode} · {ticket.nasabah.nama}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
        <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none', padding: 12 }}>
          <div className="between">
            <KolBadge kol={Number(ticket.nasabah.kol[1]) as 1 | 2 | 3 | 4 | 5} />
            <span className="chip" style={{
              background: SEV_TINT[ticket.severity].bg, color: SEV_TINT[ticket.severity].fg,
            }}>{SEV_TINT[ticket.severity].label}</span>
          </div>
          <div style={{ fontSize: 12.5, marginTop: 8, color: 'var(--ink-2)' }}>{ticket.reason}</div>
          <div className="muted mono" style={{ fontSize: 11, marginTop: 6 }}>
            HP {ticket.nasabah.hp} · sisa {fmtRp(Number(ticket.nasabah.sisa))} · dibuka {new Date(ticket.createdAt).toLocaleDateString('id-ID')}
          </div>
        </div>
        <Field label="Status">
          <select className="input" value={status} onChange={e => setStatus(e.target.value as Status)}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </Field>
        <Field label="Catatan tindakan">
          <textarea className="input" rows={3} value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Apa yang sudah dilakukan? Janji bayar baru? Eskalasi ke legal?"
            style={{ resize: 'none' }} />
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
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
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
