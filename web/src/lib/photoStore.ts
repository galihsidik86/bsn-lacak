// Persist in-progress kunjungan photos to IndexedDB so that an Android camera
// intent that kills the browser tab doesn't take the captured photos with
// it. Stores raw File blobs keyed by nasabah id; cleared on submit or
// explicit cancel.

const DB_NAME = 'bsn_lacak_drafts';
const STORE = 'photos';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredFile { name: string; type: string; blob: Blob }

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise(async (resolve, reject) => {
    let db: IDBDatabase;
    try { db = await open(); } catch (e) { return reject(e); }
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result as T); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

export async function savePhotos(key: string, files: File[]): Promise<void> {
  const stored: StoredFile[] = files.map(f => ({ name: f.name, type: f.type, blob: f }));
  await tx('readwrite', s => s.put(stored, key));
}

export async function loadPhotos(key: string): Promise<File[]> {
  try {
    const raw = await tx<StoredFile[] | undefined>('readonly', s => s.get(key));
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map(f => new File([f.blob], f.name, { type: f.type }));
  } catch {
    return [];
  }
}

export async function clearPhotos(key: string): Promise<void> {
  try { await tx('readwrite', s => s.delete(key)); } catch { /* ignore */ }
}
