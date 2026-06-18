import { useMemo, useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { RPjt } from '../data/queries';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const override = useAuth.getState().branchOverride;
  if (override) h['x-branch-id'] = override;
  return h;
}

interface ScorecardRow {
  branchId: string;
  branchKode: string;
  branchNama: string;
  targetCollection: number;
  actualCollection: number;
  targetVisits: number;
  actualVisits: number;
  targetApprovalRate: number;
  actualApprovalRate: number;
}

interface HeatmapCell {
  branchId: string;
  branchKode: string;
  branchNama: string;
  kol: 'K1' | 'K2' | 'K3' | 'K4' | 'K5';
  count: number;
  outstanding: number;
}

async function fetchScorecard(year: number, month: number) {
  const r = await axios.get<{ year: number; month: number; rows: ScorecardRow[] }>(
    `${BASE}/analytics/scorecard`,
    { withCredentials: true, headers: headers(), params: { year, month } },
  );
  return r.data;
}

async function fetchHeatmap() {
  const r = await axios.get<{ cells: HeatmapCell[] }>(
    `${BASE}/analytics/heatmap`,
    { withCredentials: true, headers: headers() },
  );
  return r.data;
}

export function ScreenScorecard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const scoreQ = useQuery({
    queryKey: ['scorecard', year, month],
    queryFn: () => fetchScorecard(year, month),
  });
  const heatQ = useQuery({ queryKey: ['heatmap'], queryFn: fetchHeatmap });

  if (scoreQ.isPending || heatQ.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <Skeleton h={320} />
        <Skeleton h={320} />
      </div>
    );
  }
  if (scoreQ.error || heatQ.error) {
    return (
      <div className="content">
        <ErrorState onRetry={() => { scoreQ.refetch(); heatQ.refetch(); }} />
      </div>
    );
  }

  const rows = scoreQ.data?.rows ?? [];
  const cells = heatQ.data?.cells ?? [];

  return (
    <div className="content" style={{ display: 'grid', gap: 18 }}>
      <ScorecardPanel
        rows={rows} year={year} month={month}
        onYear={setYear} onMonth={setMonth}
      />
      <HeatmapPanel cells={cells} />
    </div>
  );
}

function ScorecardPanel({ rows, year, month, onYear, onMonth }: {
  rows: ScorecardRow[]; year: number; month: number;
  onYear: (y: number) => void; onMonth: (m: number) => void;
}) {
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long', year: 'numeric',
  });
  return (
    <div className="card fade-up" style={{ overflow: 'hidden' }}>
      <div className="between card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="section-title">KPI Cabang vs Target — {monthLabel}</div>
          <div className="page-sub">Capaian bulan berjalan, target di-set per cabang oleh ADMIN.</div>
        </div>
        <div className="center gap-2">
          <select className="input" style={{ width: 'auto' }} value={month} onChange={e => onMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>
                {new Date(2000, m - 1, 1).toLocaleDateString('id-ID', { month: 'long' })}
              </option>
            ))}
          </select>
          <select className="input" style={{ width: 'auto' }} value={year} onChange={e => onYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Belum ada cabang aktif" hint="Tambahkan cabang via menu Kelola Cabang." />
      ) : (
        <div style={{ padding: '14px 16px', display: 'grid', gap: 14 }}>
          {rows.map(r => <ScorecardRowCard key={r.branchId} row={r} />)}
        </div>
      )}
    </div>
  );
}

function ScorecardRowCard({ row }: { row: ScorecardRow }) {
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 14, padding: 14,
      display: 'grid', gap: 14, background: 'var(--surface)',
    }}>
      <div className="between">
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{row.branchNama}</div>
          <div className="muted mono" style={{ fontSize: 11.5 }}>{row.branchKode}</div>
        </div>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiBar
          label="Tertagih"
          actual={row.actualCollection}
          target={row.targetCollection}
          fmt={(n) => RPjt(n)}
        />
        <KpiBar
          label="Kunjungan"
          actual={row.actualVisits}
          target={row.targetVisits}
          fmt={(n) => String(n)}
        />
        <KpiBar
          label="Approval Rate"
          actual={row.actualApprovalRate}
          target={row.targetApprovalRate}
          fmt={(n) => `${n}%`}
          isRate
        />
      </div>
    </div>
  );
}

function KpiBar({ label, actual, target, fmt, isRate }: {
  label: string; actual: number; target: number;
  fmt: (n: number) => string; isRate?: boolean;
}) {
  // For rates, "achievement" is actual vs target where 100% means hitting the
  // target exactly. For absolute metrics, percent is just actual/target.
  const pct = target === 0 ? 0 : Math.min(150, Math.round((actual / target) * 100));
  const color =
    pct >= 100 ? 'var(--accent)' :
    pct >= 80 ? 'var(--col-dpk)' :
    'var(--col-macet)';
  return (
    <div>
      <div className="between" style={{ marginBottom: 6 }}>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontWeight: 800, fontSize: 12, color }}>{pct}%</div>
      </div>
      <div className="num" style={{ fontWeight: 800, fontSize: 16, color: 'var(--ink)' }}>
        {fmt(actual)} <span className="muted" style={{ fontWeight: 600, fontSize: 12 }}>/ {target === 0 ? '—' : fmt(target)}{isRate ? '' : ''}</span>
      </div>
      <div style={{ marginTop: 6, height: 6, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, pct)}%`, height: '100%',
          background: color, transition: 'width 200ms ease',
        }} />
      </div>
    </div>
  );
}

const KOL_LABEL: Record<string, string> = {
  K1: 'Lancar', K2: 'DPK', K3: 'Kurang Lancar', K4: 'Diragukan', K5: 'Macet',
};
const KOL_WEIGHT: Record<string, number> = { K1: 0, K2: 1, K3: 2, K4: 3, K5: 4 };

function HeatmapPanel({ cells }: { cells: HeatmapCell[] }) {
  // Rows = cabang; columns = K1..K5. Color intensity by outstanding share.
  const branches = useMemo(() => {
    const m = new Map<string, { id: string; kode: string; nama: string }>();
    for (const c of cells) m.set(c.branchId, { id: c.branchId, kode: c.branchKode, nama: c.branchNama });
    return Array.from(m.values()).sort((a, b) => a.kode.localeCompare(b.kode));
  }, [cells]);

  const maxOutstanding = useMemo(
    () => cells.reduce((m, c) => Math.max(m, c.outstanding), 0),
    [cells],
  );

  if (branches.length === 0) {
    return (
      <div className="card fade-up">
        <EmptyState title="Belum ada nasabah aktif" hint="Tambahkan nasabah dulu untuk melihat distribusi risiko." />
      </div>
    );
  }

  return (
    <div className="card fade-up" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <div className="section-title">Heatmap Risiko Portofolio</div>
        <div className="page-sub">
          Distribusi outstanding per (cabang × kolektabilitas). Sel makin merah = risiko makin terkonsentrasi.
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Cabang</th>
              {(['K1', 'K2', 'K3', 'K4', 'K5'] as const).map(kol => (
                <th key={kol} style={{ textAlign: 'center', minWidth: 100 }}>
                  <div style={{ fontWeight: 800 }}>{kol}</div>
                  <div className="muted" style={{ fontWeight: 500, fontSize: 10.5 }}>{KOL_LABEL[kol]}</div>
                </th>
              ))}
              <th style={{ textAlign: 'right' }}>Total OS</th>
            </tr>
          </thead>
          <tbody>
            {branches.map(b => {
              const rowCells = (['K1', 'K2', 'K3', 'K4', 'K5'] as const).map(kol =>
                cells.find(c => c.branchId === b.id && c.kol === kol)!,
              );
              const total = rowCells.reduce((s, c) => s + c.outstanding, 0);
              return (
                <tr key={b.id}>
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{b.nama}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{b.kode}</div>
                  </td>
                  {rowCells.map(c => <HeatCell key={c.kol} c={c} max={maxOutstanding} />)}
                  <td className="num" style={{ textAlign: 'right', fontWeight: 800, fontSize: 13 }}>{RPjt(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-pad" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="center gap-3" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          <span>Skala warna:</span>
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <span key={t} style={{
              width: 24, height: 14, background: cellColor(t * maxOutstanding, maxOutstanding, 'K3'),
              borderRadius: 4, border: '1px solid var(--line)',
            }} />
          ))}
          <span className="muted">low → high outstanding</span>
        </div>
      </div>
    </div>
  );
}

function HeatCell({ c, max }: { c: HeatmapCell; max: number }) {
  return (
    <td style={{ textAlign: 'center', padding: 6 }}>
      <div style={{
        background: cellColor(c.outstanding, max, c.kol),
        borderRadius: 8, padding: '8px 4px', minHeight: 48,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div className="num" style={{ fontWeight: 800, fontSize: 13, color: c.outstanding > 0 ? 'var(--ink)' : 'var(--ink-4)' }}>
          {c.count}
        </div>
        <div className="num" style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600, marginTop: 2 }}>
          {c.outstanding > 0 ? RPjt(c.outstanding) : '—'}
        </div>
      </div>
    </td>
  );
}

function cellColor(outstanding: number, max: number, kol: string): string {
  if (max === 0 || outstanding === 0) return 'var(--surface-2)';
  // Two factors compound: kol weight (1..5) skews towards red for higher kol,
  // and outstanding intensity gives the alpha. Sigmoid on log scale so a few
  // outlier cells don't wash everyone else out.
  const intensity = Math.min(1, Math.log10(1 + outstanding) / Math.log10(1 + max));
  const w = KOL_WEIGHT[kol] ?? 0;
  // Hue 130 (green) → 25 (red) along K1..K5.
  const hue = Math.round(130 - (w / 4) * 105);
  const chroma = 0.08 + intensity * 0.10;
  const light = 0.94 - intensity * 0.22;
  return `oklch(${light} ${chroma} ${hue})`;
}
