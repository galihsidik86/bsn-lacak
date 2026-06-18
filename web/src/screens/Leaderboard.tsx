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

interface LeaderRow {
  rank: number;
  petugasId: string;
  kode: string;
  nama: string;
  inisial: string;
  hue: number;
  branchKode: string;
  collected: number;
  visits: number;
}

interface LeaderboardData {
  year: number; month: number; rows: LeaderRow[];
}

async function fetchLeaderboard(year: number, month: number): Promise<LeaderboardData> {
  return (await axios.get(`${BASE}/analytics/leaderboard-monthly`, {
    withCredentials: true, headers: headers(), params: { year, month },
  })).data;
}

function fmtRp(n: number): string {
  if (n >= 1_000_000_000) return 'Rp ' + (n / 1_000_000_000).toFixed(1) + ' M';
  if (n >= 1_000_000) return 'Rp ' + (n / 1_000_000).toFixed(1) + ' jt';
  if (n >= 1_000) return 'Rp ' + (n / 1_000).toFixed(0) + ' rb';
  return 'Rp ' + n.toLocaleString('id-ID');
}

export function ScreenLeaderboard() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const q = useQuery({
    queryKey: ['leaderboard-monthly', year, month],
    queryFn: () => fetchLeaderboard(year, month),
  });

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const rows = q.data?.rows ?? [];
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long', year: 'numeric',
  });

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 4 }}>Leaderboard — {monthLabel}</div>
          <div className="page-sub">Top tertagih bulan ini. Klik petugas untuk lihat profil.</div>
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

      {rows.length === 0 ? (
        <EmptyState title="Belum ada data" hint="Bulan ini tidak ada pembayaran tercatat." />
      ) : (
        <>
          {top3.length > 0 && (
            <div className="card fade-up" style={{ overflow: 'hidden', marginBottom: 18 }}>
              <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
                <div className="section-title">Podium</div>
              </div>
              <div style={{
                display: 'grid', gap: 12,
                gridTemplateColumns: top3.length === 3 ? '1fr 1.2fr 1fr' : `repeat(${top3.length}, 1fr)`,
                alignItems: 'flex-end', padding: 24,
              }}>
                {/* Reorder so the #1 sits in the middle when we have 3. */}
                {(top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3).map(r => (
                  <PodiumCard key={r.petugasId} row={r} />
                ))}
              </div>
            </div>
          )}

          {rest.length > 0 && (
            <div className="card fade-up" style={{ overflow: 'hidden' }}>
              <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
                <div className="section-title">Peringkat 4 ke bawah</div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 50, textAlign: 'right' }}>#</th>
                    <th>Petugas</th>
                    <th>Cabang</th>
                    <th style={{ textAlign: 'right' }}>Kunjungan</th>
                    <th style={{ textAlign: 'right' }}>Tertagih</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map(r => (
                    <tr key={r.petugasId}>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ink-3)' }}>{r.rank}</td>
                      <td>
                        <div className="center gap-2">
                          <Avatar inisial={r.inisial} hue={r.hue} size={28} />
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{r.nama}</div>
                            <div className="muted mono" style={{ fontSize: 11 }}>{r.kode}</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{r.branchKode}</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.visits}</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{fmtRp(r.collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PodiumCard({ row }: { row: LeaderRow }) {
  // Visual hierarchy: gold for #1, silver for #2, bronze for #3.
  const heights: Record<number, number> = { 1: 200, 2: 170, 3: 150 };
  const palette: Record<number, { bg: string; ink: string; medal: string }> = {
    1: { bg: 'linear-gradient(180deg, oklch(0.86 0.10 90), oklch(0.78 0.13 75))',
         ink: 'oklch(0.25 0.06 65)', medal: '🥇' },
    2: { bg: 'linear-gradient(180deg, oklch(0.85 0.02 250), oklch(0.78 0.02 250))',
         ink: 'oklch(0.28 0.02 250)', medal: '🥈' },
    3: { bg: 'linear-gradient(180deg, oklch(0.78 0.08 50), oklch(0.69 0.10 45))',
         ink: 'oklch(0.25 0.07 45)', medal: '🥉' },
  };
  const p = palette[row.rank] ?? palette[3];
  const h = heights[row.rank] ?? heights[3];

  return (
    <div style={{
      background: p.bg, color: p.ink, borderRadius: 16,
      minHeight: h, padding: '18px 14px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    }}>
      <div style={{ fontSize: 28 }}>{p.medal}</div>
      <Avatar inisial={row.inisial} hue={row.hue} size={56} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{row.nama}</div>
        <div className="mono" style={{ fontSize: 11, opacity: 0.75 }}>
          {row.kode} · {row.branchKode}
        </div>
      </div>
      <div className="num" style={{ fontWeight: 800, fontSize: 18, marginTop: 'auto' }}>
        {fmtRp(row.collected)}
      </div>
      <div className="num" style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.7 }}>
        {row.visits} kunjungan
      </div>
    </div>
  );
}
