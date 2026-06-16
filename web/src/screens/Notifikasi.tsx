import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: 'INFO' | 'WARN' | 'CRIT';
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotifResponse { items: Notif[]; unreadCount: number; nextCursor: string | null }

function authHeaders() {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchAll(params: { unread?: boolean; severity?: string; cursor?: string }): Promise<NotifResponse> {
  const r = await axios.get(`${BASE}/notifications`, {
    params: {
      ...(params.unread ? { unread: '1' } : {}),
      ...(params.severity ? { severity: params.severity } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      limit: 50,
    },
    withCredentials: true, headers: authHeaders(),
  });
  return r.data;
}

async function markRead(id: string) {
  await axios.patch(`${BASE}/notifications/${id}/read`, {}, {
    withCredentials: true, headers: authHeaders(),
  });
}
async function markAllRead() {
  await axios.post(`${BASE}/notifications/read-all`, {}, {
    withCredentials: true, headers: authHeaders(),
  });
}

const SEVERITY_META: Record<Notif['severity'], { label: string; color: string; bg: string; icon: 'checkCircle' | 'alert' }> = {
  INFO: { label: 'Info', color: 'var(--accent)', bg: 'var(--accent-soft)', icon: 'checkCircle' },
  WARN: { label: 'Peringatan', color: 'var(--col-dpk)', bg: 'var(--col-dpk-soft)', icon: 'alert' },
  CRIT: { label: 'Kritis', color: 'var(--col-macet)', bg: 'var(--col-macet-soft)', icon: 'alert' },
};

function fmtRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

function fmtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function ScreenNotifikasi({ go }: { go?: (k: string) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [severity, setSeverity] = useState<'all' | 'INFO' | 'WARN' | 'CRIT'>('all');

  const q = useQuery({
    queryKey: ['notifications-history', filter, severity],
    queryFn: () => fetchAll({
      unread: filter === 'unread',
      severity: severity === 'all' ? undefined : severity,
    }),
  });

  const readOne = useMutation({
    mutationFn: markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const handleClick = async (n: Notif) => {
    if (!n.readAt) await readOne.mutateAsync(n.id);
    if (n.link && go) go(n.link);
  };

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const items = q.data?.items ?? [];
  const unread = q.data?.unreadCount ?? 0;

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="seg">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Semua</button>
            <button className={filter === 'unread' ? 'on' : ''} onClick={() => setFilter('unread')}>
              Belum dibaca {unread > 0 && <span className="num" style={{ marginLeft: 4 }}>· {unread}</span>}
            </button>
          </div>
          <div className="seg">
            <button className={severity === 'all' ? 'on' : ''} onClick={() => setSeverity('all')}>Semua tingkat</button>
            <button className={severity === 'INFO' ? 'on' : ''} onClick={() => setSeverity('INFO')}>Info</button>
            <button className={severity === 'WARN' ? 'on' : ''} onClick={() => setSeverity('WARN')}>Peringatan</button>
            <button className={severity === 'CRIT' ? 'on' : ''} onClick={() => setSeverity('CRIT')}>Kritis</button>
          </div>
        </div>
        {unread > 0 && (
          <button className="btn" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
            <Ic.checkCircle size={15} />Tandai semua dibaca
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card"><EmptyState title="Tidak ada notifikasi" hint="Notifikasi sistem dan supervisor akan muncul di sini." /></div>
      ) : (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          {items.map(n => {
            const meta = SEVERITY_META[n.severity];
            const Icon = Ic[meta.icon];
            const isUnread = !n.readAt;
            return (
              <button key={n.id} onClick={() => handleClick(n)}
                className="center gap-3"
                style={{
                  width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  padding: '14px 18px', borderBottom: '1px solid var(--line)',
                  background: isUnread ? 'var(--surface-2)' : 'var(--surface)',
                  alignItems: 'flex-start',
                }}>
                <div className="stat-ic" style={{
                  background: meta.bg, color: meta.color, flex: 'none', width: 36, height: 36,
                }}>
                  <Icon size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="between">
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                      {n.title}
                      {isUnread && (
                        <span style={{
                          display: 'inline-block', width: 6, height: 6, borderRadius: 99,
                          background: meta.color, marginLeft: 6, verticalAlign: 'middle',
                        }} />
                      )}
                    </div>
                    <span className="muted mono" style={{ fontSize: 11 }} title={fmtAbsolute(n.createdAt)}>
                      {fmtRelative(n.createdAt)}
                    </span>
                  </div>
                  {n.body && (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.5 }}>
                      {n.body}
                    </div>
                  )}
                  <div className="muted center gap-2" style={{ fontSize: 11, marginTop: 6 }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 99,
                      background: meta.bg, color: meta.color, fontWeight: 700,
                    }}>{meta.label}</span>
                    <span className="mono">{n.type}</span>
                    {n.link && go && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>· buka {n.link} →</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
