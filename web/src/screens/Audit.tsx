import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface AuditRow {
  id: string;
  actorId: string | null;
  actor: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

interface ListResponse { items: AuditRow[]; nextCursor: string | null }

function authHeader() {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function listAudit(params: Record<string, string | undefined>): Promise<ListResponse> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v) cleaned[k] = v;
  const r = await axios.get(`${BASE}/audit`, {
    withCredentials: true, headers: authHeader(), params: cleaned,
  });
  return r.data;
}

async function listActions(): Promise<string[]> {
  const r = await axios.get(`${BASE}/audit/actions`, { withCredentials: true, headers: authHeader() });
  return r.data;
}

// Color hints by action prefix — cheap visual scan during incident review.
function severityColor(action: string): string {
  if (action.endsWith('.fail') || action.endsWith('.lockout') || action.includes('reuse')) return 'var(--col-macet)';
  if (action.startsWith('auth.login')) return 'var(--accent)';
  if (action.startsWith('blast') || action.startsWith('nasabah.reassign')) return 'var(--col-dpk)';
  if (action.startsWith('branch')) return 'var(--gold-ink)';
  return 'var(--ink-3)';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ScreenAudit() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const q = useQuery({
    queryKey: ['audit', { action, actor, since, until, cursor }],
    queryFn: () => listAudit({
      action: action || undefined,
      actor: actor || undefined,
      since: since ? new Date(since).toISOString() : undefined,
      until: until ? new Date(until).toISOString() : undefined,
      cursor,
      limit: '50',
    }),
  });

  const actionsQ = useQuery({ queryKey: ['audit-actions'], queryFn: listActions, staleTime: 5 * 60_000 });

  const reset = () => { setAction(''); setActor(''); setSince(''); setUntil(''); setCursor(undefined); };

  return (
    <div className="content">
      {/* filters */}
      <div className="card fade-up" style={{ padding: 14, marginBottom: 16 }}>
        <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 180px' }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Action</span>
            <select className="input" value={action} onChange={e => { setCursor(undefined); setAction(e.target.value); }}>
              <option value="">Semua</option>
              {(actionsQ.data ?? []).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label style={{ flex: '1 1 180px' }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Actor</span>
            <input className="input" value={actor} onChange={e => { setCursor(undefined); setActor(e.target.value); }} placeholder="username…" />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Dari</span>
            <input className="input" type="datetime-local" value={since} onChange={e => { setCursor(undefined); setSince(e.target.value); }} />
          </label>
          <label>
            <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Sampai</span>
            <input className="input" type="datetime-local" value={until} onChange={e => { setCursor(undefined); setUntil(e.target.value); }} />
          </label>
          {(action || actor || since || until || cursor) && (
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              <Ic.x size={14} />Reset
            </button>
          )}
        </div>
      </div>

      {q.isPending ? (
        <Skeleton h={500} />
      ) : q.error ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (q.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Tidak ada audit entry" hint="Coba longgarkan filter di atas." />
      ) : (
        <>
          <div className="card fade-up" style={{ overflow: 'hidden' }}>
            <table className="table">
              <thead><tr>
                <th>Waktu</th><th>Aksi</th><th>Aktor</th><th>Target</th><th>IP</th><th>Detail</th>
              </tr></thead>
              <tbody>
                {q.data!.items.map(r => (
                  <tr key={r.id}>
                    <td className="num mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{formatTime(r.createdAt)}</td>
                    <td>
                      <span className="badge" style={{ background: 'var(--surface-2)', color: severityColor(r.action) }}>
                        <span className="dot" style={{ background: severityColor(r.action) }} />
                        {r.action}
                      </span>
                    </td>
                    <td>{r.actor ?? <span className="muted">—</span>}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{r.target ?? <span className="muted">—</span>}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{r.ip ?? '—'}</td>
                    <td>
                      {r.meta && Object.keys(r.meta).length > 0 ? (
                        <details>
                          <summary style={{ cursor: 'pointer', color: 'var(--ink-3)', fontSize: 12 }}>{Object.keys(r.meta).length} field</summary>
                          <pre className="mono" style={{ margin: '6px 0 0', fontSize: 11, background: 'var(--surface-2)', padding: 8, borderRadius: 6, overflow: 'auto', maxWidth: 320 }}>
                            {JSON.stringify(r.meta, null, 2)}
                          </pre>
                        </details>
                      ) : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {q.data!.nextCursor && (
            <div className="center" style={{ marginTop: 14, justifyContent: 'center' }}>
              <button className="btn" onClick={() => setCursor(q.data!.nextCursor ?? undefined)}>
                <Ic.arrowDown size={14} />Muat lebih banyak
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
