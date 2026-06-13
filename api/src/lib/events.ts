// Tiny in-memory pub/sub for SSE. Each subscriber gets every event whose
// topic they're listening for. Replace with Redis pub/sub when the API is
// scaled to multiple instances — the interface stays the same.

import { randomUUID } from 'node:crypto';

export type EventTopic =
  | 'petugas.position'      // { petugasId, lat, lng, ts }
  | 'kunjungan.created'     // { kunjunganId, petugasId, nasabahId, hasil }
  | 'nasabah.reassign'      // { nasabahId, from, to }
  | 'blast.completed'       // { blastId, terkirim, gagal }
  | 'notification.new';     // { id, type, title, body, severity }

export interface BsnEvent {
  id: string;
  topic: EventTopic;
  data: Record<string, unknown>;
  // For per-user notifications. Empty array = broadcast to all.
  userIds?: string[];
  ts: number;
}

type Listener = (ev: BsnEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(topic: EventTopic, data: Record<string, unknown>, userIds?: string[]) {
    const ev: BsnEvent = { id: randomUUID(), topic, data, userIds, ts: Date.now() };
    // Snapshot to avoid mutation during iteration when a listener unsubscribes.
    [...this.listeners].forEach(fn => {
      try { fn(ev); } catch { /* never let one bad listener kill the rest */ }
    });
    return ev;
  }

  get size() { return this.listeners.size; }
}

export const bus = new EventBus();
