// Mobile chat overlay untuk petugas — full-screen mengganti seluruh shell
// Mobile saat chat aktif. Reuse backend /api/chat/* dari supervisor chat,
// tapi layout single-column tanpa sidebar (mobile-first). Petugas biasanya
// cuma chat dengan supervisor cabang masing-masing; auto-open thread saat
// hanya ada 1 conversation.

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
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return 'Hari Ini';
  if (diff === 1) return 'Kemarin';
  if (diff < 7) return d.toLocaleDateString('id-ID', { weekday: 'long' });
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: today.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
}
function fmtRowTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return fmtTime(iso);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 1) return 'Kemarin';
  if (diff < 7) return d.toLocaleDateString('id-ID', { weekday: 'short' });
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

export function MobileChat({ onClose }: { onClose: () => void }) {
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

  // SSE realtime — sama dengan ScreenChat supervisor.
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

  const convos = convosQ.data?.conversations ?? [];

  // Auto-open thread kalau cuma 1 conversation — petugas biasanya
  // chat hanya dengan supervisor, jadi inbox screen 1-item adalah
  // friction yang tidak perlu.
  useEffect(() => {
    if (!active && convos.length === 1) setActive(convos[0]);
  }, [active, convos]);

  if (active) {
    return (
      <MobileChatThread
        otherId={active.otherId}
        otherName={active.other.nama}
        otherRole={active.other.role}
        onBack={() => {
          // Kalau cuma 1 conversation, back langsung tutup overlay
          // (skip inbox 1-item supaya UX tidak bolak-balik).
          if (convos.length <= 1) onClose();
          else setActive(null);
        }}
      />
    );
  }

  return (
    <div className="m-chat-shell">
      <header className="m-chat-head">
        <button type="button" className="m-chat-back" onClick={onClose} aria-label="Tutup chat">
          <Ic.arrowLeft size={20} />
        </button>
        <div className="m-chat-head-title">Pesan</div>
        <button type="button" className="m-chat-newbtn" onClick={() => setPickerOpen(true)} aria-label="Mulai chat baru">
          <Ic.plus size={18} />
        </button>
      </header>
      <div className="m-chat-list">
        {convosQ.isPending && <div style={{ padding: 16 }}><Skeleton h={300} /></div>}
        {convosQ.isError && <div style={{ padding: 16 }}><ErrorState onRetry={() => convosQ.refetch()} /></div>}
        {!convosQ.isPending && !convosQ.isError && convos.length === 0 && (
          <div className="m-chat-empty">
            <div className="m-chat-empty-ic"><Ic.sms size={36} aria-hidden="true" /></div>
            <div className="m-chat-empty-title">Belum ada pesan</div>
            <div className="m-chat-empty-body">
              Tap tombol + di pojok kanan atas untuk memulai chat dengan supervisor.
            </div>
            <button type="button" className="m-chat-start-btn" onClick={() => setPickerOpen(true)}>
              <Ic.plus size={14} />Mulai chat baru
            </button>
          </div>
        )}
        {convos.map(c => (
          <button key={c.otherId} type="button"
            onClick={() => setActive(c)}
            className={'m-chat-row' + (c.unread > 0 ? ' has-unread' : '')}>
            <Avatar inisial={c.other.nama.slice(0, 2).toUpperCase()} hue={162} size={46} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="between" style={{ gap: 6 }}>
                <span className="m-chat-row-name">{c.other.nama}</span>
                <span className="m-chat-row-time">{fmtRowTime(c.lastAt)}</span>
              </div>
              <div className="between" style={{ gap: 6, marginTop: 2 }}>
                <span className="m-chat-row-preview">{c.lastBody}</span>
                {c.unread > 0 && <span className="m-chat-row-unread num">{c.unread}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
      {pickerOpen && (
        <MobileRecipientPicker
          onClose={() => setPickerOpen(false)}
          onPick={(u) => {
            setPickerOpen(false);
            setActive({
              otherId: u.id,
              other: { id: u.id, nama: u.nama, username: u.username, role: u.role },
              lastBody: '', lastAt: new Date().toISOString(), unread: 0,
            });
          }}
        />
      )}
    </div>
  );
}

function MobileChatThread({ otherId, otherName, otherRole, onBack }: {
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);

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

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit(e as unknown as FormEvent);
    }
  };

  return (
    <div className="m-chat-shell">
      <header className="m-chat-head">
        <button type="button" className="m-chat-back" onClick={onBack} aria-label="Kembali">
          <Ic.arrowLeft size={20} />
        </button>
        <Avatar inisial={otherName.slice(0, 2).toUpperCase()} hue={162} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="m-chat-thread-name">{otherName}</div>
          <div className="m-chat-thread-sub">{otherRole}</div>
        </div>
      </header>
      <div ref={scrollRef} className="m-chat-body">
        {grouped.length === 0
          ? (
            <div className="m-chat-thread-empty">
              <Ic.send size={28} aria-hidden="true" />
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-2)' }}>Belum ada pesan</div>
              <div style={{ fontSize: 12.5 }}>Mulai dengan menyapa supervisor.</div>
            </div>
          )
          : grouped.map(item => {
            if (item.kind === 'date') {
              return <div key={item.key} className="m-chat-date-sep">{item.label}</div>;
            }
            const mine = item.m.fromId === me?.id;
            return (
              <div key={item.key}
                className={'m-chat-bubble ' + (mine ? 'm-chat-bubble-mine' : 'm-chat-bubble-theirs')}>
                {item.m.body}
                <div className="m-chat-bubble-meta">
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
      <form onSubmit={submit} className="m-chat-composer">
        <textarea ref={textareaRef} value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ketik pesan…"
          maxLength={2000}
          rows={1} />
        <button type="submit" className="m-chat-send"
          disabled={!text.trim() || sending}
          aria-label="Kirim pesan">
          <Ic.send size={16} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

function MobileRecipientPicker({ onClose, onPick }: { onClose: () => void; onPick: (u: Recipient) => void }) {
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
    <div className="m-chat-shell" style={{ zIndex: 60 }}>
      <header className="m-chat-head">
        <button type="button" className="m-chat-back" onClick={onClose} aria-label="Batal">
          <Ic.arrowLeft size={20} />
        </button>
        <div className="m-chat-head-title">Pilih supervisor</div>
        <div style={{ width: 36 }} />
      </header>
      <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
        <div className="search">
          <Ic.search size={16} />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Cari nama atau username…" autoFocus />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {recQ.isPending ? <div style={{ padding: 16 }}><Skeleton h={200} /></div>
          : recQ.isError ? <div style={{ padding: 16 }}><ErrorState onRetry={() => recQ.refetch()} /></div>
          : filtered.length === 0
            ? <EmptyState title="Tidak ada user yang cocok"
                hint={q.trim() ? `Tidak ada hasil untuk "${q}".` : 'Belum ada supervisor yang bisa dichat.'} />
            : filtered.map(u => (
              <button key={u.id} type="button" onClick={() => onPick(u)}
                className="m-chat-rec-row">
                <Avatar inisial={u.nama.slice(0, 2).toUpperCase()} hue={162} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{u.nama}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {u.role}{u.branch ? ` · ${u.branch.kode}` : ''}
                  </div>
                </div>
                <Ic.arrowRight size={16} style={{ color: 'var(--ink-4)' }} />
              </button>
            ))}
      </div>
    </div>
  );
}

// FAB chat — tombol bulat di pojok kanan bawah MBeranda. Tap → buka
// overlay MobileChat. Badge merah muncul kalau ada unread.
export function MobileChatFab({ onClick, unread }: { onClick: () => void; unread: number }) {
  return (
    <button type="button" className="m-fab-chat" onClick={onClick} aria-label={`Pesan${unread > 0 ? ` (${unread} belum dibaca)` : ''}`}>
      <Ic.sms size={22} aria-hidden="true" />
      {unread > 0 && (
        <span className="m-fab-chat-badge num" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
      )}
    </button>
  );
}
