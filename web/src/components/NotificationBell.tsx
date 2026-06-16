import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from './Icons';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: 'INFO' | 'WARN' | 'CRIT';
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotifResponse { items: Notification[]; unreadCount: number }

async function fetchNotifications(): Promise<NotifResponse> {
  if (USE_MOCK) return { items: [], unreadCount: 0 };
  const tok = tokenStore.get();
  const r = await axios.get(`${BASE}/notifications`, {
    withCredentials: true,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });
  return r.data;
}

async function markRead(id: string) {
  if (USE_MOCK) return;
  const tok = tokenStore.get();
  await axios.patch(`${BASE}/notifications/${id}/read`, {}, {
    withCredentials: true,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });
}

async function markAllRead() {
  if (USE_MOCK) return;
  const tok = tokenStore.get();
  await axios.post(`${BASE}/notifications/read-all`, {}, {
    withCredentials: true,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });
}

const SEVERITY_COLOR: Record<Notification['severity'], string> = {
  INFO: 'var(--accent)',
  WARN: 'var(--col-dpk)',
  CRIT: 'var(--col-macet)',
};

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

export function NotificationBell({ onNavigate }: { onNavigate?: (link: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    staleTime: 10_000,
    enabled: !USE_MOCK,
  });

  const items = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  const readOne = useMutation({
    mutationFn: markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost"
        style={{ padding: 9, position: 'relative' }}
        aria-label={`Notifikasi${unread > 0 ? ` (${unread} belum dibaca)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        <Ic.bell size={19} aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 16, height: 16, padding: '0 4px', borderRadius: 99,
            background: 'var(--col-macet)', color: 'white',
            fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center',
            border: '1.5px solid var(--surface)',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Daftar notifikasi" style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 8, zIndex: 50,
          width: 360, maxHeight: 520, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14,
          boxShadow: 'var(--sh-3)',
        }}>
          <div className="between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Notifikasi</div>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => readAll.mutate()}>
                Tandai semua dibaca
              </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {items.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                Belum ada notifikasi.
              </div>
            ) : items.map(n => {
              const unreadDot = !n.readAt;
              return (
                <button key={n.id} onClick={() => {
                  if (unreadDot) readOne.mutate(n.id);
                  if (n.link && onNavigate) { onNavigate(n.link); setOpen(false); }
                }} style={{
                  display: 'flex', gap: 11, padding: '12px 16px', width: '100%',
                  textAlign: 'left', border: 'none', cursor: 'pointer',
                  background: unreadDot ? 'var(--accent-soft)' : 'transparent',
                  borderBottom: '1px solid var(--line)',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 99, marginTop: 6, flex: 'none',
                    background: unreadDot ? SEVERITY_COLOR[n.severity] : 'transparent',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{n.title}</div>
                    {n.body && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{n.body}</div>
                    )}
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {onNavigate && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', textAlign: 'center' }}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { onNavigate('notifikasi'); setOpen(false); }}>
                Lihat semua notifikasi →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
