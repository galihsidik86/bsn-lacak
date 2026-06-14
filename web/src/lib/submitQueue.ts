// Offline-tolerant submit queue for kunjungan laporan. When MLapor can't
// reach the server (network error / offline), the form payload + photo blobs
// land here and a background drainer retries them on every 'online' event,
// visibilitychange to visible, or periodic tick.

const DB_NAME = 'bsn_lacak_outbox';
const STORE = 'kunjungan';

interface StoredFile { name: string; type: string; blob: Blob }

export interface QueuedKunjungan {
  id: string;          // uuid for this queued item
  enqueuedAt: number;
  args: {
    nasabah: string;
    petugas: string;
    hasil: string;
    nominal: number;
    catatan: string;
    lokasi: string;
    lat?: number;
    lng?: number;
  };
  photos: StoredFile[];
  attempts: number;
  lastError?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise(async (resolve, reject) => {
    let db: IDBDatabase;
    try { db = await open(); } catch (e) { return reject(e); }
    const t = db.transaction(STORE, mode);
    let last: IDBRequest<T> | undefined;
    const r = fn(t.objectStore(STORE));
    if (r) last = r;
    t.oncomplete = () => { db.close(); resolve(last?.result as T | undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

function genId(): string {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
}

export async function enqueue(args: QueuedKunjungan['args'], files: File[]): Promise<string> {
  const item: QueuedKunjungan = {
    id: genId(),
    enqueuedAt: Date.now(),
    args,
    photos: files.map(f => ({ name: f.name, type: f.type, blob: f })),
    attempts: 0,
  };
  await tx('readwrite', s => s.put(item));
  return item.id;
}

export async function list(): Promise<QueuedKunjungan[]> {
  return new Promise(async (resolve, reject) => {
    let db: IDBDatabase;
    try { db = await open(); } catch (e) { return reject(e); }
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).getAll();
    t.oncomplete = () => { db.close(); resolve((req.result as QueuedKunjungan[]) ?? []); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function remove(id: string): Promise<void> {
  await tx('readwrite', s => s.delete(id));
}

export async function recordFailure(item: QueuedKunjungan, err: string): Promise<void> {
  await tx('readwrite', s => s.put({ ...item, attempts: item.attempts + 1, lastError: err }));
}

export function toFiles(stored: StoredFile[]): File[] {
  return stored.map(s => new File([s.blob], s.name, { type: s.type }));
}
