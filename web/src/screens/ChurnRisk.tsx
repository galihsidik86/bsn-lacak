import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { KolBadge } from '../components/UI';
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

type Tier = 'low' | 'medium' | 'high' | 'critical';

interface ChurnRow {
  nasabahId: string;
  kode: string;
  nama: string;
  petugasKode: string;
  petugasNama: string;
  branchKode: string;
  kol: 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
  sisa: number;
  dpd: number;
  daysSinceLastPayment: number | null;
  visitsLast30d: number;
  failedVisits30d: number;
  score: number;
  tier: Tier;
}

async function fetchChurn(): Promise<{ rows: ChurnRow[] }> {
  return (await axios.get(`${BASE}/analytics/churn?limit=100`,
    { withCredentials: true, headers: headers() })).data;
}

const TIER_TINT: Record<Tier, { bg: string; fg: string }> = {
  low: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  medium: { bg: 'var(--col-dpk-soft)', fg: 'var(--col-dpk)' },
  high: { bg: 'var(--col-kl-soft)', fg: 'var(--col-kl)' },
  critical: { bg: 'var(--col-macet-soft)', fg: 'var(--col-macet)' },
};

const TIER_LABEL: Record<Tier, string> = {
  low: 'Rendah', medium: 'Sedang', high: 'Tinggi', critical: 'Kritis',
};

function fmtRpJt(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + ' M';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' jt';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + ' rb';
  return String(n);
}

export function ScreenChurnRisk() {
  const q = useQuery({ queryKey: ['churn'], queryFn: fetchChurn });
  if (q.isPending) return <div className="content"><Skeleton h={500} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const rows = q.data?.rows ?? [];
  if (rows.length === 0) return <div className="content"><EmptyState title="Belum ada data churn risk" /></div>;

  const counts = rows.reduce((acc, r) => { acc[r.tier]++; return acc; },
    { low: 0, medium: 0, high: 0, critical: 0 } as Record<Tier, number>);

  return (
    <div className="content" style={{ display: 'grid', gap: 18 }}>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {(['critical', 'high', 'medium', 'low'] as Tier[]).map(t => (
          <div key={t} style={{
            background: TIER_TINT[t].bg, color: TIER_TINT[t].fg,
            borderRadius: 14, padding: 14,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {TIER_LABEL[t]}
            </div>
            <div className="num" style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{counts[t]}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.85 }}>
              {t === 'critical' ? '≥ 75 poin'
                : t === 'high' ? '50–74'
                : t === 'medium' ? '25–49' : '< 25'}
            </div>
          </div>
        ))}
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Top {rows.length} Churn Risk</div>
          <div className="page-sub">
            Skor berdasarkan hari sejak bayar terakhir, DPD, kunjungan gagal, dan tidak ada kunjungan 30 hari.
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nasabah</th>
                <th>Petugas</th>
                <th>Kol</th>
                <th style={{ textAlign: 'right' }}>DPD</th>
                <th style={{ textAlign: 'right' }}>Hari sejak bayar</th>
                <th style={{ textAlign: 'right' }}>Visit 30d</th>
                <th style={{ textAlign: 'right' }}>Skor</th>
                <th>Tier</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.nasabahId}>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.nama}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{r.kode} · {r.branchKode}</div>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{r.petugasKode}</td>
                  <td><KolBadge kol={Number(r.kol[1]) as 1 | 2 | 3 | 4 | 5} /></td>
                  <td className="num" style={{ textAlign: 'right' }}>{r.dpd}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{r.daysSinceLastPayment ?? '—'}</td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {r.visitsLast30d}
                    {r.failedVisits30d > 0 && (
                      <span className="muted" style={{ fontSize: 10.5 }}> ({r.failedVisits30d} gagal)</span>
                    )}
                  </td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{r.score}</td>
                  <td>
                    <span className="chip" style={{
                      background: TIER_TINT[r.tier].bg, color: TIER_TINT[r.tier].fg, fontSize: 11.5,
                    }}>
                      <Ic.alert size={11} />{TIER_LABEL[r.tier]}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtRpJt(r.sisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
