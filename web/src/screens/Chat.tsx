import { useEffect, useRef, useState, type FormEvent } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { Avatar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useEventStream } from '../lib/useEventStream';

const BASE = import.meta.env.VITE_API_URL || '/api';

function headers(): Record<string, string> {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

interface Convo {
  otherId: string;
  other: { id: string; nama: string; username: string; role: string };
  lastBody: string;
  lastAt: string;
  unread: number;
}
interface Message {
  id: string; fromId: string; toId: string;
  body: string; readAt: string | null; createdAt: string;
}

interface Recipient {
  id: string; username: string; nama: string; role: string;
  branch: { kode: string; nama: string } | null;
}

export function ScreenChat() {
  const me = useAuth(s => s.user);
  const qc = useQueryClient();
  const [active, setActive] = useState<Convo | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const convosQ = useQuery<{ conversations: Convo[] }>({
    queryKey: ['chat-convos'],
    queryFn: async () => (await axios.get(`${BASE}/chat/conversations`, {
      withCredentials: true, headers: headers(),
    })).data,
    refetchInterval: 60_000,
  });

  // SSE: realtime push pesan baru. Invalidate convos + thread bila aktif.
  useEventStream();
  useEffect(() => {
    const onMsg = (e: Event) => {
      const ce = e as CustomEvent;
      const data = ce.detail as { fromId?: string; toId?: string };
      if (data?.toId === me?.id || data?.fromId === me?.id) {
        void qc.invalidateQueries({ queryKey: ['chat-convos'] });
        if (active && (data.fromId === active.otherId || data.toId === active.otherId)) {
          void qc.invalidateQueries({ queryKey: ['chat-thread', active.otherId] });
        }
      }
    };
    window.addEventListener('bsn:chat.message', onMsg as EventListener);
    return () => window.removeEventListener('bsn:chat.message', onMsg as EventListener);
  }, [active, me?.id, qc]);

  if (convosQ.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (convosQ.isError) return <div className="content"><ErrorState onRetry={() => convosQ.refetch()} /></div>;

  const convos = convosQ.data?.conversations ?? [];

  return (
    <div className="content" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0, height: '100%', overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)' }}>
      <aside style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <div className="between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Percakapan</div>
          <button type="button" className="btn btn-sm btn-primary"
            onClick={() => setPickerOpen(true)}>
            <Ic.plus size={14} />Mulai chat
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {convos.length === 0
            ? <div style={{ padding: 24 }}><EmptyState title="Belum ada percakapan" hint="Mulai dari kartu petugas atau ketuk balas notif chat." /></div>
            : convos.map(c => (
              <button key={c.otherId} type="button"
                onClick={() => setActive(c)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', gap: 10,
                  padding: '12px 14px', border: 'none',
                  background: active?.otherId === c.otherId ? 'var(--accent-soft)' : 'var(--surface)',
                  borderBottom: '1px solid var(--line)', cursor: 'pointer',
                }}>
                <Avatar inisial={c.other.nama.slice(0, 2).toUpperCase()} hue={162} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="between">
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{c.other.nama}</span>
                    {c.unread > 0 && (
                      <span className="badge-count num" style={{ background: 'var(--col-macet)', color: 'white', borderRadius: 99, padding: '1px 7px', fontSize: 11 }}>
                        {c.unread}
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.lastBody}</div>
                </div>
              </button>
            ))}
        </div>
      </aside>
      {active ? <ChatThread otherId={active.otherId} otherName={active.other.nama} />
              : (
                <div className="center" style={{ height: '100%', justifyContent: 'center', color: 'var(--ink-4)', flexDirection: 'column', gap: 10 }}>
                  <Ic.send size={36} />
                  <div style={{ fontWeight: 700 }}>Pilih percakapan untuk mulai</div>
                  <button type="button" className="btn btn-primary"
                    onClick={() => setPickerOpen(true)} style={{ marginTop: 8 }}>
                    <Ic.plus size={14} />Mulai chat baru
                  </button>
                </div>
              )}
      {pickerOpen && (
        <RecipientPicker
          onClose={() => setPickerOpen(false)}
          onPick={(u) => {
            setPickerOpen(false);
            setActive({
              otherId: u.id,
              other: { id: u.id, nama: u.nama, username: u.username, role: u.role },
              lastBody: '',
              lastAt: new Date().toISOString(),
              unread: 0,
            });
          }}
        />
      )}
    </div>
  );
}

function RecipientPicker({ onClose, onPick }: { onClose: () => void; onPick: (u: Recipient) => void }) {
  const [q, setQ] = useState('');
  const recQ = useQuery<{ users: Recipient[] }>({
    queryKey: ['chat-recipients'],
    queryFn: async () => (await axios.get(`${BASE}/chat/recipients`, {
      withCredentials: true, headers: headers(),
    })).data,
  });
  const users = recQ.data?.users ?? [];
  const filtered = q.trim() === ''
    ? users
    : users.filter(u =>
        u.nama.toLowerCase().includes(q.toLowerCase())
        || u.username.toLowerCase().includes(q.toLowerCase()));
  return (
    <div role="dialog" aria-modal="true" aria-label="Pilih lawan chat"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'grid', placeItems: 'center', padding: 16,
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 16,
          maxWidth: 480, width: '100%', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        }}>
        <div className="between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Mulai Chat Baru</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Tutup">
            <Ic.x size={16} />
          </button>
        </div>
        <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
          <div className="search">
            <Ic.search size={16} />
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Cari nama atau username…" autoFocus />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {recQ.isPending ? <Skeleton h={200} />
            : recQ.isError ? <ErrorState onRetry={() => recQ.refetch()} />
            : filtered.length === 0
              ? <EmptyState title="Tidak ada user yang cocok"
                  hint={q.trim() ? `Tidak ada hasil untuk "${q}".` : 'Belum ada user yang bisa dichat.'} />
              : filtered.map(u => (
                <button key={u.id} type="button" onClick={() => onPick(u)}
                  style={{
                    width: '100%', display: 'flex', gap: 12, alignItems: 'center',
                    padding: '12px 16px', textAlign: 'left',
                    border: 'none', background: 'var(--surface)',
                    borderBottom: '1px solid var(--line)', cursor: 'pointer',
                  }}>
                  <Avatar inisial={u.nama.slice(0, 2).toUpperCase()} hue={162} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u.nama}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {u.username} · {u.role}{u.branch ? ` · ${u.branch.kode}` : ''}
                    </div>
                  </div>
                  <Ic.arrowRight size={16} style={{ color: 'var(--ink-4)' }} />
                </button>
              ))}
        </div>
      </div>
    </div>
  );
}

function ChatThread({ otherId, otherName }: { otherId: string; otherName: string }) {
  const me = useAuth(s => s.user);
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const q = useQuery<{ messages: Message[] }>({
    queryKey: ['chat-thread', otherId],
    queryFn: async () => (await axios.get(`${BASE}/chat/with/${otherId}`, {
      withCredentials: true, headers: headers(),
    })).data,
    refetchInterval: 30_000,
  });
  const messages = q.data?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await axios.post(`${BASE}/chat/messages`,
        { toId: otherId, body },
        { withCredentials: true, headers: headers() });
      setText('');
      void qc.invalidateQueries({ queryKey: ['chat-thread', otherId] });
      void qc.invalidateQueries({ queryKey: ['chat-convos'] });
    } finally { setSending(false); }
  };

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 800, fontSize: 14 }}>
        {otherName}
      </div>
      <div ref={scrollRef} style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.length === 0
          ? <div className="muted" style={{ textAlign: 'center', padding: 30 }}>Belum ada pesan. Mulai dengan menyapa.</div>
          : messages.map(m => {
            const mine = m.fromId === me?.id;
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '78%', padding: '8px 12px', borderRadius: 14,
                  background: mine ? 'var(--accent)' : 'var(--surface-2)',
                  color: mine ? 'white' : 'var(--ink)',
                  fontSize: 13.5, lineHeight: 1.45,
                  borderBottomRightRadius: mine ? 4 : 14,
                  borderBottomLeftRadius: mine ? 14 : 4,
                  wordBreak: 'break-word',
                }}>
                  {m.body}
                  <div style={{ fontSize: 10, opacity: 0.65, marginTop: 2, textAlign: 'right' }}>
                    {new Date(m.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: '12px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <input className="input" value={text} onChange={e => setText(e.target.value)}
          placeholder="Ketik pesan…" maxLength={2000}
          style={{ flex: 1 }} />
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || sending}>
          {sending ? '…' : <><Ic.send size={14} />Kirim</>}
        </button>
      </form>
    </div>
  );
}
