import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

function authHeaders() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const override = useAuth.getState().branchOverride;
  if (override) h['x-branch-id'] = override;
  return h;
}

type Bucket = '0_1d' | '1_3d' | '3_7d' | '7d_plus';

interface AgingResponse {
  buckets: Record<Bucket, number>;
  branches: Array<{
    branchId: string; branchKode: string; branchNama: string;
    buckets: Record<Bucket, number>;
    total: number;
  }>;
  petugas: Array<{
    petugasId: string; petugasKode: string; petugasNama: string;
    branchKode: string; oldest: string; days: number; count: number;
  }>;
}

const BUCKET_LABEL: Record<Bucket, string> = {
  '0_1d': '< 1 hari',
  '1_3d': '1–3 hari',
  '3_7d': '3–7 hari',
  '7d_plus': '> 7 hari',
};
const BUCKET_TINT: Record<Bucket, { bg: string; fg: string }> = {
  '0_1d': { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  '1_3d': { bg: 'var(--col-dpk-soft)', fg: 'var(--col-dpk)' },
  '3_7d': { bg: 'var(--col-kl-soft)', fg: 'var(--col-kl)' },
  '7d_plus': { bg: 'var(--col-macet-soft)', fg: 'var(--col-macet)' },
};
const BUCKETS: Bucket[] = ['0_1d', '1_3d', '3_7d', '7d_plus'];

async function fetchAging(): Promise<AgingResponse> {
  const r = await axios.get(`${BASE}/analytics/aging`,
    { withCredentials: true, headers: authHeaders() });
  return r.data;
}

export function ScreenAgingReport() {
  const q = useQuery({ queryKey: ['aging'], queryFn: fetchAging });

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const data = q.data!;
  const total = BUCKETS.reduce((s, b) => s + data.buckets[b], 0);

  if (total === 0) {
    return (
      <div className="content">
        <EmptyState title="Tidak ada PENDING" hint="Semua laporan sudah direview. Bagus!" />
      </div>
    );
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 18 }}>
      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">PENDING — Distribusi Usia</div>
          <div className="page-sub">Laporan menunggu review, dipecah berdasarkan usia sejak submit.</div>
        </div>
        <div className="grid gap-3" style={{ padding: 16, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {BUCKETS.map(b => {
            const v = data.buckets[b];
            const pct = total === 0 ? 0 : Math.round(v / total * 100);
            const t = BUCKET_TINT[b];
            return (
              <div key={b} style={{
                background: t.bg, color: t.fg, borderRadius: 14, padding: 14,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {BUCKET_LABEL[b]}
                </div>
                <div className="num" style={{ fontWeight: 800, fontSize: 28, marginTop: 4 }}>{v}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.85 }}>{pct}% dari pending</div>
              </div>
            );
          })}
        </div>
      </div>

      {data.branches.length > 0 && (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
            <div className="section-title">Per Cabang</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Cabang</th>
                  {BUCKETS.map(b => <th key={b} style={{ textAlign: 'right' }}>{BUCKET_LABEL[b]}</th>)}
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.branches.map(b => (
                  <tr key={b.branchId}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{b.branchNama}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>{b.branchKode}</div>
                    </td>
                    {BUCKETS.map(buc => (
                      <td key={buc} style={{ textAlign: 'right' }} className="num">
                        {b.buckets[buc] === 0 ? <span className="muted">—</span> : (
                          <span className="chip" style={{
                            background: BUCKET_TINT[buc].bg, color: BUCKET_TINT[buc].fg, fontSize: 11,
                          }}>{b.buckets[buc]}</span>
                        )}
                      </td>
                    ))}
                    <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{b.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.petugas.length > 0 && (
        <div className="card fade-up" style={{ overflow: 'hidden' }}>
          <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
            <div className="section-title">Petugas dengan Pending Terlama</div>
            <div className="page-sub">Top 20 petugas, urut dari usia oldest pending desc.</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Petugas</th>
                  <th>Cabang</th>
                  <th style={{ textAlign: 'right' }}>Pending</th>
                  <th style={{ textAlign: 'right' }}>Tertua</th>
                  <th style={{ textAlign: 'right' }}>Usia</th>
                </tr>
              </thead>
              <tbody>
                {data.petugas.map(p => (
                  <tr key={p.petugasId}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.petugasNama}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>{p.petugasKode}</div>
                    </td>
                    <td className="mono">{p.branchKode}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{p.count}</td>
                    <td className="num mono muted" style={{ textAlign: 'right', fontSize: 11.5 }}>
                      {new Date(p.oldest).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="chip" style={{
                        background: p.days >= 7 ? 'var(--col-macet-soft)'
                          : p.days >= 3 ? 'var(--col-kl-soft)'
                          : p.days >= 1 ? 'var(--col-dpk-soft)' : 'var(--accent-soft)',
                        color: p.days >= 7 ? 'var(--col-macet)'
                          : p.days >= 3 ? 'var(--col-kl)'
                          : p.days >= 1 ? 'var(--col-dpk)' : 'var(--accent-ink)',
                        fontSize: 11.5,
                      }}>
                        <Ic.clock size={11} />{p.days}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
