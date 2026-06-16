import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from './Icons';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface FilterRow { id: string; screen: string; name: string; payload: any }

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function list(screen: string): Promise<FilterRow[]> {
  return (await axios.get(`${BASE}/saved-filters`, {
    params: { screen }, withCredentials: true, headers: authHeaders(),
  })).data;
}

async function create(screen: string, name: string, payload: any): Promise<FilterRow> {
  return (await axios.post(`${BASE}/saved-filters`, { screen, name, payload }, {
    withCredentials: true, headers: authHeaders(),
  })).data;
}

async function remove(id: string): Promise<void> {
  await axios.delete(`${BASE}/saved-filters/${id}`, {
    withCredentials: true, headers: authHeaders(),
  });
}

// Generic preset chrome — drops into any filter-bearing screen. Caller
// hands us the current filter state via `currentPayload`, the slug of the
// screen, and a setter to receive a payload when a saved entry is loaded.
export function SavedFilters<T>({ screen, currentPayload, onLoad }: {
  screen: string;
  currentPayload: T;
  onLoad: (payload: T) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['saved-filters', screen], queryFn: () => list(screen) });
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const createMut = useMutation({
    mutationFn: () => create(screen, name.trim(), currentPayload),
    onSuccess: () => {
      setNaming(false); setName('');
      qc.invalidateQueries({ queryKey: ['saved-filters', screen] });
    },
  });
  const delMut = useMutation({
    mutationFn: remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-filters', screen] }),
  });

  const rows = q.data ?? [];

  return (
    <div className="center gap-2" style={{ flexWrap: 'wrap' }}>
      {rows.map(r => (
        <span key={r.id} className="chip" style={{ paddingRight: 4, gap: 6 }}>
          <button onClick={() => onLoad(r.payload as T)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'inherit' }}>
            {r.name}
          </button>
          <button onClick={() => { if (window.confirm(`Hapus preset "${r.name}"?`)) delMut.mutate(r.id); }}
            aria-label={`Hapus ${r.name}`}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
              color: 'var(--ink-3)', display: 'grid', placeItems: 'center',
            }}>
            <Ic.x size={11} />
          </button>
        </span>
      ))}
      {naming ? (
        <div className="center gap-1">
          <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="Nama preset…" maxLength={120}
            onKeyDown={e => {
              if (e.key === 'Enter' && name.trim()) createMut.mutate();
              if (e.key === 'Escape') { setNaming(false); setName(''); }
            }}
            style={{ width: 180, padding: '6px 10px', fontSize: 12 }} />
          <button className="btn btn-sm" disabled={!name.trim() || createMut.isPending}
            onClick={() => createMut.mutate()}>
            <Ic.checkCircle size={12} />Simpan
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setNaming(false); setName(''); }}>
            <Ic.x size={12} />
          </button>
        </div>
      ) : (
        <button className="btn btn-sm btn-ghost" onClick={() => setNaming(true)}>
          <Ic.plus size={12} />Simpan filter
        </button>
      )}
    </div>
  );
}
