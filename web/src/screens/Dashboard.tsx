import { useMemo } from 'react';
import { Ic } from '../components/Icons';
import {
  Avatar, AreaChart, Donut, HBars, Stat, cssVar,
} from '../components/UI';
import {
  HASIL_KUNJUNGAN, KOL, RP, RPjt,
  useKunjunganList, useNasabahFinder, useNasabahList, useNpl, usePayflow,
  usePetugasFinder, usePetugasList, usePostur, useTotalOutstanding,
} from '../data/queries';
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
      <div className="stat-grid fade-up" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <Stat icon={Ic.wallet} label="Outstanding Pembiayaan" value={RPjt(TOTAL_OUTSTANDING)} delta="2,1%" deltaDir="up" sub="vs bulan lalu" />
        <Stat icon={Ic.alert} label="NPL (Col 3–5)" value={NPL.toFixed(2) + '%'} delta="0,4%" deltaDir="down" tint="var(--col-macet)" soft="var(--col-macet-soft)" sub="membaik" />
        <Stat icon={Ic.wallet} label="Tertagih Hari Ini" value={RPjt(terkumpulHari)} delta={Math.round(terkumpulHari / targetHari * 100) + '%'} deltaDir="up" sub={'dari ' + RPjt(targetHari)} />
        <Stat icon={Ic.route} label="Petugas di Lapangan" value={lapangan + ' / ' + PETUGAS.length} tint="var(--sms)" soft="oklch(0.93 0.04 245)" sub={kunjunganHari + ' kunjungan hari ini'} />
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
