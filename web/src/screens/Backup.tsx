import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface BackupFile { name: string; size: number; mtime: string }
interface BackupListResponse { dir: string; configured: boolean; files: BackupFile[] }
interface VerifyResponse { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] }

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function listBackups(): Promise<BackupListResponse> {
  return (await axios.get(`${BASE}/backup`, { withCredentials: true, headers: authHeaders() })).data;
}
async function verify(name: string): Promise<VerifyResponse> {
  return (await axios.post(`${BASE}/backup/${name}/verify`, {}, { withCredentials: true, headers: authHeaders() })).data;
}

function fmtSize(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function ScreenBackup() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backup'], queryFn: listBackups });
  const [results, setResults] = useState<Record<string, VerifyResponse>>({});

  const verifyMut = useMutation({
    mutationFn: verify,
    onSuccess: (data, name) => setResults(r => ({ ...r, [name]: data })),
  });

  if (q.isPending) return <div className="content"><Skeleton h={300} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const data = q.data!;
  const newest = data.files[0];
  const ageMs = newest ? Date.now() - new Date(newest.mtime).getTime() : null;
  const fresh = ageMs !== null && ageMs < 36 * 60 * 60 * 1000;

  return (
    <div className="content" style={{ maxWidth: 920, margin: '0 auto' }}>
      <div className="card card-pad fade-up" style={{ marginBottom: 18 }}>
        <div className="section-title" style={{ marginBottom: 6 }}>Status Backup</div>
        <div className="page-sub" style={{ marginBottom: 16 }}>
          Backup pg_dump otomatis tiap 24 jam ke volume <code className="mono">{data.dir}</code>.
          Verifikasi memeriksa gzip integrity + dump preamble + size sanity (TIDAK melakukan restore).
        </div>
        {!data.configured ? (
          <div className="center gap-2" style={{
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '12px 14px', fontSize: 12.5, fontWeight: 600,
          }}>
            <Ic.alert size={15} />Direktori backup belum termount ke API container. Set BACKUP_DIR + mount volume.
          </div>
        ) : data.files.length === 0 ? (
          <EmptyState title="Belum ada backup" hint="Jalankan backup manual atau tunggu cron." />
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <Stat label="File backup" value={String(data.files.length)} />
            <Stat label="Backup terakhir" value={newest ? new Date(newest.mtime).toLocaleString('id-ID') : '—'} accent={fresh ? 'ok' : 'warn'} />
            <Stat label="Total ukuran" value={fmtSize(data.files.reduce((s, f) => s + f.size, 0))} />
          </div>
        )}
      </div>

      {data.files.length > 0 && (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr>
              <th>File</th>
              <th style={{ textAlign: 'right' }}>Ukuran</th>
              <th>Waktu</th>
              <th>Status verifikasi</th>
              <th></th>
            </tr></thead>
            <tbody>
              {data.files.map(f => {
                const r = results[f.name];
                return (
                  <tr key={f.name}>
                    <td className="mono" style={{ fontSize: 12 }}>{f.name}</td>
                    <td style={{ textAlign: 'right' }} className="num">{fmtSize(f.size)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{new Date(f.mtime).toLocaleString('id-ID')}</td>
                    <td>
                      {!r ? <span className="muted" style={{ fontSize: 12 }}>Belum diverifikasi</span>
                        : r.ok ? <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}><Ic.checkCircle size={12} />OK</span>
                        : <span className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}><Ic.alert size={12} />Gagal</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost"
                        onClick={() => verifyMut.mutate(f.name)}
                        disabled={verifyMut.isPending}>
                        <Ic.checkCircle size={13} />Verifikasi
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {Object.entries(results).map(([name, r]) => (
        <div key={name} className="card card-pad fade-up" style={{ marginTop: 14 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>Hasil: <span className="mono">{name}</span></div>
          {r.checks.map(c => (
            <div key={c.name} className="center gap-2" style={{ padding: '6px 0', fontSize: 13 }}>
              {c.ok ? <Ic.checkCircle size={16} style={{ color: 'var(--accent)' }} />
                : <Ic.alert size={16} style={{ color: 'var(--col-macet)' }} />}
              <span style={{ fontWeight: 700 }}>{c.name}</span>
              <span className="muted">— {c.detail}</span>
            </div>
          ))}
        </div>
      ))}

      <div className="muted" style={{ fontSize: 11.5, marginTop: 16, lineHeight: 1.6 }}>
        Tip: untuk restore drill sesungguhnya, lihat <strong>DEPLOYMENT.md</strong> → bagian
        "Backup &amp; restore" → "Restore ke environment staging".
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'ok' | 'warn' }) {
  const c = accent === 'ok' ? 'var(--accent)' : accent === 'warn' ? 'var(--col-macet)' : 'var(--ink)';
  return (
    <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div className="num" style={{ fontWeight: 800, fontSize: 16, marginTop: 4, color: c }}>{value}</div>
    </div>
  );
}
