import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Health {
  generatedAt: string;
  db: { ok: boolean; latencyMs: number | null };
  workers: Record<string, string | null>;
  queues: {
    pendingReviews: number;
    pendingWebhooks: number;
    deadLetterWebhooks: number;
    archivedTotal: number;
  };
  process: {
    uptimeSeconds: number;
    nodeVersion: string;
    rssMb: number;
    heapUsedMb: number;
    loadAvg1m: number;
  };
  env: {
    nodeEnv: string;
    archiveAfterDays: number;
    slaPendingHours: number;
    morningReminderEnabled: boolean;
  };
}

async function fetchHealth(): Promise<Health> {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  return (await axios.get(`${BASE}/system-health`, {
    withCredentials: true, headers: h,
  })).data;
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}j`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'belum pernah';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  return `${Math.round(hrs / 24)}h lalu`;
}

const WORKER_LABELS: Record<string, string> = {
  'morning_reminder.sent': 'Morning reminder',
  'closing.email_sent': 'Closing email',
  'kunjungan.archive_sweep': 'Archive sweep',
  'sla.pending_breach': 'SLA pending alert',
};

export function ScreenSystemHealth() {
  const q = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  });
  if (q.isPending) return <div className="content"><Skeleton h={400} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const d = q.data!;

  return (
    <div className="content" style={{ display: 'grid', gap: 18 }}>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Tile
          icon="layers"
          label="Database"
          value={d.db.ok ? `OK · ${d.db.latencyMs}ms` : 'DOWN'}
          tint={d.db.ok ? 'var(--accent)' : 'var(--col-macet)'}
        />
        <Tile icon="clock" label="Uptime" value={fmtUptime(d.process.uptimeSeconds)} />
        <Tile icon="trend" label="Heap / RSS" value={`${d.process.heapUsedMb}/${d.process.rssMb} MB`} />
        <Tile icon="chart" label="Load avg 1m" value={d.process.loadAvg1m.toFixed(2)} />
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Tile icon="clipboard" label="Pending review"
          value={d.queues.pendingReviews}
          tint={d.queues.pendingReviews > 50 ? 'var(--col-macet)' : 'var(--ink-2)'} />
        <Tile icon="send" label="Webhook pending"
          value={d.queues.pendingWebhooks}
          tint={d.queues.pendingWebhooks > 20 ? 'var(--gold-ink)' : 'var(--ink-2)'} />
        <Tile icon="alert" label="Webhook dead-letter"
          value={d.queues.deadLetterWebhooks}
          tint={d.queues.deadLetterWebhooks > 0 ? 'var(--col-macet)' : 'var(--ink-2)'} />
        <Tile icon="download" label="Archived total" value={d.queues.archivedTotal} />
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Worker Activity (last touch)</div>
          <div className="page-sub">Timestamp dari audit log per worker action.</div>
        </div>
        <table className="table">
          <thead><tr><th>Worker</th><th>Last fired</th><th style={{ textAlign: 'right' }}>Status</th></tr></thead>
          <tbody>
            {Object.entries(d.workers).map(([k, v]) => {
              const fresh = v && (Date.now() - new Date(v).getTime() < 25 * 60 * 60_000);
              return (
                <tr key={k}>
                  <td><span style={{ fontWeight: 700 }}>{WORKER_LABELS[k] ?? k}</span>
                    <span className="muted mono" style={{ fontSize: 11, marginLeft: 8 }}>{k}</span></td>
                  <td className="muted mono" style={{ fontSize: 11.5 }}>
                    {v ?? '—'} {v && <span style={{ opacity: 0.7 }}>· {fmtRelative(v)}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="chip" style={{
                      background: fresh ? 'var(--accent-soft)' : 'var(--surface-2)',
                      color: fresh ? 'var(--accent-ink)' : 'var(--ink-3)',
                      fontSize: 11,
                    }}>{fresh ? 'Fresh' : 'Stale'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card fade-up card-pad">
        <div className="section-title" style={{ marginBottom: 10 }}>Config</div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Kv label="NODE_ENV" value={d.env.nodeEnv} />
          <Kv label="ARCHIVE_AFTER_DAYS" value={`${d.env.archiveAfterDays}d`} />
          <Kv label="SLA_PENDING_HOURS" value={`${d.env.slaPendingHours}j`} />
          <Kv label="MORNING_REMINDER" value={d.env.morningReminderEnabled ? 'aktif' : 'mati'} />
        </div>
        <div className="muted mono" style={{ fontSize: 11, marginTop: 12 }}>
          Snapshot {new Date(d.generatedAt).toLocaleTimeString('id-ID')} · refresh 15s · Node {d.process.nodeVersion}
        </div>
      </div>

      {!d.db.ok && (
        <EmptyState title="Database tidak respon"
          hint="Cek koneksi PostgreSQL, kemudian refresh halaman." />
      )}
    </div>
  );
}

function Tile({ icon, label, value, tint }: {
  icon: 'layers' | 'clock' | 'trend' | 'chart' | 'clipboard' | 'send' | 'alert' | 'download';
  label: string; value: string | number; tint?: string;
}) {
  const Icon = Ic[icon];
  return (
    <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: tint ?? 'var(--accent)' }}>
        <Icon size={18} />
      </div>
      <div>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {label}
        </div>
        <div className="num" style={{ fontWeight: 800, fontSize: 18, marginTop: 2, color: tint }}>{value}</div>
      </div>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div className="num" style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}
