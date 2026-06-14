import { useState } from 'react';
import { Ic } from '../components/Icons';
import { Avatar, Badge, ImgPh, KolBadge, Kv, Modal, Stat } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  HASIL_KUNJUNGAN, RP,
  useKunjunganList, useNasabahFinder, usePetugasFinder, usePetugasList,
} from '../data/queries';
import type { HasilKunjungan, Kunjungan, Nasabah, Petugas } from '../types';

const RISK_FLAG_META: Record<string, { label: string; hint: string }> = {
  gps_far: { label: 'GPS jauh dari nasabah', hint: 'Lokasi laporan > 200m dari alamat nasabah.' },
  gps_missing: { label: 'GPS tidak dikirim', hint: 'Klien tidak melampirkan koordinat saat submit.' },
  photo_no_exif: { label: 'Foto tanpa metadata', hint: 'Foto tidak punya EXIF — kemungkinan dari galeri / di-edit.' },
  photo_stale: { label: 'Foto lama', hint: 'Foto diambil > 1 jam sebelum laporan dikirim.' },
  speed_jump: { label: 'Lonjakan kecepatan', hint: 'Petugas berpindah > 150 km/h antara dua ping GPS.' },
};

export function ScreenLaporan() {
  const kunjunganQ = useKunjunganList();
  const petugasQ = usePetugasList();
  const { data: KUNJUNGAN } = kunjunganQ;
  const { data: PETUGAS } = petugasQ;
  const petugasById = usePetugasFinder();
  const nasabahById = useNasabahFinder();

  const [fPet, setFPet] = useState<'all' | string>('all');
  const [fHasil, setFHasil] = useState<'all' | HasilKunjungan>('all');
  const [sel, setSel] = useState<Kunjungan | null>(null);

  const rows = KUNJUNGAN.filter(k =>
    (fPet === 'all' || k.petugas === fPet) &&
    (fHasil === 'all' || k.hasil === fHasil)
  );

  const counts = (Object.keys(HASIL_KUNJUNGAN) as HasilKunjungan[])
    .map(h => ({ h, n: KUNJUNGAN.filter(k => k.hasil === h).length }));

  if (kunjunganQ.isPending || petugasQ.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h={120} />)}
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={260} />)}
        </div>
      </div>
    );
  }
  if (kunjunganQ.error || petugasQ.error) {
    return <div className="content"><ErrorState onRetry={() => { kunjunganQ.refetch(); petugasQ.refetch(); }} /></div>;
  }
  if (KUNJUNGAN.length === 0) {
    return <div className="content"><EmptyState title="Belum ada laporan kunjungan" hint="Laporan akan muncul setelah petugas mengisi via app mobile." /></div>;
  }

  return (
    <div className="content">
      <div className="stat-grid fade-up" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
        <Stat icon={Ic.clipboard} label="Total Kunjungan" value={KUNJUNGAN.length} sub="hari ini" />
        {counts.slice(0, 3).map(({ h, n }) => {
          const hk = HASIL_KUNJUNGAN[h];
          const icon = h === 'bayar' ? Ic.wallet : h === 'janji' ? Ic.clock : Ic.user;
          return <Stat key={h} icon={icon} label={hk.label} value={n} tint={hk.c} soft={hk.soft}
            sub={Math.round(n / KUNJUNGAN.length * 100) + '% dari kunjungan'} />;
        })}
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden', marginBottom: 4 }}>
        <div className="between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 12 }}>
          <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto' }} value={fPet} onChange={e => setFPet(e.target.value)}>
              <option value="all">Semua petugas</option>
              {PETUGAS.map(p => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </select>
            <div className="seg">
              <button className={fHasil === 'all' ? 'on' : ''} onClick={() => setFHasil('all')}>Semua</button>
              {(Object.entries(HASIL_KUNJUNGAN) as [HasilKunjungan, typeof HASIL_KUNJUNGAN[HasilKunjungan]][]).map(([k, v]) => (
                <button key={k} className={fHasil === k ? 'on' : ''} onClick={() => setFHasil(k)}>
                  {v.label.split('/')[0].split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
          <span className="chip"><Ic.calendar size={13} />11 Juni 2026</span>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginTop: 16 }}>
        {rows.map(k => {
          const p = petugasById(k.petugas);
          const n = nasabahById(k.nasabah);
          if (!p || !n) return null;
          const h = HASIL_KUNJUNGAN[k.hasil];
          return (
            <button key={k.id} onClick={() => setSel(k)} className="card fade-up"
              style={{ textAlign: 'left', overflow: 'hidden', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'relative' }}>
                <ImgPh label={`◦ FOTO KUNJUNGAN ◦\n${n.nama}`} h={150}
                  style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid var(--line)', whiteSpace: 'pre-line' }} />
                <span className="badge" style={{ position: 'absolute', top: 10, left: 10, background: h.soft, color: h.c, boxShadow: 'var(--sh-1)' }}>{h.label}</span>
                <span style={{ position: 'absolute', top: 10, right: 10, background: 'var(--ink)', color: 'white', borderRadius: 8, padding: '3px 8px', fontSize: 11, fontWeight: 700 }} className="center gap-2">
                  <Ic.camera size={12} />{k.foto}
                </span>
                {(k.riskFlags?.length ?? 0) > 0 && (
                  <span style={{ position: 'absolute', top: 40, right: 10, background: 'var(--col-macet)', color: 'white', borderRadius: 8, padding: '3px 8px', fontSize: 10.5, fontWeight: 700 }} className="center gap-2">
                    <Ic.alert size={12} />Perlu review
                  </span>
                )}
                <span style={{ position: 'absolute', bottom: 10, left: 10, background: 'color-mix(in oklch, var(--ink) 78%, transparent)', color: 'white', borderRadius: 7, padding: '3px 8px', fontSize: 10.5, fontWeight: 600 }} className="center gap-2">
                  <Ic.pin size={11} />{k.lokasi}
                </span>
              </div>
              <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div className="between">
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{n.nama}</div>
                  <KolBadge kol={n.kol} />
                </div>
                <div style={{
                  fontSize: 12.5, color: 'var(--ink-2)', marginTop: 8, lineHeight: 1.5, flex: 1,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>{k.catatan}</div>
                <div className="between" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <div className="center gap-2"><Avatar inisial={p.inisial} hue={p.hue} size={24} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{p.nama.split(' ')[0]}</span></div>
                  <span className="num muted center gap-2" style={{ fontSize: 11.5, fontWeight: 600 }}>
                    <Ic.clock size={12} />{k.jam}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {sel && <LaporanDetail k={sel} onClose={() => setSel(null)}
        petugasById={petugasById} nasabahById={nasabahById} />}
    </div>
  );
}

function LaporanDetail({ k, onClose, petugasById, nasabahById }: {
  k: Kunjungan; onClose: () => void;
  petugasById: (id: string) => Petugas | undefined;
  nasabahById: (id: string) => Nasabah | undefined;
}) {
  const p = petugasById(k.petugas);
  const n = nasabahById(k.nasabah);
  if (!p || !n) return null;
  const h = HASIL_KUNJUNGAN[k.hasil];
  return (
    <Modal onClose={onClose} max={620}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="center gap-2"><span className="section-title">Laporan Kunjungan</span>
            <span className="badge" style={{ background: h.soft, color: h.c }}>{h.label}</span></div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 3 }}>{k.id} · {k.jam} · 11 Jun 2026</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body">
        <div className="grid gap-2" style={{ gridTemplateColumns: k.foto > 1 ? '2fr 1fr' : '1fr', marginBottom: 18 }}>
          <ImgPh label={`◦ FOTO UTAMA ◦\nbukti kunjungan / usaha nasabah`} h={k.foto > 1 ? 200 : 220} style={{ whiteSpace: 'pre-line' }} />
          {k.foto > 1 && (
            <div className="grid gap-2" style={{ gridTemplateRows: k.foto > 2 ? '1fr 1fr' : '1fr' }}>
              <ImgPh label="◦ foto 2 ◦" h={k.foto > 2 ? 96 : 200} />
              {k.foto > 2 && <ImgPh label="◦ foto 3 ◦" h={96} />}
            </div>
          )}
        </div>

        <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none', marginBottom: 16 }}>
          <div className="between">
            <div className="center gap-3">
              <Avatar inisial={p.inisial} hue={p.hue} size={40} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{n.nama}</div>
                <div className="muted" style={{ fontSize: 12 }}>Dikunjungi oleh {p.nama}</div>
              </div>
            </div>
            <KolBadge kol={n.kol} full />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          <Kv label="Hasil kunjungan" value={h.label} />
          <Kv label="Pembayaran" value={k.nominal > 0 ? RP(k.nominal) : 'Tidak ada'} />
          <Kv label="Tunggakan saat ini" value={k.dpd > 0 ? k.dpd + ' hari' : 'Lancar'} />
          <Kv label="Validasi GPS" value={k.valid ? '✓ Sesuai lokasi nasabah' : '⚠ Di luar radius'} />
        </div>

        {(k.riskFlags?.length ?? 0) > 0 && (
          <div className="card card-pad" style={{
            marginBottom: 16, boxShadow: 'none',
            background: 'var(--col-macet-soft)', border: '1px solid var(--col-macet)',
          }}>
            <div className="center gap-2" style={{ fontWeight: 800, fontSize: 13, color: 'var(--col-macet)', marginBottom: 6 }}>
              <Ic.alert size={15} />Perlu review · skor risiko {k.riskScore ?? 0}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--col-macet)', lineHeight: 1.55 }}>
              {(k.riskFlags ?? []).map(f => {
                const meta = RISK_FLAG_META[f];
                return <li key={f}><strong>{meta?.label ?? f}</strong>{meta ? ` — ${meta.hint}` : null}</li>;
              })}
            </ul>
          </div>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6 }}>CATATAN PETUGAS</div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)' }}>{k.catatan}</p>

        <div className="card card-pad center gap-3" style={{ marginTop: 16, boxShadow: 'none', background: 'var(--surface-2)', padding: '12px 14px' }}>
          <Ic.location size={18} style={{ color: k.valid ? 'var(--accent)' : 'var(--col-macet)', flex: 'none' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{k.lokasi}</div>
            <div className="muted mono" style={{ fontSize: 11 }}>-6.4{k.id.slice(1)}, 106.8{k.foto}21 · akurasi 8m</div>
          </div>
          {k.valid
            ? <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.checkCircle}>Tervalidasi</Badge>
            : <Badge c="var(--col-macet)" soft="var(--col-macet-soft)" icon={Ic.alert}>Perlu cek</Badge>}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn"><Ic.download size={15} />Unduh PDF</button>
        <button className="btn btn-primary"><Ic.phone size={15} />Hubungi {p.nama.split(' ')[0]}</button>
      </div>
    </Modal>
  );
}
