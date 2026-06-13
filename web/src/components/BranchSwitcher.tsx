import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from './Icons';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface BranchOption {
  id: string;
  kode: string;
  nama: string;
  active: boolean;
}

async function listBranches(): Promise<BranchOption[]> {
  const tok = tokenStore.get();
  const r = await axios.get(`${BASE}/branches`, {
    withCredentials: true,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });
  return r.data;
}

// Topbar dropdown — visible only for ADMINs. When selected, sets a global
// branchOverride that the API client mirrors onto x-branch-id, then nukes
// the React Query cache so every dependent screen re-fetches in scope.
export function BranchSwitcher() {
  const role = useAuth(s => s.user?.role);
  const override = useAuth(s => s.branchOverride);
  const setOverride = useAuth(s => s.setBranchOverride);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const branchesQ = useQuery({
    queryKey: ['branches'],
    queryFn: listBranches,
    enabled: role === 'ADMIN',
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (role !== 'ADMIN') return null;
  const active = branchesQ.data?.find(b => b.id === override) ?? null;

  const pick = (id: string | null) => {
    setOverride(id);
    setOpen(false);
    // Everything tenant-scoped needs to refetch under the new scope.
    qc.invalidateQueries();
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="chip"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={active ? `Cabang aktif ${active.nama}` : 'Semua Cabang — pilih cabang'}
        style={{
          background: active ? 'var(--accent-soft)' : 'var(--gold-soft)',
          color: active ? 'var(--accent-ink)' : 'var(--gold-ink)',
          cursor: 'pointer', userSelect: 'none',
        }}>
        <Ic.layers size={13} aria-hidden="true" />
        {active ? active.nama : 'Semua Cabang'}
        <Ic.arrowDown size={12} aria-hidden="true" style={{ marginLeft: 2 }} />
      </button>

      {open && (
        <div role="listbox" style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 8, zIndex: 50,
          width: 280, maxHeight: 360, overflow: 'auto',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14,
          boxShadow: 'var(--sh-3)',
        }}>
          <button onClick={() => pick(null)} role="option" aria-selected={!override}
            style={{
              display: 'flex', gap: 11, padding: '12px 14px', width: '100%',
              textAlign: 'left', border: 'none', cursor: 'pointer',
              background: !override ? 'var(--accent-soft)' : 'transparent',
              borderBottom: '1px solid var(--line)',
            }}>
            <Ic.layers size={16} style={{ color: 'var(--gold-ink)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Semua Cabang</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>Tidak ada batasan cabang</div>
            </div>
            {!override && <Ic.check size={16} style={{ color: 'var(--accent)' }} />}
          </button>
          {branchesQ.data?.filter(b => b.active).map(b => (
            <button key={b.id} onClick={() => pick(b.id)} role="option" aria-selected={override === b.id}
              style={{
                display: 'flex', gap: 11, padding: '12px 14px', width: '100%',
                textAlign: 'left', border: 'none', cursor: 'pointer',
                background: override === b.id ? 'var(--accent-soft)' : 'transparent',
                borderBottom: '1px solid var(--line)',
              }}>
              <Ic.layers size={16} style={{ color: 'var(--ink-3)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{b.nama}</div>
                <div className="muted mono" style={{ fontSize: 11.5, marginTop: 1 }}>{b.kode}</div>
              </div>
              {override === b.id && <Ic.check size={16} style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
