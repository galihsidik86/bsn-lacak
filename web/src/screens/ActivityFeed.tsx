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

type ActivityType = 'kunjungan.created' | 'kunjungan.reviewed' | 'pembayaran.received' | 'blast.completed' | 'audit';
interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: string;
  branchKode: string;
  actor: string;
  summary: string;
  link?: string;
}

async function fetchFeed(days: number): Promise<{ windowDays: number; items: ActivityItem[] }> {
  return (await axios.get(`${BASE}/activity/feed?days=${days}&limit=200`,
    { withCredentials: true, headers: headers() })).data;
}

const TYPE_META: Record<ActivityType, { icon: 'clipboard' | 'check' | 'wallet' | 'send' | 'eye'; tint: string; label: string }> = {
  'kunjungan.created':  { icon: 'clipboard', tint: 'var(--accent)',   label: 'Kunjungan' },
  'kunjungan.reviewed': { icon: 'check',     tint: 'var(--col-dpk)',  label: 'Review' },
  'pembayaran.received':{ icon: 'wallet',    tint: 'var(--gold-ink)', label: 'Pembayaran' },
  'blast.completed':    { icon: 'send',      tint: 'var(--sms)',      label: 'Blast' },
  'audit':              { icon: 'eye',       tint: 'var(--ink-3)',    label: 'Audit' },
};

function groupByDay(items: ActivityItem[]): Array<{ day: string; items: ActivityItem[] }> {
  const map = new Map<string, ActivityItem[]>();
  for (const it of items) {
    const d = new Date(it.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, arr]) => ({ day, items: arr }));
}

function dayLabel(key: string): string {
  const d = new Date(key + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff === 0) return 'Hari ini';
  if (diff === -1) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ScreenActivityFeed() {
  const [days, setDays] = useState<1 | 3 | 7 | 14>(7);
  const q = useQuery({ queryKey: ['activity', days], queryFn: () => fetchFeed(days) });

  if (q.isPending) return <div className="content"><Skeleton h={500} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const items = q.data?.items ?? [];
  if (items.length === 0) {
    return <div className="content"><EmptyState title="Tidak ada aktivitas pada window ini" hint={`Coba perbesar jendela waktu.`} /></div>;
  }
  const groups = groupByDay(items);

  return (
    <div className="content">
      <div className="between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div className="chip"><Ic.send size={14} />{items.length} kejadian</div>
        <div className="seg" role="tablist">
          {([1, 3, 7, 14] as const).map(d => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d === 1 ? 'Hari ini' : `${d} hari`}
            </button>
          ))}
        </div>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px' }}>
          {groups.map(g => (
            <div key={g.day} style={{ marginBottom: 18 }}>
              <div className="muted" style={{
                fontSize: 11.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
                marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--line)',
              }}>
                {dayLabel(g.day)}
                <span className="num" style={{ marginLeft: 6, color: 'var(--ink-3)' }}>· {g.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {g.items.map(it => {
                  const meta = TYPE_META[it.type];
                  const Icon = Ic[meta.icon];
                  const ts = new Date(it.timestamp).toLocaleTimeString('id-ID',
                    { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={it.id} style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                      padding: '10px 4px', borderBottom: '1px solid var(--line)',
                    }}>
                      <div style={{
                        width: 30, height: 30, flex: 'none', borderRadius: 99,
                        display: 'grid', placeItems: 'center',
                        background: 'var(--surface-2)', color: meta.tint,
                      }}>
                        <Icon size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>
                          {it.summary}
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {ts} · {it.actor} · <span className="mono">{it.branchKode}</span>
                        </div>
                      </div>
                      <span className="chip" style={{
                        background: 'var(--surface-2)', color: meta.tint, fontSize: 10,
                      }}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
