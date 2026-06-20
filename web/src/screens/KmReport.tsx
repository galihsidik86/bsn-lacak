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

interface Row {
  petugasId: string; petugasKode: string; petugasNama: string;
  branchKode: string;
  kendaraanPlat: string | null;
  kendaraanModel: string | null;
  sessions: number;
  totalKm: number;
}

interface Payload { year: number; month: number; rows: Row[] }

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function ScreenKmReport() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const q = useQuery<Payload>({
    queryKey: ['km-report', year, month],
    queryFn: async () => (await axios.get(`${BASE}/analytics/km-report`, {
      withCredentials: true, headers: headers(), params: { year, month },
    })).data,
  });

  const totalKm = (q.data?.rows ?? []).reduce((s, r) => s + r.totalKm, 0);

  return (
    <div className="grid gap-3">
      <div className="card fade-up card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Bulan</div>
        <select className="input" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 140 }}>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="input" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {q.data && (
          <div style={{ marginLeft: 'auto', fontSize: 12.5 }}>
            Total: <strong>{totalKm.toLocaleString('id-ID')} km</strong> · {q.data.rows.length} petugas
          </div>
        )}
      </div>

      {q.isLoading && <div className="card card-pad"><Skeleton h={300} /></div>}
      {q.isError && <ErrorState onRetry={() => q.refetch()} />}
      {q.data && (q.data.rows.length === 0
        ? <EmptyState title="Belum ada catatan KM bulan ini" />
        : (
          <div className="card fade-up" style={{ overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Petugas</th>
                  <th>Cabang</th>
                  <th>Kendaraan</th>
                  <th style={{ textAlign: 'right' }}>Sesi</th>
                  <th style={{ textAlign: 'right' }}>Total KM</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map(r => (
                  <tr key={r.petugasId}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{r.petugasNama}</div>
                      <div className="muted mono" style={{ fontSize: 11 }}>{r.petugasKode}</div>
                    </td>
                    <td className="muted">{r.branchKode}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {r.kendaraanPlat ? (
                        <>
                          <div style={{ fontWeight: 700 }}>{r.kendaraanPlat}</div>
                          {r.kendaraanModel && <div style={{ fontSize: 11 }}>{r.kendaraanModel}</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="num" style={{ textAlign: 'right' }}>{r.sessions}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {r.totalKm.toLocaleString('id-ID')} km
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
