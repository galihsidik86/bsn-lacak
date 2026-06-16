import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { Modal } from '../components/UI';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Branch { id: string; kode: string; nama: string }
interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  branchId: string | null;
  active: boolean;
  lastDeliveryAt: string | null;
  createdAt: string;
  createdBy: { username: string; nama: string };
  branch: { kode: string; nama: string } | null;
  _count: { deliveries: number };
}
interface DeliveryRow {
  id: string;
  event: string;
  status: 'success' | 'failed' | 'retrying';
  responseStatus: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
}

const ALL_EVENTS = [
  'kunjungan.created', 'kunjungan.reviewed',
  'nasabah.reassign', 'blast.completed',
] as const;

function authHeaders() {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function list(): Promise<WebhookRow[]> {
  return (await axios.get(`${BASE}/webhooks`, { withCredentials: true, headers: authHeaders() })).data;
}
async function listBranches(): Promise<Branch[]> {
  return (await axios.get(`${BASE}/branches`, { withCredentials: true, headers: authHeaders() })).data;
}
async function create(p: { name: string; url: string; events: string[]; branchId?: string }): Promise<WebhookRow & { secret: string }> {
  return (await axios.post(`${BASE}/webhooks`, p, { withCredentials: true, headers: authHeaders() })).data;
}
async function toggle(id: string, active: boolean): Promise<WebhookRow> {
  return (await axios.patch(`${BASE}/webhooks/${id}`, { active }, { withCredentials: true, headers: authHeaders() })).data;
}
async function remove(id: string): Promise<void> {
  await axios.delete(`${BASE}/webhooks/${id}`, { withCredentials: true, headers: authHeaders() });
}
async function deliveries(id: string): Promise<DeliveryRow[]> {
  return (await axios.get(`${BASE}/webhooks/${id}/deliveries`, { withCredentials: true, headers: authHeaders() })).data;
}

export function ScreenWebhooks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['webhooks'], queryFn: list });
  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: listBranches });
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<WebhookRow | null>(null);

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggle(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });
  const removeMut = useMutation({
    mutationFn: remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const rows = q.data ?? [];

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="chip"><Ic.send size={14} />{rows.filter(r => r.active).length} aktif · {rows.length} total</div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Ic.plus size={16} />Daftarkan Webhook
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card"><EmptyState title="Belum ada webhook" hint="Daftarkan URL eksternal untuk menerima event dari sistem ini." /></div>
      ) : (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr>
              <th>Nama</th><th>URL</th><th>Events</th><th>Cabang</th>
              <th>Last delivery</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{r._count.deliveries} delivery</div>
                  </td>
                  <td className="mono" style={{ fontSize: 11, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</td>
                  <td style={{ fontSize: 11 }}>{r.events.length === 0 ? <em className="muted">Semua</em> : r.events.join(', ')}</td>
                  <td className="muted">{r.branch?.nama ?? 'Semua'}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {r.lastDeliveryAt ? new Date(r.lastDeliveryAt).toLocaleString('id-ID') : '—'}
                  </td>
                  <td>
                    <button onClick={() => toggleMut.mutate({ id: r.id, active: !r.active })}
                      className="chip" style={{
                        background: r.active ? 'var(--accent-soft)' : 'var(--surface-2)',
                        color: r.active ? 'var(--accent-ink)' : 'var(--ink-3)',
                        cursor: 'pointer', border: 'none',
                      }}>
                      {r.active ? 'Aktif' : 'Off'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="center gap-2" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setViewing(r)}>
                        <Ic.eye size={13} />Log
                      </button>
                      <button className="btn btn-sm btn-ghost"
                        onClick={() => { if (window.confirm(`Hapus webhook "${r.name}"?`)) removeMut.mutate(r.id); }}>
                        <Ic.x size={13} />Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateForm branches={branchesQ.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['webhooks'] }); }} />
      )}

      {viewing && <DeliveriesView webhook={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CreateForm({ branches, onClose, onSaved }: {
  branches: Branch[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [branchId, setBranchId] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = useMutation({
    mutationFn: () => create({
      name, url, events,
      branchId: branchId || undefined,
    }),
    onSuccess: (data) => setSecret(data.secret),
  });

  return (
    <Modal onClose={onClose} max={580}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">{secret ? 'Webhook Didaftarkan' : 'Daftarkan Webhook'}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            {secret ? 'Catat secret di bawah — dipakai untuk verify HMAC signature di receiver Anda.'
              : 'POST event JSON ke URL Anda. Header X-BSN-Signature: sha256=<hex> untuk verifikasi.'}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>

      <div className="modal-body">
        {secret ? (
          <>
            <div className="card card-pad" style={{ background: 'var(--col-dpk-soft)', color: 'var(--col-dpk)', boxShadow: 'none', marginBottom: 14 }}>
              <div className="center gap-2" style={{ fontWeight: 700, fontSize: 12.5 }}>
                <Ic.alert size={14} />Secret hanya ditampilkan sekarang. Simpan di vault.
              </div>
            </div>
            <div className="mono" style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 10, wordBreak: 'break-all', fontSize: 12.5, fontWeight: 700 }}>
              {secret}
            </div>
            <button className="btn" style={{ marginTop: 10 }}
              onClick={async () => {
                try { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 2000); }
                catch { /* ignore */ }
              }}>
              <Ic.download size={14} />{copied ? 'Tersalin ✓' : 'Salin secret'}
            </button>
          </>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Nama</span>
              <input className="input" value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="ERP integration" />
            </label>
            <label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>URL endpoint</span>
              <input className="input" type="url" value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://example.com/webhooks/bsn" />
            </label>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>
                Event yang ingin diterima (kosong = semua)
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {ALL_EVENTS.map(ev => {
                  const on = events.includes(ev);
                  return (
                    <label key={ev} style={{
                      padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                      background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                      color: on ? 'var(--accent-ink)' : 'var(--ink-2)',
                    }}>
                      <input type="checkbox" checked={on}
                        onChange={e => setEvents(es => e.target.checked ? [...es, ev] : es.filter(x => x !== ev))}
                        style={{ marginRight: 8 }} />
                      {ev}
                    </label>
                  );
                })}
              </div>
            </div>
            <label>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>Scope cabang (opsional)</span>
              <select className="input" value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">Semua cabang</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.kode} · {b.nama}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="modal-foot">
        {secret ? (
          <button type="button" className="btn btn-primary" onClick={onSaved}>Selesai</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>Batal</button>
            <button type="button" className="btn btn-primary" onClick={() => save.mutate()}
              disabled={save.isPending || !name.trim() || !url.trim()}>
              {save.isPending ? 'Mendaftar…' : 'Daftarkan'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function DeliveriesView({ webhook, onClose }: { webhook: WebhookRow; onClose: () => void }) {
  const q = useQuery({ queryKey: ['webhook-deliveries', webhook.id], queryFn: () => deliveries(webhook.id) });
  return (
    <Modal onClose={onClose} max={820}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">Delivery Log · {webhook.name}</div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 3 }}>{webhook.url}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body">
        {q.isPending ? <Skeleton h={300} />
          : q.error ? <ErrorState onRetry={() => q.refetch()} />
          : (q.data?.length ?? 0) === 0 ? <EmptyState title="Belum ada delivery" />
          : (
            <table className="table">
              <thead><tr>
                <th>Waktu</th><th>Event</th><th>Status</th><th style={{ textAlign: 'right' }}>HTTP</th>
                <th>Attempts</th><th>Error</th>
              </tr></thead>
              <tbody>
                {q.data!.map(d => (
                  <tr key={d.id}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{new Date(d.createdAt).toLocaleString('id-ID')}</td>
                    <td><span className="badge">{d.event}</span></td>
                    <td>
                      <span className="chip" style={{
                        background: d.status === 'success' ? 'var(--accent-soft)'
                          : d.status === 'retrying' ? 'var(--col-dpk-soft)' : 'var(--col-macet-soft)',
                        color: d.status === 'success' ? 'var(--accent-ink)'
                          : d.status === 'retrying' ? 'var(--col-dpk)' : 'var(--col-macet)',
                      }}>{d.status}</span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="num">{d.responseStatus ?? '—'}</td>
                    <td className="num">{d.attempts}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{d.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </Modal>
  );
}
