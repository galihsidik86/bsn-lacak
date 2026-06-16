import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { Modal } from '../components/UI';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Branch { id: string; kode: string; nama: string }
interface ApiKeyRow {
  id: string;
  name: string;
  tokenPrefix: string;
  branchId: string | null;
  scope: 'read' | 'write';
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { username: string; nama: string };
  branch: { kode: string; nama: string } | null;
}

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function list(): Promise<ApiKeyRow[]> {
  return (await axios.get(`${BASE}/api-keys`, { withCredentials: true, headers: authHeaders() })).data;
}
async function listBranches(): Promise<Branch[]> {
  return (await axios.get(`${BASE}/branches`, { withCredentials: true, headers: authHeaders() })).data;
}
async function createKey(p: { name: string; branchId?: string; scope: 'read' | 'write'; expiresAt?: string }): Promise<{ id: string; token: string; prefix: string; name: string }> {
  return (await axios.post(`${BASE}/api-keys`, p, { withCredentials: true, headers: authHeaders() })).data;
}
async function revoke(id: string) {
  return (await axios.post(`${BASE}/api-keys/${id}/revoke`, {}, { withCredentials: true, headers: authHeaders() })).data;
}

export function ScreenApiKeys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: list });
  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: listBranches });
  const [creating, setCreating] = useState(false);

  const revokeMut = useMutation({
    mutationFn: revoke,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const rows = q.data ?? [];
  const active = rows.filter(r => !r.revokedAt);

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="chip"><Ic.eye size={14} />{active.length} aktif · {rows.length} total</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Ic.plus size={16} />Buat API Key
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card"><EmptyState title="Belum ada API key" hint="Buat key pertama untuk integrasi machine-to-machine." /></div>
      ) : (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr>
              <th>Nama</th><th>Prefix</th><th>Scope</th><th>Cabang</th>
              <th>Dibuat</th><th>Last used</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const expired = r.expiresAt && new Date(r.expiresAt) < new Date();
                const isRevoked = !!r.revokedAt;
                return (
                  <tr key={r.id} style={{ opacity: (isRevoked || expired) ? 0.5 : 1 }}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{r.name}</div>
                      <div className="muted" style={{ fontSize: 11 }}>oleh {r.createdBy.nama}</div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{r.tokenPrefix}…</td>
                    <td><span className="chip">{r.scope}</span></td>
                    <td className="muted">{r.branch?.nama ?? 'Semua cabang'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{new Date(r.createdAt).toLocaleDateString('id-ID')}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {r.lastUsedAt ? new Date(r.lastUsedAt).toLocaleDateString('id-ID') : '—'}
                    </td>
                    <td>
                      {isRevoked ? <span className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>Revoked</span>
                        : expired ? <span className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>Expired</span>
                        : <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Aktif</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!isRevoked && (
                        <button className="btn btn-sm btn-ghost"
                          onClick={() => { if (window.confirm(`Revoke API key "${r.name}"?`)) revokeMut.mutate(r.id); }}
                          disabled={revokeMut.isPending}>
                          <Ic.x size={13} />Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateForm branches={branchesQ.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['api-keys'] }); }} />
      )}
    </div>
  );
}

function CreateForm({ branches, onClose, onSaved }: {
  branches: Branch[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [expiresAt, setExpiresAt] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = useMutation({
    mutationFn: () => createKey({
      name,
      branchId: branchId || undefined,
      scope,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    }),
    onSuccess: (data) => setToken(data.token),
  });

  return (
    <Modal onClose={onClose} max={560}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">{token ? 'API Key Berhasil Dibuat' : 'Buat API Key'}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            {token ? 'Catat token ini sekarang. Setelah modal ditutup tidak bisa dilihat lagi.'
              : 'Untuk integrasi machine-to-machine. Token hanya ditampilkan sekali.'}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>

      <div className="modal-body">
        {token ? (
          <>
            <div className="card card-pad" style={{
              background: 'var(--col-dpk-soft)', color: 'var(--col-dpk)',
              boxShadow: 'none', marginBottom: 14,
            }}>
              <div className="center gap-2" style={{ fontWeight: 700, fontSize: 12.5 }}>
                <Ic.alert size={14} />Token rahasia · jangan share di chat publik / commit ke git.
              </div>
            </div>
            <div className="mono" style={{
              padding: 14, background: 'var(--surface-2)', borderRadius: 10,
              wordBreak: 'break-all', fontSize: 12.5, fontWeight: 700,
            }}>{token}</div>
            <button className="btn" style={{ marginTop: 10 }}
              onClick={async () => {
                try { await navigator.clipboard.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 2000); }
                catch { /* ignore */ }
              }}>
              <Ic.download size={14} />{copied ? 'Tersalin ✓' : 'Salin token'}
            </button>
          </>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Nama</span>
              <input className="input" value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="Reporting service integration" />
            </label>
            <label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Scope cabang (opsional)</span>
              <select className="input" value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">Semua cabang (ADMIN scope)</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.kode} · {b.nama}</option>)}
              </select>
            </label>
            <label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Level akses</span>
              <select className="input" value={scope} onChange={e => setScope(e.target.value as 'read' | 'write')}>
                <option value="read">Read only</option>
                <option value="write">Read + write</option>
              </select>
            </label>
            <label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Kedaluwarsa (opsional)</span>
              <input className="input" type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            </label>
          </div>
        )}
      </div>

      <div className="modal-foot">
        {token ? (
          <button type="button" className="btn btn-primary" onClick={onSaved}>Selesai</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>Batal</button>
            <button type="button" className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
              {save.isPending ? 'Membuat…' : 'Buat'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
