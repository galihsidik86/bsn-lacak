import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { Avatar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import { downloadAuthed } from '../lib/download';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface RevenuePoint {
  month: string;
  branchId: string;
  branchKode: string;
  branchNama: string;
  amount: number;
  paymentCount: number;
}
interface LeaderRow {
  petugasId: string;
  kode: string;
  nama: string;
  branchNama: string;
  totalCollected: number;
  visits: number;
  uniqueNasabah: number;
}
interface PosturePoint { kol: 'K1' | 'K2' | 'K3' | 'K4' | 'K5'; count: number; outstanding: number }
interface Overview { revenue: RevenuePoint[]; leaderboard: LeaderRow[]; posture: PosturePoint[] }

function headers(): Record<string, string> {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

async function fetchOverview(months: number, days: number): Promise<Overview> {
  return (await axios.get(`${BASE}/analytics/overview`, {
    params: { months, days }, withCredentials: true, headers: headers(),
  })).data;
}

interface RacePoint { month: string; petugasId: string; collected: number }
interface RacePetugas { id: string; kode: string; nama: string; hue: number; branchKode: string; total: number }
interface RaceResponse { months: string[]; petugas: RacePetugas[]; points: RacePoint[] }
async function fetchRace(months: number): Promise<RaceResponse> {
  return (await axios.get(`${BASE}/analytics/petugas-race`, {
    params: { months }, withCredentials: true, headers: headers(),
  })).data;
}

function fmtRpJt(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + ' M';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' jt';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + ' rb';
  return String(n);
}
function fmtMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
}

const KOL_LABEL: Record<PosturePoint['kol'], string> = {
  K1: 'Lancar', K2: 'DPK', K3: 'Kurang Lancar', K4: 'Diragukan', K5: 'Macet',
};
const KOL_COLOR: Record<PosturePoint['kol'], string> = {
  K1: 'var(--accent)', K2: 'var(--col-dpk)', K3: 'var(--gold)', K4: '#c39b1d', K5: 'var(--col-macet)',
};

export function ScreenAnalytics() {
  const [months, setMonths] = useState(6);
  const [days, setDays] = useState(30);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const q = useQuery({
    queryKey: ['analytics-overview', months, days],
    queryFn: () => fetchOverview(months, days),
  });

  const overview = q.data;
  const byMonthBranch = useMemo(() => {
    if (!overview) return new Map<string, Map<string, RevenuePoint>>();
    const m = new Map<string, Map<string, RevenuePoint>>();
    for (const p of overview.revenue) {
      if (!m.has(p.month)) m.set(p.month, new Map());
      m.get(p.month)!.set(p.branchId, p);
    }
    return m;
  }, [overview]);
  const branches = useMemo(() => {
    if (!overview) return [] as { id: string; nama: string }[];
    const seen = new Map<string, string>();
    for (const p of overview.revenue) seen.set(p.branchId, p.branchNama);
    return [...seen.entries()].map(([id, nama]) => ({ id, nama }));
  }, [overview]);

  const monthKeys = useMemo(() => [...byMonthBranch.keys()].sort(), [byMonthBranch]);
  const monthlyTotals = monthKeys.map(m => ({
    month: m,
    total: branches.reduce((s, b) => s + (byMonthBranch.get(m)?.get(b.id)?.amount ?? 0), 0),
  }));
  const maxMonthly = Math.max(1, ...monthlyTotals.map(p => p.total));

  const downloadClosing = async () => {
    await downloadAuthed(
      `/analytics/closing.csv?year=${year}&month=${month}`,
      `closing-${year}-${String(month).padStart(2, '0')}.csv`,
    );
  };

  if (q.isPending) return <div className="content" style={{ display: 'grid', gap: 16 }}><Skeleton h={300} /><Skeleton h={300} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  if (!overview) return <div className="content"><EmptyState title="Tidak ada data" /></div>;

  const totalRevenue = overview.revenue.reduce((s, r) => s + r.amount, 0);
  const totalVisitsWindow = overview.leaderboard.reduce((s, r) => s + r.visits, 0);
  const totalOutstanding = overview.posture.reduce((s, p) => s + p.outstanding, 0);
  const totalNasabah = overview.posture.reduce((s, p) => s + p.count, 0);

  return (
    <div className="content">
      <div className="stat-grid fade-up" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
        <Card icon="wallet" label="Tertagih (window)" value={'Rp ' + fmtRpJt(totalRevenue)} sub={`${months} bulan terakhir`} />
        <Card icon="clipboard" label="Kunjungan (window)" value={String(totalVisitsWindow)} sub={`${days} hari terakhir`} />
        <Card icon="users" label="Nasabah Aktif" value={String(totalNasabah)} sub="binaan aktif" />
        <Card icon="alert" label="Outstanding" value={'Rp ' + fmtRpJt(totalOutstanding)} sub="sisa pokok" />
      </div>

      <div className="card fade-up" style={{ marginBottom: 20 }}>
        <div className="between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Tren Penagihan Bulanan</div>
          <div className="seg">
            {[3, 6, 12].map(m => (
              <button key={m} className={months === m ? 'on' : ''} onClick={() => setMonths(m)}>{m} bln</button>
            ))}
          </div>
        </div>
        <div style={{ padding: 18 }}>
          {monthlyTotals.length === 0 ? (
            <EmptyState title="Belum ada pembayaran di window ini" />
          ) : (
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', minHeight: 200 }}>
              {monthlyTotals.map(p => (
                <div key={p.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div className="num" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>
                    {fmtRpJt(p.total)}
                  </div>
                  <div style={{
                    width: '100%', maxWidth: 56,
                    height: `${Math.max(4, (p.total / maxMonthly) * 160)}px`,
                    background: 'linear-gradient(180deg, var(--accent), var(--accent-700))',
                    borderRadius: '6px 6px 0 0',
                  }} />
                  <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{fmtMonth(p.month)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', marginBottom: 20 }}>
        <div className="card fade-up">
          <div className="between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
            <div className="section-title">Leaderboard Petugas</div>
            <div className="seg">
              {[7, 30, 90].map(d => (
                <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} hari</button>
              ))}
            </div>
          </div>
          {overview.leaderboard.length === 0 ? (
            <div style={{ padding: 24 }}><EmptyState title="Belum ada data" hint="Pembayaran belum masuk pada window ini." /></div>
          ) : (
            <table className="table">
              <thead><tr>
                <th style={{ width: 40 }}>#</th><th>Petugas</th><th style={{ textAlign: 'right' }}>Tertagih</th>
                <th style={{ textAlign: 'right' }}>Kunjungan</th><th style={{ textAlign: 'right' }}>Binaan</th>
              </tr></thead>
              <tbody>
                {overview.leaderboard.map((r, i) => (
                  <tr key={r.petugasId}>
                    <td className="num" style={{ fontWeight: 800, color: i < 3 ? 'var(--accent)' : 'var(--ink-3)' }}>
                      {i + 1}
                    </td>
                    <td>
                      <div className="center gap-2">
                        <Avatar inisial={r.nama.slice(0, 2).toUpperCase()} hue={(r.kode.charCodeAt(0) * 17) % 360} size={26} />
                        <div>
                          <div style={{ fontWeight: 700 }}>{r.nama}</div>
                          <div className="muted mono" style={{ fontSize: 11 }}>{r.kode} · {r.branchNama}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }} className="num" >{'Rp ' + fmtRpJt(r.totalCollected)}</td>
                    <td style={{ textAlign: 'right' }} className="num">{r.visits}</td>
                    <td style={{ textAlign: 'right' }} className="num">{r.uniqueNasabah}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card fade-up">
          <div className="card-pad" style={{ paddingBottom: 8 }}><div className="section-title">Postur Kolektabilitas</div></div>
          <div style={{ padding: '0 18px 18px' }}>
            {overview.posture.length === 0 ? <EmptyState title="—" /> : overview.posture.map(p => {
              const pct = totalNasabah > 0 ? (p.count / totalNasabah) * 100 : 0;
              return (
                <div key={p.kol} style={{ marginBottom: 12 }}>
                  <div className="between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{p.kol} · {KOL_LABEL[p.kol]}</span>
                    <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>
                      {p.count} · <span className="muted">Rp {fmtRpJt(p.outstanding)}</span>
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: KOL_COLOR[p.kol] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card fade-up">
        <div className="between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Closing Bulanan (Excel CSV)</div>
          <div className="center gap-2">
            <select className="input" style={{ width: 'auto' }} value={month} onChange={e => setMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleDateString('id-ID', { month: 'long' })}
                </option>
              ))}
            </select>
            <input className="input" type="number" min={2024} max={year + 1} value={year}
              onChange={e => setYear(Number(e.target.value))} style={{ width: 96 }} />
            <button className="btn btn-primary" onClick={downloadClosing}>
              <Ic.download size={15} />Unduh CSV
            </button>
          </div>
        </div>
        <div className="muted" style={{ padding: '14px 18px', fontSize: 12.5, lineHeight: 1.6 }}>
          File CSV satu baris per (cabang × petugas) untuk bulan yang dipilih — kunjungan, status review, nasabah unik dikunjungi,
          dan total nominal tertagih. Buka langsung di Excel (UTF-8 + BOM untuk huruf indonesia).
        </div>
      </div>

      <PetugasRacePanel months={months} />
    </div>
  );
}

function PetugasRacePanel({ months }: { months: number }) {
  const q = useQuery({
    queryKey: ['petugas-race', months],
    queryFn: () => fetchRace(months),
  });
  const [hovered, setHovered] = useState<string | null>(null);

  if (q.isPending) return <div className="card fade-up" style={{ marginTop: 20 }}><Skeleton h={320} /></div>;
  if (q.error) return null;
  const data = q.data!;
  if (data.petugas.length === 0) return null;

  // Project month + collected into a 1000×260 SVG canvas.
  const W = 1000, H = 260, PAD_L = 56, PAD_R = 18, PAD_T = 18, PAD_B = 32;
  const maxV = Math.max(1, ...data.points.map(p => p.collected));
  const xStep = (W - PAD_L - PAD_R) / Math.max(1, data.months.length - 1);
  const yFor = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / maxV);
  const xFor = (m: string) => PAD_L + data.months.indexOf(m) * xStep;

  const byPet = new Map<string, RacePoint[]>();
  for (const p of data.points) {
    const arr = byPet.get(p.petugasId) ?? [];
    arr.push(p);
    byPet.set(p.petugasId, arr);
  }
  // Ensure every petugas has a value for every month (treat missing as 0).
  for (const pet of data.petugas) {
    const seen = new Set((byPet.get(pet.id) ?? []).map(p => p.month));
    const filled = data.months.map(m => {
      const existing = (byPet.get(pet.id) ?? []).find(p => p.month === m);
      return existing ?? { month: m, petugasId: pet.id, collected: seen.has(m) ? existing!.collected : 0 };
    });
    byPet.set(pet.id, filled);
  }

  return (
    <div className="card fade-up" style={{ marginTop: 20, overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <div className="section-title">Race Chart — Tertagih per Petugas</div>
        <div className="page-sub">Top {data.petugas.length} petugas, {data.months.length} bulan terakhir. Hover sebuah nama / garis untuk highlight.</div>
      </div>
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 280, display: 'block' }}
          onMouseLeave={() => setHovered(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map(t => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yFor(maxV * t)} y2={yFor(maxV * t)}
                stroke="var(--line)" strokeWidth={1} strokeDasharray={t === 0 ? '0' : '4 4'} />
              <text x={PAD_L - 8} y={yFor(maxV * t) + 3} textAnchor="end"
                fontSize={10} fill="var(--ink-3)">{fmtRpJt(maxV * t)}</text>
            </g>
          ))}
          {data.months.map(m => (
            <text key={m} x={xFor(m)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
              {fmtMonth(m)}
            </text>
          ))}
          {data.petugas.map(pet => {
            const pts = byPet.get(pet.id) ?? [];
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.month)} ${yFor(p.collected)}`).join(' ');
            const isHovered = hovered === pet.id;
            const isOther = hovered && hovered !== pet.id;
            return (
              <g key={pet.id} onMouseEnter={() => setHovered(pet.id)}>
                <path d={d} fill="none"
                  stroke={`hsl(${pet.hue}, 60%, 50%)`}
                  strokeWidth={isHovered ? 3 : 1.8}
                  strokeOpacity={isOther ? 0.18 : 1}
                  strokeLinecap="round" strokeLinejoin="round" />
                {pts.map(p => (
                  <circle key={p.month} cx={xFor(p.month)} cy={yFor(p.collected)}
                    r={isHovered ? 3.5 : 2}
                    fill={`hsl(${pet.hue}, 60%, 50%)`}
                    fillOpacity={isOther ? 0.2 : 1} />
                ))}
              </g>
            );
          })}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
          {data.petugas.map(pet => {
            const isHovered = hovered === pet.id;
            return (
              <div key={pet.id}
                onMouseEnter={() => setHovered(pet.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                  borderRadius: 8, cursor: 'pointer',
                  background: isHovered ? 'var(--surface-2)' : 'transparent',
                }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: `hsl(${pet.hue}, 60%, 50%)`,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pet.nama}
                  </div>
                  <div className="muted mono" style={{ fontSize: 10.5 }}>{pet.kode} · {pet.branchKode}</div>
                </div>
                <div className="num" style={{ fontSize: 11, fontWeight: 700 }}>{fmtRpJt(pet.total)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({ icon, label, value, sub }: { icon: 'wallet' | 'clipboard' | 'users' | 'alert'; label: string; value: string; sub: string }) {
  const Icon = Ic[icon];
  return (
    <div className="card card-pad">
      <div className="center gap-3">
        <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', width: 38, height: 38 }}>
          <Icon size={18} />
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
          <div className="num" style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>{value}</div>
          <div className="muted" style={{ fontSize: 11 }}>{sub}</div>
        </div>
      </div>
    </div>
  );
}
