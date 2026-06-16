import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Ic, type IconKey } from './Icons';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface NasabahHit { id: string; kode: string; nama: string; alamat: string; active: boolean }
interface PetugasHit { id: string; kode: string; nama: string; wilayah: string; active: boolean }
interface KunjunganHit {
  id: string;
  catatan: string;
  lokasi: string;
  tanggal: string;
  jam: string;
  nasabah: { kode: string; nama: string };
  petugas: { kode: string; nama: string };
}
interface BlastHit { id: string; judul: string; status: string; kanal: string; createdAt: string }
interface WilayahHit { id: string; nama: string }

interface SearchResponse {
  nasabah: NasabahHit[];
  petugas: PetugasHit[];
  kunjungan: KunjunganHit[];
  blast: BlastHit[];
  wilayah: WilayahHit[];
  totalHits: number;
}

interface Item {
  id: string;
  group: string;
  icon: IconKey;
  primary: string;
  secondary?: string;
  hint?: string;
  page: string;
}

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

async function search(q: string): Promise<SearchResponse> {
  return (await axios.get(`${BASE}/search`, {
    params: { q, limit: 6 },
    withCredentials: true, headers: headers(),
  })).data;
}

// Maps each group to the screen the user lands on. We don't deep-link to
// a specific row because most screens already filter by query — keeping
// it simple avoids per-screen routing knowledge.
function flatten(r: SearchResponse): Item[] {
  return [
    ...r.nasabah.map(n => ({
      id: 'n:' + n.id, group: 'Nasabah', icon: 'users' as IconKey,
      primary: `${n.kode} · ${n.nama}`,
      secondary: n.alamat,
      hint: n.active ? undefined : 'inactive',
      page: 'nasabah',
    })),
    ...r.petugas.map(p => ({
      id: 'p:' + p.id, group: 'Petugas', icon: 'user' as IconKey,
      primary: `${p.kode} · ${p.nama}`,
      secondary: p.wilayah,
      hint: p.active ? undefined : 'inactive',
      page: 'petugas',
    })),
    ...r.kunjungan.map(k => ({
      id: 'k:' + k.id, group: 'Kunjungan', icon: 'clipboard' as IconKey,
      primary: `${k.nasabah.nama} · ${new Date(k.tanggal).toLocaleDateString('id-ID')}`,
      secondary: k.lokasi || k.catatan,
      hint: `oleh ${k.petugas.kode}`,
      page: 'laporan',
    })),
    ...r.blast.map(b => ({
      id: 'b:' + b.id, group: 'Blast', icon: 'send' as IconKey,
      primary: b.judul,
      secondary: `${b.kanal} · ${b.status.toLowerCase()}`,
      hint: new Date(b.createdAt).toLocaleDateString('id-ID'),
      page: 'blast',
    })),
    ...r.wilayah.map(w => ({
      id: 'w:' + w.id, group: 'Wilayah', icon: 'map' as IconKey,
      primary: w.nama,
      page: 'wilayah',
    })),
  ];
}

export function GlobalSearchModal({ open, onClose, onNavigate }: {
  open: boolean; onClose: () => void; onNavigate: (page: string) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const debounced = useDebounced(q, 200);
  const query = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const items: Item[] = useMemo(() => query.data ? flatten(query.data) : [], [query.data]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else { setQ(''); setActive(0); }
  }, [open]);

  useEffect(() => { setActive(0); }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
      else if (e.key === 'Enter' && items[active]) { onNavigate(items[active].page); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, active, onClose, onNavigate]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Pencarian global"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 90,
        display: 'grid', placeItems: 'start center', padding: '12vh 16px 16px',
      }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 14, width: '100%', maxWidth: 640,
          boxShadow: 'var(--sh-3)', border: '1px solid var(--line)', overflow: 'hidden',
        }}>
        <div className="center gap-3" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <Ic.search size={18} style={{ color: 'var(--ink-3)' }} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Cari nasabah, petugas, kunjungan, blast, wilayah…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 500, color: 'var(--ink)',
            }} />
          <kbd style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
            background: 'var(--surface-2)', color: 'var(--ink-3)', border: '1px solid var(--line)',
          }}>Esc</kbd>
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {debounced.length < 2 ? (
            <Hint>Ketik minimal 2 huruf untuk mulai mencari.</Hint>
          ) : query.isPending ? (
            <Hint>Mencari…</Hint>
          ) : items.length === 0 ? (
            <Hint>Tidak ada hasil untuk "{debounced}".</Hint>
          ) : (
            <Groups items={items} active={active} setActive={setActive}
              onSelect={(p) => { onNavigate(p); onClose(); }} />
          )}
        </div>

        <div className="between" style={{
          padding: '8px 16px', borderTop: '1px solid var(--line)',
          fontSize: 11, color: 'var(--ink-3)',
        }}>
          <span><kbd>↑↓</kbd> navigasi · <kbd>↵</kbd> buka</span>
          <span>{query.data?.totalHits ?? 0} hits</span>
        </div>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="muted" style={{ padding: 24, textAlign: 'center', fontSize: 13 }}>
      {children}
    </div>
  );
}

function Groups({ items, active, setActive, onSelect }: {
  items: Item[]; active: number; setActive: (i: number) => void; onSelect: (page: string) => void;
}) {
  // Group items by group name preserving the discovery order from flatten().
  const groups: { name: string; entries: { item: Item; idx: number }[] }[] = [];
  items.forEach((item, idx) => {
    const last = groups[groups.length - 1];
    if (!last || last.name !== item.group) groups.push({ name: item.group, entries: [] });
    groups[groups.length - 1].entries.push({ item, idx });
  });

  return (
    <div>
      {groups.map(g => (
        <div key={g.name}>
          <div style={{
            padding: '8px 16px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase',
            color: 'var(--ink-3)', letterSpacing: '.06em',
            background: 'var(--surface-2)', borderBottom: '1px solid var(--line)',
          }}>{g.name}</div>
          {g.entries.map(({ item, idx }) => {
            const Icon = Ic[item.icon];
            const isActive = active === idx;
            return (
              <button key={item.id}
                onMouseEnter={() => setActive(idx)}
                onClick={() => onSelect(item.page)}
                className="center gap-3"
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 16px',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer',
                }}>
                <div className="stat-ic" style={{
                  width: 30, height: 30, flex: 'none',
                  background: isActive ? 'var(--accent)' : 'var(--surface-2)',
                  color: isActive ? 'white' : 'var(--ink-3)',
                }}>
                  <Icon size={15} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.primary}
                  </div>
                  {item.secondary && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.secondary}
                    </div>
                  )}
                </div>
                {item.hint && (
                  <span className="muted" style={{ fontSize: 11, flex: 'none' }}>{item.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
