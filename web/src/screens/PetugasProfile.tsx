import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Ic } from '../components/Icons';
import { Avatar, Badge, Kv } from '../components/UI';
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

interface Profile {
  petugas: {
    id: string; kode: string; nama: string; inisial: string; hue: number;
    wilayah: string; hp: string; status: string; target: string | number;
    active: boolean;
    branch: { kode: string; nama: string };
    wilayahZone: { id: string; nama: string } | null;
  };
  rollup30d: {
    nasabahActive: number;
    visits: { BAYAR: number; JANJI: number; TIDAKADA: number; TOLAK: number };
    totalVisits: number;
    collected: number;
  };
  attendanceLast: { clockInAt: string; clockOutAt: string | null } | null;
  recentKunjungan: Array<{
    id: string; tanggal: string; jam: string; hasil: string;
    nominal: string | number; reviewStatus: string; riskFlags: string[];
    nasabah: { kode: string; nama: string };
  }>;
}

async function fetchProfile(id: string): Promise<Profile> {
  return (await axios.get(`${BASE}/petugas/${id}/profile`,
    { withCredentials: true, headers: headers() })).data;
}

function fmtRp(n: number): string {
  if (n >= 1_000_000_000) return 'Rp ' + (n / 1_000_000_000).toFixed(1) + ' M';
  if (n >= 1_000_000) return 'Rp ' + (n / 1_000_000).toFixed(1) + ' jt';
  if (n >= 1_000) return 'Rp ' + (n / 1_000).toFixed(0) + ' rb';
  return 'Rp ' + n.toLocaleString('id-ID');
}

const HASIL_TINT: Record<string, { bg: string; fg: string; label: string }> = {
  BAYAR: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)', label: 'Bayar' },
  JANJI: { bg: 'var(--gold-soft)', fg: 'var(--gold-ink)', label: 'Janji' },
  TIDAKADA: { bg: 'var(--surface-2)', fg: 'var(--ink-3)', label: 'Tidak ada' },
  TOLAK: { bg: 'var(--col-macet-soft)', fg: 'var(--col-macet)', label: 'Tolak' },
};

export function ScreenPetugasProfile({ petugasId, onClose }: { petugasId: string; onClose?: () => void }) {
  const q = useQuery({ queryKey: ['petugas-profile', petugasId], queryFn: () => fetchProfile(petugasId) });

  if (q.isPending) return <div className="content"><Skeleton h={500} /></div>;
  if (q.error) return <div className="content"><ErrorState onRetry={() => q.refetch()} /></div>;
  const d = q.data!;

  return (
    <div className="content" style={{ display: 'grid', gap: 18 }}>
      <div className="card card-pad fade-up">
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div className="center gap-3">
            <Avatar inisial={d.petugas.inisial} hue={d.petugas.hue} size={64} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{d.petugas.nama}</div>
              <div className="muted mono" style={{ fontSize: 12 }}>
                {d.petugas.kode} · {d.petugas.branch.kode} {d.petugas.active ? '' : '· (nonaktif)'}
              </div>
              <div style={{ marginTop: 6 }} className="center gap-2">
                <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.map}>{d.petugas.wilayah}</Badge>
                {d.petugas.wilayahZone && (
                  <Badge c="var(--sms)" soft="oklch(0.93 0.04 245)" icon={Ic.layers}>
                    Zone: {d.petugas.wilayahZone.nama}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {onClose && (
            <button className="btn btn-sm btn-ghost" onClick={onClose}><Ic.x size={14} />Tutup</button>
          )}
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
          <Kv label="No. HP" value={d.petugas.hp} />
          <Kv label="Status" value={d.petugas.status} />
          <Kv label="Target bulanan" value={fmtRp(Number(d.petugas.target))} />
          <Kv label="Cabang" value={d.petugas.branch.nama} />
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Tile icon="users" label="Nasabah aktif" value={d.rollup30d.nasabahActive} />
        <Tile icon="clipboard" label="Kunjungan 30d" value={d.rollup30d.totalVisits} />
        <Tile icon="wallet" label="Tertagih 30d" value={fmtRp(d.rollup30d.collected)} />
        <Tile icon="clock" label="Clock-in terakhir"
          value={d.attendanceLast ? new Date(d.attendanceLast.clockInAt).toLocaleString('id-ID',
            { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} />
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Komposisi Hasil 30 Hari</div>
        </div>
        <div className="grid gap-3" style={{ padding: 16, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {(Object.keys(HASIL_TINT) as Array<keyof typeof HASIL_TINT>).map(h => {
            const meta = HASIL_TINT[h];
            const v = d.rollup30d.visits[h as 'BAYAR' | 'JANJI' | 'TIDAKADA' | 'TOLAK'];
            const pct = d.rollup30d.totalVisits === 0 ? 0 : Math.round(v / d.rollup30d.totalVisits * 100);
            return (
              <div key={h} style={{ background: meta.bg, color: meta.fg, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {meta.label}
                </div>
                <div className="num" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{v}</div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>{pct}% dari total</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">10 Kunjungan Terakhir</div>
        </div>
        {d.recentKunjungan.length === 0 ? (
          <EmptyState title="Belum ada kunjungan" />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Tanggal</th><th>Nasabah</th><th>Hasil</th><th>Review</th>
                  <th style={{ textAlign: 'right' }}>Nominal</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {d.recentKunjungan.map(k => (
                <tr key={k.id}>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {new Date(k.tanggal).toLocaleDateString('id-ID',
                      { day: '2-digit', month: 'short', year: 'numeric' })} · {k.jam}
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{k.nasabah.nama}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{k.nasabah.kode}</div>
                  </td>
                  <td>
                    <span className="chip" style={{
                      background: HASIL_TINT[k.hasil]?.bg, color: HASIL_TINT[k.hasil]?.fg,
                    }}>{HASIL_TINT[k.hasil]?.label ?? k.hasil}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{k.reviewStatus}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>
                    {Number(k.nominal) > 0 ? fmtRp(Number(k.nominal)) : '—'}
                  </td>
                  <td>
                    {k.riskFlags.length === 0
                      ? <span className="muted" style={{ fontSize: 11 }}>—</span>
                      : <span className="chip" style={{
                          background: 'var(--col-macet-soft)', color: 'var(--col-macet)', fontSize: 10.5,
                        }}>{k.riskFlags.length}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: 'users' | 'clipboard' | 'wallet' | 'clock'; label: string; value: string | number }) {
  const Icon = Ic[icon];
  return (
    <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Icon size={18} />
      </div>
      <div>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          {label}
        </div>
        <div className="num" style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}
