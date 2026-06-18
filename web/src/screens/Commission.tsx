import { useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { Avatar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

interface CommissionRow {
  petugasId: string;
  kode: string;
  nama: string;
  branchKode: string;
  commissionBps: number;
  collected: number;
  commission: number;
}
interface CommissionResponse {
  year: number; month: number; total: number; rows: CommissionRow[];
}

async function fetchCommission(year: number, month: number): Promise<CommissionResponse> {
  return (await axios.get(`${BASE}/analytics/commission`, {
    withCredentials: true, headers: headers(), params: { year, month },
  })).data;
}

function fmtRp(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export function ScreenCommission() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const q = useQuery({
    queryKey: ['commission', year, month],
    queryFn: () => fetchCommission(year, month),
  });

  if (q.isPending) return <div className="content"><Skeleton h={500} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  // Pure inline avatar — we don't have hue from this endpoint; fall back to
  // a deterministic value based on kode so the row still looks lively.
  const hue = (kode: string) => {
    let h = 0;
    for (let i = 0; i < kode.length; i++) h = (h * 31 + kode.charCodeAt(i)) % 360;
    return h;
  };

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 4 }}>Komisi Petugas — {monthLabel}</div>
          <div className="page-sub">
            Komisi = tertagih sukses × tarif. Set tarif (basis points) lewat Kelola Petugas.
          </div>
        </div>
        <div className="center gap-2">
          <select className="input" style={{ width: 'auto' }} value={month} onChange={e => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>
                {new Date(2000, m - 1, 1).toLocaleDateString('id-ID', { month: 'long' })}
              </option>
            ))}
          </select>
          <input className="input" type="number" min={2024} max={year + 1} value={year}
            onChange={e => setYear(Number(e.target.value))} style={{ width: 96 }} />
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 18 }}>
        <Tile label="Total komisi" value={fmtRp(d.total)} icon="wallet" />
        <Tile label="Petugas aktif" value={d.rows.length} icon="users" />
        <Tile label="Avg tarif"
          value={(d.rows.length === 0 ? 0
            : d.rows.reduce((s, r) => s + r.commissionBps, 0) / d.rows.length / 100).toFixed(2) + '%'}
          icon="target" />
      </div>

      {d.rows.length === 0 ? (
        <EmptyState title="Belum ada data" hint="Bulan ini tidak ada pembayaran tercatat." />
      ) : (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Petugas</th>
                <th>Cabang</th>
                <th style={{ textAlign: 'right' }}>Tarif</th>
                <th style={{ textAlign: 'right' }}>Tertagih</th>
                <th style={{ textAlign: 'right' }}>Komisi</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map(r => (
                <tr key={r.petugasId}>
                  <td>
                    <div className="center gap-2">
                      <Avatar inisial={r.nama.slice(0, 2).toUpperCase()} hue={hue(r.kode)} size={28} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{r.nama}</div>
                        <div className="muted mono" style={{ fontSize: 11 }}>{r.kode}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{r.branchKode}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{(r.commissionBps / 100).toFixed(2)}%</td>
                  <td className="num" style={{ textAlign: 'right' }}>{fmtRp(r.collected)}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{fmtRp(r.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, icon }: { label: string; value: string | number; icon: 'wallet' | 'users' | 'target' }) {
  const Icon = Ic[icon];
  return (
    <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Icon size={18} />
      </div>
      <div>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {label}
        </div>
        <div className="num" style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}
