import { useState } from 'react';
import { Ic } from '../components/Icons';
import { Avatar, Badge, KolBadge, Kv, Modal, StackedBar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  KOL, RP, RPjt,
  useNasabahList, usePetugasFinder, usePetugasList, usePostur,
} from '../data/queries';
import type { Akad, KolKey, Nasabah } from '../types';

const AKAD_SHORT: Record<Akad, string> = {
  Murabahah: 'MBA',
  Musyarakah: 'MSY',
  Ijarah: 'IJR',
  'Musyarakah Mutanaqisah': 'MMQ',
  Istishna: 'IST',
};

const AKAD_LIST: Akad[] = ['Murabahah', 'Musyarakah', 'Ijarah', 'Musyarakah Mutanaqisah', 'Istishna'];

const AKAD_COLOR: Record<Akad, string> = {
  Murabahah: 'var(--accent)',
  Musyarakah: 'var(--gold)',
  Ijarah: 'oklch(0.62 0.10 205)',
  'Musyarakah Mutanaqisah': 'oklch(0.58 0.11 300)',
  Istishna: 'oklch(0.64 0.12 42)',
};

function AkadBadge({ akad }: { akad: Akad }) {
  return (
    <span className="badge" title={akad}
      style={{ background: 'var(--gold-soft)', color: 'var(--gold-ink)', letterSpacing: '0.02em' }}>
      {AKAD_SHORT[akad] || akad}
    </span>
  );
}

export function ScreenKolektabilitas({ go }: { go: (k: string) => void }) {
  const nasabahQ = useNasabahList();
  const petugasQ = usePetugasList();
  const { data: NASABAH } = nasabahQ;
  const { data: PETUGAS } = petugasQ;
  const POSTUR = usePostur();
  const petugasById = usePetugasFinder();

  const [fKol, setFKol] = useState<'all' | string>('all');
  const [fPet, setFPet] = useState<'all' | string>('all');
  const [fAkad, setFAkad] = useState<'all' | Akad>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Nasabah | null>(null);

  if (nasabahQ.isPending || petugasQ.isPending) {
    return (
      <div className="content" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={110} />)}
        </div>
        <Skeleton h={460} />
      </div>
    );
  }
  if (nasabahQ.error || petugasQ.error) {
    return <div className="content"><ErrorState onRetry={() => { nasabahQ.refetch(); petugasQ.refetch(); }} /></div>;
  }
  if (NASABAH.length === 0) {
    return <div className="content"><EmptyState title="Belum ada nasabah binaan" hint="Seed database atau tambahkan nasabah." /></div>;
  }

  const rows = NASABAH.filter(n =>
    (fKol === 'all' || n.kol === +fKol) &&
    (fPet === 'all' || n.petugas === fPet) &&
    (fAkad === 'all' || n.akad === fAkad) &&
    (q === '' || n.nama.toLowerCase().includes(q.toLowerCase()) || n.id.includes(q))
  );

  const akadComp = AKAD_LIST.map(a => {
    const items = NASABAH.filter(n => n.akad === a);
    return { akad: a, n: items.length, nom: items.reduce((s, x) => s + x.sisa, 0), color: AKAD_COLOR[a] };
  });
  const akadTotal = NASABAH.length;

  return (
    <div className="content">
      <div className="stat-grid fade-up" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: 20 }}>
        {([1, 2, 3, 4, 5] as KolKey[]).map(k => {
          const active = fKol === String(k);
          return (
            <button key={k} onClick={() => setFKol(active ? 'all' : String(k))}
              className="card card-pad" style={{
                textAlign: 'left', cursor: 'pointer',
                border: active ? `1.5px solid ${KOL[k].c}` : '1px solid var(--line)',
                outline: active ? `3px solid ${KOL[k].soft}` : 'none',
              }}>
              <div className="center gap-2" style={{ marginBottom: 10 }}>
                <span className="dot" style={{ background: KOL[k].c, width: 10, height: 10 }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{KOL[k].label}</span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, marginLeft: 'auto' }}>{KOL[k].short}</span>
              </div>
              <div className="num" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{POSTUR[k].n}</div>
              <div className="num muted" style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{RPjt(POSTUR[k].nom)}</div>
            </button>
          );
        })}
      </div>

      <div className="card card-pad fade-up" style={{ marginBottom: 20 }}>
        <div className="between" style={{ marginBottom: 14 }}>
          <div>
            <div className="section-title">Komposisi Akad Pembiayaan</div>
            <div className="page-sub">Sebaran {akadTotal} nasabah binaan menurut jenis akad syariah</div>
          </div>
          {fAkad !== 'all' && (
            <button className="btn btn-sm btn-ghost" onClick={() => setFAkad('all')}><Ic.x size={14} />Hapus filter akad</button>
          )}
        </div>
        <StackedBar segments={akadComp.map(a => ({ label: a.akad, value: a.n, color: a.color }))} height={14} radius={7} />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 16 }}>
          {akadComp.map(a => {
            const active = fAkad === a.akad;
            return (
              <button key={a.akad} onClick={() => setFAkad(active ? 'all' : a.akad)}
                style={{
                  textAlign: 'left', background: active ? 'var(--surface-2)' : 'transparent', cursor: 'pointer',
                  border: active ? '1px solid var(--line-2)' : '1px solid transparent', borderRadius: 12, padding: '9px 11px',
                }}>
                <div className="center gap-2" style={{ marginBottom: 6 }}>
                  <span className="dot" style={{ background: a.color, width: 9, height: 9 }} />
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{AKAD_SHORT[a.akad]}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 700, marginLeft: 'auto' }} className="num">{Math.round(a.n / akadTotal * 100)}%</span>
                </div>
                <div className="num" style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>{a.n}</div>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3, marginTop: 2 }}>{a.akad}</div>
                <div className="num muted" style={{ fontSize: 11, fontWeight: 600, marginTop: 3 }}>{RPjt(a.nom)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card fade-up" style={{ overflow: 'hidden' }}>
        <div className="between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 12 }}>
          <div className="center gap-3" style={{ flexWrap: 'wrap' }}>
            <div className="search" style={{ width: 240 }}>
              <Ic.search size={16} />
              <input placeholder="Cari nama / ID nasabah…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <select className="input" style={{ width: 'auto' }} value={fPet} onChange={e => setFPet(e.target.value)}>
              <option value="all">Semua petugas</option>
              {PETUGAS.map(p => <option key={p.id} value={p.id}>{p.nama}</option>)}
            </select>
            <select className="input" style={{ width: 'auto' }} value={fAkad} onChange={e => setFAkad(e.target.value as Akad | 'all')}>
              <option value="all">Semua akad</option>
              {AKAD_LIST.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            {(fKol !== 'all' || fPet !== 'all' || fAkad !== 'all' || q) && (
              <button className="btn btn-sm btn-ghost" onClick={() => { setFKol('all'); setFPet('all'); setFAkad('all'); setQ(''); }}>
                <Ic.x size={14} />Reset
              </button>
            )}
          </div>
          <div className="center gap-2">
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{rows.length} nasabah</span>
            <button className="btn btn-sm"><Ic.download size={14} />Ekspor</button>
          </div>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
          <table className="table">
            <thead><tr>
              <th>Nasabah</th><th>Petugas</th><th>Akad</th><th>Kolektabilitas</th>
              <th style={{ textAlign: 'right' }}>Outstanding</th>
              <th style={{ textAlign: 'right' }}>Angsuran</th>
              <th style={{ textAlign: 'center' }}>Tunggakan</th>
              <th></th>
            </tr></thead>
            <tbody>
              {rows.slice(0, 40).map(n => {
                const p = petugasById(n.petugas);
                if (!p) return null;
                return (
                  <tr key={n.id} className="row-click" onClick={() => setSel(n)}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{n.nama}</div>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>{n.id} · {n.alamat}</div>
                    </td>
                    <td><div className="center gap-2"><Avatar inisial={p.inisial} hue={p.hue} size={26} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>{p.nama.split(' ')[0]}</span></div></td>
                    <td><AkadBadge akad={n.akad} /></td>
                    <td><KolBadge kol={n.kol} full /></td>
                    <td style={{ textAlign: 'right' }} className="num">{RP(n.sisa)}</td>
                    <td style={{ textAlign: 'right' }} className="num muted">{RP(n.angsuran)}</td>
                    <td style={{ textAlign: 'center' }} className="num">
                      {n.dpd > 0
                        ? <span style={{ color: KOL[n.kol].ink, fontWeight: 700 }}>{n.dpd} hari</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td><Ic.chevR size={16} style={{ color: 'var(--ink-4)' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {sel && <NasabahDrawer n={sel} onClose={() => setSel(null)} go={go} petugasById={petugasById} />}
    </div>
  );
}

function NasabahDrawer({ n, onClose, go, petugasById }: {
  n: Nasabah; onClose: () => void; go: (k: string) => void;
  petugasById: (id: string) => import('../types').Petugas | undefined;
}) {
  const p = petugasById(n.petugas);
  if (!p) return null;
  const paid = n.plafon - n.sisa;
  const pct = Math.round(paid / n.plafon * 100);
  return (
    <Modal onClose={onClose} max={460}>
      <div className="modal-head">
        <div className="center gap-3" style={{ flex: 1 }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: KOL[n.kol].soft, color: KOL[n.kol].ink, display: 'grid', placeItems: 'center' }}>
            <Ic.user size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{n.nama}</div>
            <div className="muted mono" style={{ fontSize: 12 }}>{n.id}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body">
        <div className="center gap-2" style={{ marginBottom: 16 }}>
          <KolBadge kol={n.kol} full />
          {n.dpd > 0 && <Badge c="var(--col-macet)" soft="var(--col-macet-soft)" icon={Ic.alert}>{n.dpd} hari menunggak</Badge>}
        </div>
        <div className="card card-pad" style={{ marginBottom: 14, boxShadow: 'none', background: 'var(--surface-2)' }}>
          <div className="between" style={{ fontSize: 12.5, marginBottom: 8 }}>
            <span className="muted" style={{ fontWeight: 600 }}>Progres pelunasan</span>
            <span className="num" style={{ fontWeight: 700 }}>{pct}%</span>
          </div>
          <div className="progress"><span style={{ width: pct + '%' }} /></div>
          <div className="between num" style={{ fontSize: 11.5, marginTop: 8, color: 'var(--ink-3)', fontWeight: 600 }}>
            <span>Dibayar {RPjt(paid)}</span><span>Sisa {RPjt(n.sisa)}</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Kv label="Akad" value={n.akad} />
          <Kv label="Plafon Pembiayaan" value={RP(n.plafon)} />
          <Kv label="Tenor" value={n.tenor + ' bulan'} />
          <Kv label="Angsuran/bln" value={RP(n.angsuran)} />
          <Kv label="Bayar terakhir" value={n.lastBayar} />
          <Kv label="Petugas binaan" value={p.nama} />
          <Kv label="No. HP" value={n.hp} />
          <Kv label="Alamat" value={n.alamat} full />
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn"><Ic.phone size={15} />Telepon</button>
        <button className="btn"><Ic.wa size={15} />WhatsApp</button>
        <button className="btn btn-primary" onClick={() => { onClose(); go('tracking'); }}><Ic.pin size={15} />Lihat di peta</button>
      </div>
    </Modal>
  );
}
