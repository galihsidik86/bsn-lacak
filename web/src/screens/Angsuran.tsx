import { useMemo, useState } from 'react';
import { Ic } from '../components/Icons';
import { Avatar, AreaChart, Badge, Donut, Stat, cssVar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  RP, RPjt, useNasabahList, usePayflow, usePetugasFinder,
} from '../data/queries';
import { downloadAuthed } from '../lib/download';
import type { Nasabah, Petugas } from '../types';

interface Metode { k: 'tunai' | 'transfer' | 'autodebet'; label: string; c: string }
const METODE: Metode[] = [
  { k: 'tunai', label: 'Tunai via Petugas', c: 'var(--accent)' },
  { k: 'transfer', label: 'Transfer / VA', c: 'var(--sms)' },
  { k: 'autodebet', label: 'Autodebet', c: 'var(--col-dpk)' },
];

interface Trx {
  id: string; nasabah: Nasabah; petugas: Petugas; metode: Metode;
  jam: string; nominal: number; status: 'berhasil' | 'pending';
}

function buildTrx(NASABAH: Nasabah[], petugasById: (id: string) => Petugas | undefined): Trx[] {
  const out: Trx[] = [];
  const id = 4820;
  for (let i = 0; i < Math.min(22, NASABAH.length * 3); i++) {
    const n = NASABAH[(i * 5 + 3) % NASABAH.length];
    if (!n) continue;
    const p = petugasById(n.petugas);
    if (!p) continue;
    const m = METODE[i % 3];
    const jam = `${String(8 + (i % 9)).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`;
    out.push({
      id: 'TRX' + (id + i), nasabah: n, petugas: p, metode: m, jam,
      nominal: n.angsuran * (1 + (i % 3 === 0 ? 1 : 0)),
      status: i % 9 === 0 ? 'pending' : 'berhasil',
    });
  }
  return out.sort((a, b) => b.jam.localeCompare(a.jam));
}

export function ScreenAngsuran() {
  const nasabahQ = useNasabahList();
  const payflowQ = usePayflow();
  const { data: NASABAH } = nasabahQ;
  const { data: PAYFLOW } = payflowQ;
  const petugasById = usePetugasFinder();

  const [range, setRange] = useState<'7h' | '14h' | '30h'>('14h');
  const TRX = useMemo(() => buildTrx(NASABAH, petugasById), [NASABAH, petugasById]);

  if (nasabahQ.isPending || payflowQ.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={120} />)}
        </div>
        <Skeleton h={300} />
      </div>
    );
  }
  if (nasabahQ.error || payflowQ.error) {
    return <div className="content"><ErrorState onRetry={() => { nasabahQ.refetch(); payflowQ.refetch(); }} /></div>;
  }
  if (NASABAH.length === 0 && PAYFLOW.length === 0) {
    return <div className="content"><EmptyState title="Belum ada transaksi" hint="Pembayaran nasabah akan muncul di sini setelah ada kunjungan." /></div>;
  }
  const totalHari = TRX.filter(t => t.status === 'berhasil').reduce((s, t) => s + t.nominal, 0);
  const byMethod = (['tunai', 'transfer', 'autodebet'] as const).map(k => {
    const items = TRX.filter(t => t.metode.k === k && t.status === 'berhasil');
    return {
      k, label: items[0]?.metode.label || k, value: items.reduce((s, t) => s + t.nominal, 0), n: items.length,
      color: k === 'tunai' ? 'var(--accent)' : k === 'transfer' ? 'var(--sms)' : 'var(--col-dpk)',
    };
  });

  return (
    <div className="content">
      <div className="stat-grid fade-up" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
        <Stat icon={Ic.wallet} label="Penerimaan Hari Ini" value={RPjt(totalHari)} delta="12%" deltaDir="up" sub="vs kemarin" />
        <Stat icon={Ic.check} label="Transaksi Berhasil" value={TRX.filter(t => t.status === 'berhasil').length}
          sub={`${TRX.filter(t => t.status === 'pending').length} pending`}
          tint="var(--sms)" soft="oklch(0.93 0.04 245)" />
        <Stat icon={Ic.target} label="Pencapaian Target" value="78%" delta="6%" deltaDir="up" sub="target bulanan"
          tint="var(--col-dpk)" soft="var(--col-dpk-soft)" />
        <Stat icon={Ic.trend} label="Rata-rata / Transaksi"
          value={RPjt(Math.round(totalHari / Math.max(1, TRX.filter(t => t.status === 'berhasil').length)))}
          sub="nilai angsuran" />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1.5fr 1fr', marginBottom: 16 }}>
        <div className="card card-pad fade-up">
          <div className="between" style={{ marginBottom: 14 }}>
            <div>
              <div className="section-title">Arus Pembayaran Angsuran</div>
              <div className="page-sub">Nominal harian vs target</div>
            </div>
            <div className="seg">
              {(['7h', '14h', '30h'] as const).map(r => (
                <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                  {r === '7h' ? '7 hari' : r === '14h' ? '14 hari' : '30 hari'}
                </button>
              ))}
            </div>
          </div>
          <AreaChart data={range === '7h' ? PAYFLOW.slice(-7) : PAYFLOW} valueKey="nominal" targetKey="target" fmt={RPjt} h={230} />
        </div>

        <div className="card card-pad fade-up">
          <div className="section-title" style={{ marginBottom: 16 }}>Metode Pembayaran</div>
          <div className="center gap-6">
            <Donut size={150} thickness={24}
              data={byMethod.map(m => ({ label: m.label, value: m.value, color: cssVar(m.color) }))}
              centerLabel={RPjt(totalHari).replace('Rp', '')} centerSub="juta" />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {byMethod.map(m => (
                <div key={m.k}>
                  <div className="between" style={{ marginBottom: 4 }}>
                    <span className="center gap-2" style={{ fontWeight: 700, fontSize: 12.5 }}>
                      <span className="dot" style={{ background: m.color }} />{m.label}
                    </span>
                    <span className="num" style={{ fontWeight: 700, fontSize: 12.5 }}>{m.n}</span>
                  </div>
                  <div className="num muted" style={{ fontSize: 12, fontWeight: 600 }}>{RPjt(m.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="between card-pad" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <div className="section-title">Ledger Transaksi Hari Ini</div>
          <ExportCsvButton range={range} />
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr>
              <th>Waktu</th><th>Nasabah</th><th>Petugas</th><th>Metode</th>
              <th style={{ textAlign: 'right' }}>Nominal</th><th style={{ textAlign: 'center' }}>Status</th>
            </tr></thead>
            <tbody>
              {TRX.map(t => (
                <tr key={t.id}>
                  <td className="num mono muted" style={{ fontSize: 12.5 }}>{t.jam}</td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{t.nasabah.nama}</div>
                    <div className="muted mono" style={{ fontSize: 11.5 }}>{t.id}</div>
                  </td>
                  <td><div className="center gap-2"><Avatar inisial={t.petugas.inisial} hue={t.petugas.hue} size={24} />
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t.petugas.nama.split(' ')[0]}</span></div></td>
                  <td><span className="badge" style={{ background: 'var(--surface-2)', color: t.metode.c }}>
                    <span className="dot" style={{ background: t.metode.c }} />{t.metode.label}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }} className="num">{RP(t.nominal)}</td>
                  <td style={{ textAlign: 'center' }}>
                    {t.status === 'berhasil'
                      ? <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.check}>Berhasil</Badge>
                      : <Badge c="var(--col-dpk)" soft="var(--col-dpk-soft)" icon={Ic.clock}>Pending</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ExportCsvButton({ range }: { range: '7h' | '14h' | '30h' }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const days = range === '7h' ? 7 : range === '14h' ? 14 : 30;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadAuthed(
        `/angsuran/export.csv?since=${encodeURIComponent(since)}`,
        `angsuran-ledger-${stamp}.csv`,
      );
    } catch {
      alert('Gagal mengunduh CSV. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-sm" onClick={click} disabled={busy}>
      <Ic.download size={14} />{busy ? 'Menyiapkan…' : 'Ekspor CSV'}
    </button>
  );
}
