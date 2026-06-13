import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from './Icons';
import { ErrorState, Skeleton } from './States';
import { tokenStore } from '../lib/api';
import { RPjt } from '../data/queries';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface BranchRow {
  id: string;
  kode: string;
  nama: string;
  outstanding: number;
  nplNom: number;
  npl: number;
  nasabah: number;
  petugas: number;
  target: number;
  terkumpul: number;
}

async function fetchComparison(): Promise<BranchRow[]> {
  const tok = tokenStore.get();
  const r = await axios.get(`${BASE}/branches/comparison`, {
    withCredentials: true,
    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
  });
  return r.data;
}

function nplBadgeColor(npl: number): string {
  if (npl < 2) return 'var(--accent)';
  if (npl < 5) return 'var(--col-dpk)';
  if (npl < 8) return 'var(--col-kl)';
  return 'var(--col-macet)';
}

// ADMIN-only card. Renders comparison across active branches: outstanding,
// NPL, capture rate (terkumpul/target), petugas headcount.
export function BranchComparison({ onPickBranch }: { onPickBranch?: (id: string) => void }) {
  const q = useQuery({ queryKey: ['branches-comparison'], queryFn: fetchComparison });

  if (q.isPending) return <div className="card card-pad fade-up"><Skeleton h={260} /></div>;
  if (q.error) return <div className="card card-pad fade-up"><ErrorState onRetry={() => q.refetch()} /></div>;
  if (!q.data || q.data.length === 0) return null;

  const rows = q.data;
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const maxOutstanding = Math.max(...rows.map(r => r.outstanding), 1);

  return (
    <div className="card card-pad fade-up" style={{ marginBottom: 20 }}>
      <div className="between" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">Performa per Cabang</div>
          <div className="page-sub">Perbandingan outstanding, NPL, dan perolehan hari ini</div>
        </div>
        <span className="chip" style={{ background: 'var(--gold-soft)', color: 'var(--gold-ink)' }}>
          <Ic.layers size={13} />ADMIN view · {rows.length} cabang
        </span>
      </div>

      <table className="table">
        <thead><tr>
          <th>Cabang</th>
          <th style={{ textAlign: 'right' }}>Outstanding</th>
          <th>Distribusi</th>
          <th style={{ textAlign: 'center' }}>NPL</th>
          <th style={{ textAlign: 'right' }}>Nasabah</th>
          <th style={{ textAlign: 'right' }}>Petugas</th>
          <th style={{ textAlign: 'right' }}>Tertagih Hari Ini</th>
          <th style={{ textAlign: 'center' }}>Capture</th>
          <th></th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const sharePct = totalOutstanding > 0 ? (r.outstanding / totalOutstanding) * 100 : 0;
            const capturePct = r.target > 0 ? Math.min(100, Math.round(r.terkumpul / r.target * 100)) : 0;
            return (
              <tr key={r.id}
                className={onPickBranch ? 'row-click' : undefined}
                onClick={onPickBranch ? () => onPickBranch(r.id) : undefined}>
                <td>
                  <div style={{ fontWeight: 700 }}>{r.nama}</div>
                  <div className="muted mono" style={{ fontSize: 11.5 }}>{r.kode}</div>
                </td>
                <td style={{ textAlign: 'right' }} className="num">{RPjt(r.outstanding)}</td>
                <td style={{ minWidth: 160 }}>
                  <div className="progress" style={{ height: 7 }}>
                    <span style={{ width: (r.outstanding / maxOutstanding * 100) + '%' }} />
                  </div>
                  <div className="muted num" style={{ fontSize: 11, marginTop: 4 }}>{sharePct.toFixed(1)}% dari total</div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span className="badge num" style={{
                    background: 'var(--surface-2)', color: nplBadgeColor(r.npl),
                  }}>
                    <span className="dot" style={{ background: nplBadgeColor(r.npl) }} />
                    {r.npl.toFixed(2)}%
                  </span>
                </td>
                <td style={{ textAlign: 'right' }} className="num">{r.nasabah}</td>
                <td style={{ textAlign: 'right' }} className="num">{r.petugas}</td>
                <td style={{ textAlign: 'right' }} className="num">{RPjt(r.terkumpul)}</td>
                <td style={{ textAlign: 'center' }}>
                  <span className="num" style={{
                    fontWeight: 700, fontSize: 12.5,
                    color: capturePct >= 70 ? 'var(--accent)' : capturePct >= 40 ? 'var(--col-dpk)' : 'var(--col-macet)',
                  }}>{capturePct}%</span>
                </td>
                <td>{onPickBranch && <Ic.chevR size={14} style={{ color: 'var(--ink-4)' }} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
