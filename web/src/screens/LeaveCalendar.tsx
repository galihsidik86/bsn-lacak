import { useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
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

interface CalendarRow {
  id: string;
  petugas: { id: string; kode: string; nama: string; branch: { id: string; kode: string; nama: string } };
  type: 'cuti_tahunan' | 'sakit' | 'dinas_luar' | 'lain';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  startDate: string;
  endDate: string;
  substitute: { id: string; kode: string; nama: string } | null;
  covered: boolean;
}

interface CalendarPayload {
  rangeStart: string;
  rangeEnd: string;
  days: number;
  rows: CalendarRow[];
}

const TYPE_LABEL: Record<CalendarRow['type'], string> = {
  cuti_tahunan: 'Cuti Tahunan',
  sakit: 'Sakit',
  dinas_luar: 'Dinas Luar',
  lain: 'Lainnya',
};

const TYPE_COLOR: Record<CalendarRow['type'], { bg: string; fg: string }> = {
  cuti_tahunan: { bg: 'oklch(0.93 0.05 200)', fg: 'oklch(0.35 0.13 200)' },
  sakit: { bg: 'oklch(0.93 0.05 30)', fg: 'oklch(0.4 0.15 30)' },
  dinas_luar: { bg: 'oklch(0.93 0.05 290)', fg: 'oklch(0.4 0.13 290)' },
  lain: { bg: 'oklch(0.93 0.02 0)', fg: 'oklch(0.4 0.02 0)' },
};

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

function buildDayList(start: Date, days: number): Date[] {
  const list: Date[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    list.push(d);
  }
  return list;
}

export function ScreenLeaveCalendar() {
  const [days, setDays] = useState(30);
  const [includePending, setIncludePending] = useState(false);

  const q = useQuery<CalendarPayload>({
    queryKey: ['leave-calendar', days, includePending],
    queryFn: async () => (await axios.get(`${BASE}/leaves/calendar`, {
      withCredentials: true, headers: headers(),
      params: { days, includePending: includePending ? 1 : 0 },
    })).data,
  });

  return (
    <div className="grid gap-3">
      <div className="card fade-up">
        <div className="card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Window</div>
          <select className="input" value={days} onChange={e => setDays(Number(e.target.value))} style={{ width: 140 }}>
            <option value={14}>14 hari</option>
            <option value={30}>30 hari</option>
            <option value={60}>60 hari</option>
            <option value={90}>90 hari</option>
          </select>
          <label className="center gap-2" style={{ fontSize: 12.5, fontWeight: 600 }}>
            <input type="checkbox" checked={includePending} onChange={e => setIncludePending(e.target.checked)} />
            Tampilkan pending
          </label>
          <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
            <Ic.alert size={12} style={{ verticalAlign: '-2px' }} /> Baris merah = belum ada substitute coverage.
          </div>
        </div>
      </div>

      {q.isLoading && <div className="card card-pad"><Skeleton h={300} /></div>}
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data && (q.data.rows.length === 0
        ? <EmptyState title="Tidak ada cuti pada window ini" />
        : <CalendarGrid data={q.data} />)}
    </div>
  );
}

function CalendarGrid({ data }: { data: CalendarPayload }) {
  const start = new Date(data.rangeStart);
  start.setHours(0, 0, 0, 0);
  const dayList = buildDayList(start, data.days);
  const cellW = 28;

  return (
    <div className="card fade-up" style={{ overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 240 + cellW * data.days }}>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, background: 'var(--surface-1)', borderBottom: '1px solid var(--line)', padding: '10px 12px', textAlign: 'left', minWidth: 240, zIndex: 1 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--ink-3)' }}>
                Petugas
              </div>
            </th>
            {dayList.map((d, i) => {
              const dow = d.getDay();
              const isWeekend = dow === 0 || dow === 6;
              return (
                <th key={i} style={{
                  borderBottom: '1px solid var(--line)', width: cellW, padding: '6px 0', textAlign: 'center',
                  background: isWeekend ? 'var(--surface-2)' : undefined,
                  fontSize: 10, fontWeight: 700, color: 'var(--ink-3)',
                }}>
                  <div>{d.getDate()}</div>
                  <div style={{ fontSize: 9 }}>{d.toLocaleDateString('id-ID', { month: 'short' })}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => {
            const rowStart = new Date(row.startDate);
            const rowEnd = new Date(row.endDate);
            rowStart.setHours(0, 0, 0, 0);
            rowEnd.setHours(0, 0, 0, 0);
            const color = TYPE_COLOR[row.type];
            const accent = row.covered ? color : { bg: 'oklch(0.93 0.07 25)', fg: 'oklch(0.4 0.16 25)' };
            return (
              <tr key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--surface-1)', padding: '10px 12px', zIndex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{row.petugas.kode} · {row.petugas.nama}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                    {row.petugas.branch.kode} · {TYPE_LABEL[row.type]}
                    {row.status === 'pending' && <span style={{ marginLeft: 6, color: 'var(--col-macet)' }}>(pending)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                    {row.covered
                      ? <>Substitute: <strong>{row.substitute?.kode} · {row.substitute?.nama}</strong></>
                      : <span style={{ color: 'var(--col-macet)', fontWeight: 600 }}>Tidak ada substitute</span>}
                  </div>
                </td>
                {dayList.map((d, i) => {
                  const dInRange = d >= rowStart && d <= rowEnd;
                  const isStart = ymd(d) === ymd(rowStart);
                  const isEnd = ymd(d) === ymd(rowEnd);
                  const dow = d.getDay();
                  const weekendBg = (dow === 0 || dow === 6) ? 'var(--surface-2)' : undefined;
                  return (
                    <td key={i} style={{ width: cellW, height: 36, padding: 0, background: weekendBg, position: 'relative' }}>
                      {dInRange && (
                        <div style={{
                          position: 'absolute',
                          top: 8, bottom: 8,
                          left: isStart ? 2 : 0,
                          right: isEnd ? 2 : 0,
                          background: accent.bg, color: accent.fg,
                          borderTopLeftRadius: isStart ? 6 : 0,
                          borderBottomLeftRadius: isStart ? 6 : 0,
                          borderTopRightRadius: isEnd ? 6 : 0,
                          borderBottomRightRadius: isEnd ? 6 : 0,
                          fontSize: 10, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: row.status === 'pending' ? 0.55 : 1,
                        }} />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
