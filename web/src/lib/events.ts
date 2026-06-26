// SSE client. Lives at module scope so React StrictMode double-mounts don't
// spawn duplicate connections.

import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

type EventTopic =
  | 'ready'
  | 'petugas.position'
  | 'kunjungan.created'
  | 'kunjungan.reviewed'
  | 'nasabah.reassign'
  | 'blast.completed'
  | 'notification.new'
  | 'chat.message';

type Handler = (data: any) => void;
const handlers = new Map<EventTopic, Set<Handler>>();
let es: EventSource | null = null;
let connectInflight: Promise<void> | null = null;

function dispatch(topic: EventTopic, data: any) {
  handlers.get(topic)?.forEach(fn => { try { fn(data); } catch { /* ignore */ } });
}

async function connect(): Promise<void> {
  if (USE_MOCK) return;
  if (es) return;
  if (connectInflight) return connectInflight;

  connectInflight = (async () => {
    const token = tokenStore.get();
    if (!token) return;

    // BASE is "/api" → result "/api/events?token=..."
    const url = `${BASE}/events?token=${encodeURIComponent(token)}`;
    es = new EventSource(url);

    const topics: EventTopic[] = [
      'ready', 'petugas.position', 'kunjungan.created', 'kunjungan.reviewed',
      'nasabah.reassign', 'blast.completed', 'notification.new', 'chat.message',
    ];
    for (const t of topics) {
      es.addEventListener(t, (ev) => {
        try { dispatch(t, JSON.parse((ev as MessageEvent).data)); }
        catch { /* ignore malformed */ }
      });
    }

    es.onerror = () => {
      // Browser will auto-reconnect; if it gives up (e.g. 401), tear down and
      // let the next call rebuild — most often after a fresh access token.
      es?.close();
      es = null;
    };

    connectInflight = null;
  })();
  return connectInflight;
}

export function subscribe<T = any>(topic: EventTopic, fn: (d: T) => void): () => void {
  let set = handlers.get(topic);
  if (!set) { set = new Set(); handlers.set(topic, set); }
  set.add(fn as Handler);
  // Lazy-connect on first subscriber so we don't open a stream pre-login.
  connect().catch(() => undefined);
  return () => { set!.delete(fn as Handler); };
}

export function reconnect() {
  if (es) { es.close(); es = null; }
  return connect();
}

export function disconnect() {
  if (es) { es.close(); es = null; }
  handlers.clear();
}
