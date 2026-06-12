import axios from 'axios';
import * as mock from '../data/mock';
import type {
  Akad,
  BlastEntry,
  HasilKunjungan,
  KolKey,
  Kunjungan,
  Nasabah,
  PayflowPoint,
  Petugas,
  PetugasStatus,
} from '../types';

// ---- Server → Frontend normalizers ----
// Prisma enums (UPPERCASE) + BigInt strings + relational id-suffix fields don't
// match the shapes the screens expect (lowercase, numbers, friendly names).
// One translation layer here keeps the screens untouched.

const STATUS_MAP: Record<string, PetugasStatus> = {
  LAPANGAN: 'lapangan', ISTIRAHAT: 'istirahat', KANTOR: 'kantor',
};
const KOL_MAP: Record<string, KolKey> = { K1: 1, K2: 2, K3: 3, K4: 4, K5: 5 };
const AKAD_MAP: Record<string, Akad> = {
  MURABAHAH: 'Murabahah',
  MUSYARAKAH: 'Musyarakah',
  IJARAH: 'Ijarah',
  MUSYARAKAH_MUTANAQISAH: 'Musyarakah Mutanaqisah',
  ISTISHNA: 'Istishna',
};
const HASIL_MAP: Record<string, HasilKunjungan> = {
  BAYAR: 'bayar', JANJI: 'janji', TIDAKADA: 'tidakada', TOLAK: 'tolak',
};

// Deterministic hue per id so avatars stay consistent across renders.
function hueOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function n(x: unknown, d = 0): number {
  return typeof x === 'number' ? x : typeof x === 'string' ? Number(x) || d : d;
}

function petugasFromServer(p: any): Petugas {
  return {
    id: p.id,
    nama: p.nama,
    inisial: p.inisial ?? p.nama?.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase(),
    wilayah: p.wilayah,
    status: STATUS_MAP[p.status] ?? 'kantor',
    hp: p.hp,
    target: n(p.target),
    // These aren't on the schema yet — default to 0 so the dashboard renders.
    terkumpul: n(p.terkumpul),
    kunjungan: n(p.kunjungan),
    rencana: n(p.rencana),
    hue: typeof p.hue === 'number' ? p.hue : hueOf(p.id),
    posisi: p.posisi ?? { x: 0.5, y: 0.5 },
    mulai: p.mulai ?? '—',
    terakhir: p.terakhir ?? '—',
  };
}

function nasabahFromServer(x: any): Nasabah {
  return {
    id: x.id,
    nama: x.nama,
    alamat: x.alamat,
    hp: x.hp,
    petugas: x.petugasId,
    kol: KOL_MAP[x.kol] ?? 1,
    akad: AKAD_MAP[x.akad] ?? 'Murabahah',
    plafon: n(x.plafon),
    tenor: x.tenor,
    angsuran: n(x.angsuran),
    sisa: n(x.sisa),
    dpd: x.dpd ?? 0,
    dueIn: x.dueIn ?? 0,
    lastBayar: x.lastBayar ?? '—',
  };
}

function kunjunganFromServer(x: any): Kunjungan {
  return {
    id: x.id,
    petugas: x.petugasId,
    nasabah: x.nasabahId,
    jam: x.jam ?? '—',
    hasil: HASIL_MAP[x.hasil] ?? 'bayar',
    nominal: n(x.nominal),
    dpd: x.nasabah?.dpd ?? 0,
    catatan: x.catatan ?? '',
    lokasi: x.lokasi ?? '',
    foto: Array.isArray(x.fotos) ? x.fotos.length : 0,
    valid: x.valid ?? true,
  };
}

function blastFromServer(x: any): BlastEntry {
  return {
    id: x.id,
    judul: x.judul,
    kanal: String(x.kanal).toLowerCase() as 'wa' | 'sms',
    target: x.target,
    terkirim: x.terkirim,
    dibaca: x.dibaca,
    tgl: x.scheduledAt ?? x.createdAt ?? '',
    status: String(x.status).toLowerCase() === 'terjadwal' ? 'terjadwal' : 'selesai',
  };
}

const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';
const BASE = import.meta.env.VITE_API_URL || '/api';

// Module-scope memory only — never localStorage / sessionStorage.
// XSS can read storage but cannot read module-scope JS, so this raises the bar.
// Trade-off: lost on full page refresh (user must re-login). Acceptable for
// banking context; refresh-token flow can re-establish session silently later.
let _token: string | null = null;
export const tokenStore = {
  get: () => _token,
  set: (t: string | null) => { _token = t; },
  clear: () => { _token = null; },
};

const http = axios.create({
  baseURL: BASE,
  withCredentials: true,
});

http.interceptors.request.use((cfg) => {
  if (_token) cfg.headers.Authorization = `Bearer ${_token}`;
  return cfg;
});

// Single-flight refresh: if multiple requests 401 concurrently, share one /refresh.
let refreshInflight: Promise<string | null> | null = null;

async function refresh(): Promise<string | null> {
  if (USE_MOCK) return null;
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    try {
      const r = await axios.post(`${BASE}/auth/refresh`, {}, { withCredentials: true });
      const tok = r.data?.token ?? null;
      _token = tok;
      return tok;
    } catch {
      _token = null;
      return null;
    } finally {
      refreshInflight = null;
    }
  })();
  return refreshInflight;
}

http.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err?.config;
    const status = err?.response?.status;
    const url: string = cfg?.url ?? '';
    // Don't refresh-loop on the refresh endpoint itself.
    if (status === 401 && cfg && !cfg.__retried && !url.includes('/auth/refresh') && !url.includes('/auth/login')) {
      cfg.__retried = true;
      const tok = await refresh();
      if (tok) {
        cfg.headers.Authorization = `Bearer ${tok}`;
        return http.request(cfg);
      }
      window.dispatchEvent(new CustomEvent('bsn:unauthenticated'));
    } else if (status === 401) {
      _token = null;
      window.dispatchEvent(new CustomEvent('bsn:unauthenticated'));
    }
    return Promise.reject(err);
  },
);

// Call on app start to recover a session from the refresh cookie.
export async function bootstrapSession(): Promise<boolean> {
  if (USE_MOCK) return false;
  const tok = await refresh();
  return !!tok;
}

interface Api {
  listPetugas(): Promise<Petugas[]>;
  listNasabah(): Promise<Nasabah[]>;
  listKunjungan(): Promise<Kunjungan[]>;
  listBlast(): Promise<BlastEntry[]>;
  payflow(): Promise<PayflowPoint[]>;
  reassign(nasabahId: string, petugasId: string): Promise<void>;
  sendBlast(args: { segment: string; channel: 'wa' | 'sms'; template: string; recipientIds: string[] }): Promise<{ jobId: string }>;
  createKunjungan(args: Partial<Kunjungan> & { photos: File[] }): Promise<Kunjungan>;
}

export const api: Api = USE_MOCK
  ? {
      async listPetugas() { return mock.PETUGAS; },
      async listNasabah() { return mock.NASABAH; },
      async listKunjungan() { return mock.KUNJUNGAN; },
      async listBlast() { return mock.BLAST_HISTORY; },
      async payflow() { return mock.PAYFLOW; },
      async reassign() { /* noop in mock */ },
      async sendBlast() { return { jobId: 'mock-' + Date.now() }; },
      async createKunjungan(args) {
        return {
          id: 'K' + Date.now(),
          petugas: args.petugas ?? 'P1',
          nasabah: args.nasabah ?? '',
          jam: new Date().toTimeString().slice(0, 5),
          hasil: args.hasil ?? 'bayar',
          nominal: args.nominal ?? 0,
          dpd: args.dpd ?? 0,
          catatan: args.catatan ?? '',
          lokasi: args.lokasi ?? '',
          foto: args.photos?.length ?? 0,
          valid: true,
        };
      },
    }
  : {
      async listPetugas() { return ((await http.get('/petugas')).data as any[]).map(petugasFromServer); },
      async listNasabah() { return ((await http.get('/nasabah')).data as any[]).map(nasabahFromServer); },
      async listKunjungan() { return ((await http.get('/kunjungan')).data as any[]).map(kunjunganFromServer); },
      async listBlast() { return ((await http.get('/blast')).data as any[]).map(blastFromServer); },
      async payflow() { return (await http.get('/angsuran/payflow')).data; },
      async reassign(nasabahId, petugasId) {
        await http.patch(`/nasabah/${nasabahId}/petugas`, { petugasId });
      },
      async sendBlast(args) { return (await http.post('/blast', args)).data; },
      async createKunjungan(args) {
        const fd = new FormData();
        Object.entries(args).forEach(([k, v]) => {
          if (k === 'photos' && Array.isArray(v)) v.forEach((f: File) => fd.append('photos', f));
          else if (v != null) fd.append(k, String(v));
        });
        return (await http.post('/kunjungan', fd)).data;
      },
    };

export async function login(username: string, password: string): Promise<{ token: string; role: 'supervisor' | 'petugas' }> {
  if (USE_MOCK) {
    const token = 'mock.' + btoa(JSON.stringify({ u: username, t: Date.now() }));
    tokenStore.set(token);
    return { token, role: username === 'petugas' ? 'petugas' : 'supervisor' };
  }
  const { data } = await http.post('/auth/login', { username, password });
  tokenStore.set(data.token);
  return data;
}

export async function logout() {
  try { if (!USE_MOCK) await http.post('/auth/logout'); } catch { /* ignore */ }
  tokenStore.clear();
}
