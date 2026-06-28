import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
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

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtRelativeDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return 'Hari Ini';
  if (diff === 1) return 'Kemarin';
  if (diff < 7) return d.toLocaleDateString('id-ID', { weekday: 'long' });
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: today.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
}

function fmtRowTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return fmtTime(iso);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 1) return 'Kemarin';
  if (diff < 7) return d.toLocaleDateString('id-ID', { weekday: 'short' });
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
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

  // SSE realtime push.
  useEventStream();
  useEffect(() => {
    const onMsg = (e: Event) => {
      const ce = e as CustomEvent;
      const data = ce.detail as { fromId?: string; toId?: string };
      if (data?.toId === me?.id || data?.fromId === me?.id) {
        void qc.invalidateQueries({ queryKey: ['chat-convos'] });
        void qc.invalidateQueries({ queryKey: ['chat-unread-count'] });
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
    <div className={'content chat-shell' + (active ? ' is-thread-open' : '')}>
      <aside className="chat-list">
        <div className="chat-list-head">
          <div className="chat-list-title">Percakapan</div>
          <button type="button" className="btn btn-sm btn-primary"
            onClick={() => setPickerOpen(true)}>
            <Ic.plus size={14} />Mulai chat
          </button>
        </div>
        <div className="chat-list-scroll">
          {convos.length === 0
            ? (
              <div className="chat-list-empty">
                <div style={{ fontWeight: 700, color: 'var(--ink-2)', marginBottom: 6 }}>Belum ada percakapan</div>
                <div>Mulai dari tombol "Mulai chat" di atas untuk pilih lawan bicara.</div>
              </div>
            )
            : convos.map(c => (
              <button key={c.otherId} type="button"
                onClick={() => setActive(c)}
                className={'chat-row'
                  + (active?.otherId === c.otherId ? ' is-active' : '')
                  + (c.unread > 0 ? ' has-unread' : '')}>
                <Avatar inisial={c.other.nama.slice(0, 2).toUpperCase()} hue={162} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="between" style={{ gap: 6 }}>
                    <span className="chat-row-name">{c.other.nama}</span>
                    <span className="chat-row-time">{fmtRowTime(c.lastAt)}</span>
                  </div>
                  <div className="between" style={{ gap: 6, marginTop: 2 }}>
                    <span className="chat-row-preview">{c.lastBody}</span>
                    {c.unread > 0 && (
                      <span className="chat-row-unread num">{c.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
        </div>
      </aside>

      {active ? (
        <ChatThread otherId={active.otherId} otherName={active.other.nama}
          otherRole={active.other.role} onBack={() => setActive(null)} />
      ) : (
        <div className="chat-thread">
          <div className="chat-empty-main">
            <div className="chat-empty-ic">
              <Ic.send size={36} aria-hidden="true" />
            </div>
            <div className="chat-empty-title">Pilih percakapan</div>
            <div className="chat-empty-body">
              Tap salah satu nama di kiri untuk lihat thread, atau klik "Mulai chat" untuk pilih lawan baru.
            </div>
            <button type="button" className="btn btn-primary"
              onClick={() => setPickerOpen(true)} style={{ marginTop: 4 }}>
              <Ic.plus size={14} />Mulai chat baru
            </button>
          </div>
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

function ChatThread({ otherId, otherName, otherRole, onBack }: {
  otherId: string; otherName: string; otherRole: string; onBack: () => void;
}) {
  const me = useAuth(s => s.user);
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const q = useQuery<{ messages: Message[] }>({
    queryKey: ['chat-thread', otherId],
    queryFn: async () => (await axios.get(`${BASE}/chat/with/${otherId}`, {
      withCredentials: true, headers: headers(),
    })).data,
    refetchInterval: 30_000,
  });
  const messages = q.data?.messages ?? [];

  // Backend auto-mark read tiap fetch thread, tapi unread-count + convos
  // query tidak refetch otomatis (SSE 'chat.message' cuma fire untuk
  // pesan baru, bukan read). Invalidate manual supaya badge nav refresh.
  useEffect(() => {
    if (!q.dataUpdatedAt) return;
    void qc.invalidateQueries({ queryKey: ['chat-unread-count'] });
    void qc.invalidateQueries({ queryKey: ['chat-convos'] });
  }, [q.dataUpdatedAt, qc]);

  // Auto-scroll bottom saat pesan baru muncul.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  // Auto-resize textarea (max-height clamp via CSS).
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);

  // Group messages by date untuk render date separator.
  const grouped = useMemo(() => {
    const out: Array<{ kind: 'date'; key: string; label: string } | { kind: 'msg'; key: string; m: Message }> = [];
    let lastDay = '';
    for (const m of messages) {
      const d = new Date(m.createdAt);
      const dayKey = d.toDateString();
      if (dayKey !== lastDay) {
        out.push({ kind: 'date', key: `d-${dayKey}`, label: fmtRelativeDay(m.createdAt) });
        lastDay = dayKey;
      }
      out.push({ kind: 'msg', key: m.id, m });
    }
    return out;
  }, [messages]);

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

  // Enter kirim, Shift+Enter baris baru.
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit(e as unknown as FormEvent);
    }
  };

  return (
    <div className="chat-thread">
      <div className="chat-thread-head">
        <button type="button" className="chat-thread-back" onClick={onBack} aria-label="Kembali ke daftar">
          <Ic.arrowLeft size={18} aria-hidden="true" />
        </button>
        <Avatar inisial={otherName.slice(0, 2).toUpperCase()} hue={162} size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="chat-thread-name">{otherName}</div>
          <div className="chat-thread-sub">{otherRole}</div>
        </div>
      </div>
      <div ref={scrollRef} className="chat-thread-body">
        {grouped.length === 0
          ? (
            <div className="chat-bubble-empty">
              <Ic.send size={28} aria-hidden="true" />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-2)' }}>Belum ada pesan</div>
              <div style={{ fontSize: 12.5 }}>Mulai dengan menyapa.</div>
            </div>
          )
          : grouped.map(item => {
            if (item.kind === 'date') {
              return <div key={item.key} className="chat-date-sep">{item.label}</div>;
            }
            const mine = item.m.fromId === me?.id;
            return (
              <div key={item.key}
                className={'chat-bubble ' + (mine ? 'chat-bubble-mine' : 'chat-bubble-theirs')}>
                {item.m.body}
                <div className="chat-bubble-meta">
                  <span>{fmtTime(item.m.createdAt)}</span>
                  {mine && (
                    item.m.readAt
                      ? <Ic.checkCircle size={11} aria-label="Sudah dibaca" />
                      : <Ic.check size={11} aria-label="Terkirim" />
                  )}
                </div>
              </div>
            );
          })}
      </div>
      <form onSubmit={submit} className="chat-composer">
        <textarea ref={textareaRef} value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ketik pesan… (Enter kirim · Shift+Enter baris baru)"
          maxLength={2000}
          rows={1} />
        <button type="submit" className="chat-send"
          disabled={!text.trim() || sending}
          aria-label="Kirim pesan">
          <Ic.send size={16} aria-hidden="true" />
        </button>
      </form>
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
          <div style={{ fontWeight: 800, fontSize: 16 }}>Mulai Chat Baru</div>
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
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{u.nama}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
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
