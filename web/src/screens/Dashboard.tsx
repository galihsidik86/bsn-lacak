import { useMemo } from 'react';
import { BranchComparison } from '../components/BranchComparison';
import { Ic } from '../components/Icons';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  Avatar, AreaChart, Donut, HBars, Stat, cssVar,
} from '../components/UI';
import {
  HASIL_KUNJUNGAN, KOL, RP, RPjt,
  useDataStatus, useKunjunganList, useNasabahFinder, useNasabahList, useNpl, usePayflow,
  usePetugasFinder, usePetugasList, usePostur, useTotalOutstanding,
} from '../data/queries';
import { useAuth } from '../lib/auth';
import { useLiveCounter } from '../lib/useLiveCounter';
import type { KolKey } from '../types';

export function ScreenDashboard({ go }: { go: (k: string) => void }) {
  const { data: NASABAH } = useNasabahList();
  const { data: PETUGAS } = usePetugasList();
  const { data: KUNJUNGAN } = useKunjunganList();
  const { data: PAYFLOW } = usePayflow();
  const POSTUR = usePostur();
  const TOTAL_OUTSTANDING = useTotalOutstanding();
  const NPL = useNpl();
  const petugasById = usePetugasFinder();
  const nasabahById = useNasabahFinder();
  const status = useDataStatus();
  const role = useAuth(s => s.user?.role);
  const branchOverride = useAuth(s => s.branchOverride);
  // Cross-branch card is only meaningful when the ADMIN is not already
  // scoped to a single branch — otherwise the comparison collapses to one row.
  const showComparison = role === 'ADMIN' && !branchOverride;
  const setOverride = useAuth(s => s.setBranchOverride);

  // Live event counters — tick whenever the API broadcasts the matching SSE
  // topic. `fresh` is true for a few seconds after the latest event so the
  // tile pulses, then settles back to a quiet chip.
  const liveCreated = useLiveCounter('kunjungan.created');
  const liveReviewed = useLiveCounter('kunjungan.reviewed');

  // Derive directly instead of state+effect — usePostur() returns a fresh
  // object every render, so an effect keyed on it would re-fire forever.
  const donut = useMemo(
    () => ([1, 2, 3, 4, 5] as KolKey[]).map(k => ({
      label: KOL[k].label, value: POSTUR[k].n, color: cssVar(KOL[k].c),
    })),
    // POSTUR identity changes each render but its content is stable per dataset;
    // serialize the counts to a primitive key so memo only invalidates on
    // genuine data change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [POSTUR[1].n, POSTUR[2].n, POSTUR[3].n, POSTUR[4].n, POSTUR[5].n],
  );

  if (status.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={120} />)}
        <div style={{ gridColumn: '1 / -1' }}><Skeleton h={280} /></div>
        <div style={{ gridColumn: '1 / -1' }}><Skeleton h={200} /></div>
      </div>
    );
  }
  if (status.isError) {
    return <div className="content"><ErrorState onRetry={() => location.reload()} /></div>;
  }
  if (status.isEmpty) {
    return (
      <div className="content">
        <EmptyState title="Belum ada data nasabah / petugas"
          hint="Jalankan seed atau tambahkan data dari menu Distribusi untuk mulai." />
      </div>
    );
  }

  const totalNasabah = NASABAH.length;
  const lapangan = PETUGAS.filter(p => p.status === 'lapangan').length;
  const terkumpulHari = PETUGAS.reduce((s, p) => s + p.terkumpul, 0);
  const targetHari = PETUGAS.reduce((s, p) => s + p.target, 0);
  const kunjunganHari = PETUGAS.reduce((s, p) => s + p.kunjungan, 0);

  const topPetugas = [...PETUGAS].sort((a, b) => b.terkumpul - a.terkumpul).slice(0, 5).map(p => ({
    label: p.nama, value: p.terkumpul,
    avatar: <Avatar inisial={p.inisial} hue={p.hue} size={26} />,
  }));

  return (
    <div className="content">
      {showComparison && <BranchComparison onPickBranch={(id) => setOverride(id)} />}
      <div className="stat-grid fade-up" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <Stat icon={Ic.wallet} label="Outstanding Pembiayaan" value={RPjt(TOTAL_OUTSTANDING)} delta="2,1%" deltaDir="up" sub="vs bulan lalu" />
        <Stat icon={Ic.alert} label="NPL (Col 3–5)" value={NPL.toFixed(2) + '%'} delta="0,4%" deltaDir="down" tint="var(--col-macet)" soft="var(--col-macet-soft)" sub="membaik" />
        <div style={{ position: 'relative' }}>
          <Stat icon={Ic.wallet} label="Tertagih Hari Ini" value={RPjt(terkumpulHari)} delta={Math.round(terkumpulHari / targetHari * 100) + '%'} deltaDir="up" sub={'dari ' + RPjt(targetHari)} />
          {liveReviewed.count > 0 && <LivePill fresh={liveReviewed.fresh} count={liveReviewed.count} label="review" />}
        </div>
        <div style={{ position: 'relative' }}>
          <Stat icon={Ic.route} label="Petugas di Lapangan" value={lapangan + ' / ' + PETUGAS.length} tint="var(--sms)" soft="oklch(0.93 0.04 245)" sub={kunjunganHari + ' kunjungan hari ini'} />
          {liveCreated.count > 0 && <LivePill fresh={liveCreated.fresh} count={liveCreated.count} label="baru" />}
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1.15fr 1fr', marginBottom: 16 }}>
        <div className="card card-pad fade-up">
          <div className="between" style={{ marginBottom: 4 }}>
            <div>
              <div className="section-title">Postur Kolektabilitas</div>
              <div className="page-sub">Komposisi {totalNasabah} nasabah binaan</div>
            </div>
            <button className="btn btn-sm" onClick={() => go('kolektabilitas')}>Detail<Ic.arrowRight size={14} /></button>
          </div>
          <div className="center gap-6" style={{ marginTop: 14 }}>
            <Donut data={donut} centerLabel={totalNasabah} centerSub="nasabah" />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {([1, 2, 3, 4, 5] as KolKey[]).map(k => {
                const pct = (POSTUR[k].n / totalNasabah * 100);
                return (
                  <div key={k} className="between" style={{ gap: 10 }}>
                    <div className="center gap-2" style={{ minWidth: 116 }}>
                      <span className="dot" style={{ background: KOL[k].c, width: 10, height: 10 }} />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{KOL[k].label}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 700 }}>{KOL[k].short}</span>
                    </div>
                    <div style={{ flex: 1 }} className="progress">
                      <span style={{ width: pct + '%', background: KOL[k].c }} />
                    </div>
                    <span className="num" style={{ fontWeight: 700, fontSize: 13, minWidth: 28, textAlign: 'right' }}>{POSTUR[k].n}</span>
                    <span className="num muted" style={{ fontSize: 11.5, minWidth: 64, textAlign: 'right', fontWeight: 600 }}>{RPjt(POSTUR[k].nom)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card card-pad fade-up">
          <div className="between" style={{ marginBottom: 12 }}>
            <div>
              <div className="section-title">Pergerakan Pembayaran Angsuran</div>
              <div className="page-sub">14 hari terakhir · nominal harian</div>
            </div>
            <span className="chip"><span className="dot" style={{ background: 'var(--col-dpk)' }} />Target harian</span>
          </div>
          <AreaChart data={PAYFLOW} valueKey="nominal" targetKey="target" fmt={RPjt} h={208} />
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
        <div className="card card-pad fade-up">
          <div className="between" style={{ marginBottom: 16 }}>
            <div className="section-title">Perolehan per Petugas</div>
            <button className="btn-ghost btn btn-sm" onClick={() => go('tracking')}>Lihat peta</button>
          </div>
          <HBars items={topPetugas} fmt={RPjt} />
        </div>

        <div className="card fade-up">
          <div className="between card-pad" style={{ paddingBottom: 8 }}>
            <div className="section-title">Aktivitas Kunjungan Terbaru</div>
            <button className="btn-ghost btn btn-sm" onClick={() => go('laporan')}>Semua laporan</button>
          </div>
          <div style={{ padding: '0 8px 8px' }}>
            <table className="table">
              <tbody>
                {KUNJUNGAN.slice(0, 5).map(k => (
                  <KunjunganRow key={k.id} k={k}
                    petugasById={petugasById} nasabahById={nasabahById} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function KunjunganRow({ k, petugasById, nasabahById }: {
  k: import('../types').Kunjungan;
  petugasById: (id: string) => import('../types').Petugas | undefined;
  nasabahById: (id: string) => import('../types').Nasabah | undefined;
}) {
  const p = petugasById(k.petugas);
  const n = nasabahById(k.nasabah);
  const h = HASIL_KUNJUNGAN[k.hasil];
  if (!p || !n) return null;
  return (
    <tr>
      <td style={{ width: 40 }}><Avatar inisial={p.inisial} hue={p.hue} size={32} /></td>
      <td>
        <div style={{ fontWeight: 700 }}>{n.nama}</div>
        <div className="muted" style={{ fontSize: 12 }}>{p.nama} · {k.jam}</div>
      </td>
      <td><span className="badge" style={{ background: h.soft, color: h.c }}>{h.label}</span></td>
      <td style={{ textAlign: 'right', fontWeight: 700 }} className="num">
        {k.nominal > 0 ? RP(k.nominal) : '—'}
      </td>
    </tr>
  );
}

// Floating "live ticker" pill on top-right corner of a Stat tile. Pulses
// (animated outline) while fresh, then settles to a quiet emerald chip.
function LivePill({ fresh, count, label }: { fresh: boolean; count: number; label: string }) {
  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, zIndex: 1,
      padding: '3px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 800,
      background: fresh ? 'var(--accent)' : 'var(--accent-soft)',
      color: fresh ? 'white' : 'var(--accent-ink)',
      boxShadow: fresh ? '0 0 0 0 rgba(31,138,91,0.7)' : 'none',
      animation: fresh ? 'bsn-pulse 1.4s ease-out infinite' : 'none',
      letterSpacing: '.03em',
    }}>
      +{count} {label}
    </div>
  );
}
