import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { Avatar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface FeedbackRow {
  id: string;
  token: string;
  sentAt: string;
  rating: number | null;
  comment: string | null;
  repliedAt: string | null;
  nasabah: { kode: string; nama: string };
  petugas: { kode: string; nama: string; hue: number; inisial: string };
  branch: { nama: string };
}

interface PetugasRollup {
  since: string;
  rows: Array<{ petugasId: string; _avg: { rating: number | null }; _count: { _all: number } }>;
}

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

async function listFeedback(): Promise<FeedbackRow[]> {
  return (await axios.get(`${BASE}/feedback`, {
    params: { onlyReplied: '1' }, withCredentials: true, headers: headers(),
  })).data;
}

async function byPetugas(days: number): Promise<PetugasRollup> {
  return (await axios.get(`${BASE}/feedback/by-petugas`, {
    params: { days }, withCredentials: true, headers: headers(),
  })).data;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="num" style={{ letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} style={{ color: i <= n ? '#f5b81f' : 'var(--ink-4)' }}>★</span>
      ))}
    </span>
  );
}

export function ScreenFeedback() {
  const [filter, setFilter] = useState<'all' | 'low'>('all');
  const q = useQuery({ queryKey: ['feedback', filter], queryFn: listFeedback });
  const sumQ = useQuery({ queryKey: ['feedback-by-petugas', 90], queryFn: () => byPetugas(90) });

  const rows = (q.data ?? []).filter(r => filter === 'all' ? true : (r.rating ?? 5) <= 2);

  // Aggregate to flag persistent low-raters: ≥ 3 responses AND avg < 3.
  const lowRaters = useMemo(() => {
    if (!sumQ.data) return new Set<string>();
    const set = new Set<string>();
    for (const r of sumQ.data.rows) {
      const avg = r._avg.rating ?? null;
      if (avg !== null && r._count._all >= 3 && avg < 3) set.add(r.petugasId);
    }
    return set;
  }, [sumQ.data]);

  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;

  const avg = rows.length === 0 ? null : rows.reduce((s, r) => s + (r.rating ?? 0), 0) / rows.length;

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="seg">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Semua</button>
            <button className={filter === 'low' ? 'on' : ''} onClick={() => setFilter('low')}>Rating ≤ 2</button>
          </div>
        </div>
        <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
          <div className="chip"><Ic.clipboard size={13} />{rows.length} balasan</div>
          {avg !== null && (
            <div className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
              <span style={{ color: '#f5b81f' }}>★</span>
              <span className="num" style={{ fontWeight: 800 }}>{avg.toFixed(2)}</span>
              <span className="muted" style={{ marginLeft: 4 }}>rata-rata</span>
            </div>
          )}
          {lowRaters.size > 0 && (
            <div className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
              <Ic.alert size={13} />{lowRaters.size} petugas perlu perhatian
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card"><EmptyState title="Belum ada balasan" hint="Penilaian dari nasabah akan muncul di sini setelah mereka mengisi link SMS." /></div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {rows.map(r => (
            <div key={r.id} className="card fade-up" style={{ padding: 14 }}>
              <div className="between">
                <div className="center gap-2">
                  <Avatar inisial={r.petugas.inisial} hue={r.petugas.hue} size={28} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.petugas.nama}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>{r.petugas.kode} · {r.branch.nama}</div>
                  </div>
                </div>
                {lowRaters.has(r.petugas.kode) && (
                  <span className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
                    <Ic.alert size={11} />flagged
                  </span>
                )}
              </div>
              <div style={{ marginTop: 10, fontSize: 22 }}>
                <Stars n={r.rating ?? 0} />
              </div>
              {r.comment && (
                <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                  "{r.comment}"
                </p>
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
                Dari <strong>{r.nasabah.nama}</strong> ({r.nasabah.kode})
                {' · '}
                {r.repliedAt && new Date(r.repliedAt).toLocaleString('id-ID')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
