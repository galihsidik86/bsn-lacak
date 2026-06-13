import { useState, type ReactNode } from 'react';
import { Ic, type IconKey } from '../components/Icons';
import { Avatar, Badge, ImgPh, KolBadge } from '../components/UI';
import { IOSDevice } from '../components/IosFrame';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  HASIL_KUNJUNGAN, KOL, RP, RPjt,
  useCreateKunjungan, useNasabahList, usePetugasList,
} from '../data/queries';
import type { HasilKunjungan, Nasabah, Petugas } from '../types';

type Tab = 'beranda' | 'rute' | 'riwayat' | 'profil';

export function ScreenMobile() {
  const petugasQ = usePetugasList();
  const nasabahQ = useNasabahList();
  const { data: PETUGAS } = petugasQ;
  const { data: NASABAH } = nasabahQ;
  const ME = PETUGAS[0];
  const MY_TASKS = ME ? NASABAH.filter(n => n.petugas === ME.id).slice(0, 6) : [];

  const [tab, setTab] = useState<Tab>('beranda');
  const [reportFor, setReportFor] = useState<Nasabah | null>(null);
  const [done, setDone] = useState<string[]>([]);

  if (petugasQ.isPending || nasabahQ.isPending) {
    return <div className="content" style={{ maxWidth: 980, margin: '0 auto' }}><Skeleton h={600} /></div>;
  }
  if (petugasQ.error || nasabahQ.error) {
    return <div className="content"><ErrorState onRetry={() => { petugasQ.refetch(); nasabahQ.refetch(); }} /></div>;
  }
  if (!ME) {
    return <div className="content"><EmptyState title="Belum ada petugas" hint="Seed database dulu." /></div>;
  }

  return (
    <div className="content" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 32, alignItems: 'start', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ position: 'relative' }}>
        <IOSDevice width={372} height={806}>
          <div style={{ fontFamily: 'var(--font)', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink)' }}>
            <div style={{ flex: 1, overflowY: 'auto', paddingTop: 54 }}>
              {!reportFor && tab === 'beranda' && <MBeranda me={ME} tasks={MY_TASKS} onReport={setReportFor} done={done} />}
              {!reportFor && tab === 'rute' && <MRute me={ME} tasks={MY_TASKS} onReport={setReportFor} />}
              {!reportFor && tab === 'riwayat' && <MRiwayat tasks={MY_TASKS} done={done} />}
              {reportFor && <MLapor n={reportFor} me={ME} onClose={() => setReportFor(null)}
                onDone={(id) => { setDone(d => [...d, id]); setReportFor(null); setTab('riwayat'); }} />}
            </div>
            {!reportFor && <MTabBar tab={tab} setTab={setTab}
              onReport={() => setReportFor(MY_TASKS.find(t => !done.includes(t.id)) || MY_TASKS[0])} />}
          </div>
        </IOSDevice>
      </div>

      <div style={{ paddingTop: 20, maxWidth: 420 }}>
        <span className="chip" style={{ marginBottom: 14 }}><Ic.user size={13} />Sisi Petugas Lapangan</span>
        <h2 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 12px' }}>Aplikasi mobile untuk kolektor di lapangan</h2>
        <p style={{ color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.65, margin: '0 0 22px' }}>
          Petugas membuka rute kunjungan harian, menagih, lalu mengisi laporan langsung di lokasi — lengkap dengan foto bukti dan validasi GPS otomatis. Semua tersinkron real-time ke dashboard supervisor.
        </p>
        {([
          { ic: 'home', t: 'Beranda & target harian', d: 'Ringkasan tugas, perolehan, dan progres target hari ini.' },
          { ic: 'route', t: 'Rute kunjungan optimal', d: 'Urutan nasabah binaan terdekat beserta status tunggakan.' },
          { ic: 'camera', t: 'Lapor kunjungan + foto', d: 'Foto bukti, hasil kunjungan, nominal, dan catatan — terkirim instan.' },
          { ic: 'location', t: 'Validasi lokasi otomatis', d: 'GPS memastikan petugas benar-benar berada di lokasi nasabah.' },
        ] as { ic: IconKey; t: string; d: string }[]).map((f, i) => {
          const Icon = Ic[f.ic];
          return (
            <div key={i} className="center gap-3" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
              <div className="stat-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', flex: 'none' }}><Icon size={18} /></div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{f.t}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 1, lineHeight: 1.45 }}>{f.d}</div>
              </div>
            </div>
          );
        })}
        <div className="card card-pad center gap-3" style={{ marginTop: 6, background: 'var(--accent-soft)', border: 'none' }}>
          <Ic.send size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-ink)' }}>Coba alur lapor: ketuk tombol <strong>+</strong> di tab bar aplikasi.</div>
        </div>
      </div>
    </div>
  );
}

function MHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ padding: '8px 20px 14px' }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</div>
      {sub && <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MBeranda({ me: ME, tasks: MY_TASKS, onReport, done }: {
  me: Petugas; tasks: Nasabah[]; onReport: (n: Nasabah) => void; done: string[];
}) {
  const pct = Math.round(ME.terkumpul / ME.target * 100);
  return (
    <div>
      <div style={{ padding: '8px 20px 0' }}>
        <div className="center gap-3">
          <Avatar inisial={ME.inisial} hue={ME.hue} size={44} />
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Selamat pagi,</div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{ME.nama}</div>
          </div>
        </div>
      </div>
      <div style={{
        margin: '16px 16px 0', borderRadius: 22, padding: 18, color: 'white',
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(145deg, var(--accent), var(--accent-700))',
        boxShadow: '0 10px 26px oklch(0.50 0.12 162 / 0.32)',
      }}>
        <div className="islamic-on-green" style={{ position: 'absolute', inset: 0, opacity: 0.08, pointerEvents: 'none' }} />
        <div className="between" style={{ position: 'relative' }}>
          <div>
            <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 600 }}>Tertagih hari ini</div>
            <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 2 }}>{RPjt(ME.terkumpul)}</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }} className="num">target {RPjt(ME.target)}</div>
          </div>
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
            <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="7" />
              <circle cx="32" cy="32" r="27" fill="none" stroke="white" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${pct / 100 * 2 * Math.PI * 27} 999`} />
            </svg>
            <div className="num" style={{ position: 'absolute', fontWeight: 800, fontSize: 15 }}>{pct}%</div>
          </div>
        </div>
        <div className="center gap-2" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.2)', position: 'relative' }}>
          <MiniStatW label="Kunjungan" value={`${ME.kunjungan}/${ME.rencana}`} />
          <MiniStatW label="Sisa target" value={RPjt(ME.target - ME.terkumpul)} />
        </div>
      </div>

      <div className="between" style={{ padding: '22px 20px 10px' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Kunjungan Hari Ini</div>
        <span className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>{done.length}/{MY_TASKS.length} selesai</span>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {MY_TASKS.map((n, i) => {
          const isDone = done.includes(n.id);
          return (
            <button key={n.id} onClick={() => !isDone && onReport(n)} disabled={isDone}
              style={{
                background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 13,
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', opacity: isDone ? 0.55 : 1,
              }}>
              <div style={{
                width: 30, height: 30, borderRadius: 99, flex: 'none', display: 'grid', placeItems: 'center',
                background: isDone ? 'var(--accent)' : 'var(--surface-2)',
                color: isDone ? 'white' : 'var(--ink-3)', fontWeight: 800, fontSize: 13,
              }} className="num">{isDone ? <Ic.check size={16} /> : i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{n.nama}</div>
                <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.alamat}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <KolBadge kol={n.kol} />
                <div className="num" style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{RP(n.angsuran)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniStatW({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 600 }}>{label}</div>
      <div className="num" style={{ fontWeight: 800, fontSize: 15, marginTop: 1 }}>{value}</div>
    </div>
  );
}

function MRute({ me: ME, tasks: MY_TASKS, onReport }: {
  me: Petugas; tasks: Nasabah[]; onReport: (n: Nasabah) => void;
}) {
  return (
    <div>
      <MHeader title="Rute Saya" sub={`${MY_TASKS.length} kunjungan · ${ME.wilayah}`} />
      <div style={{ margin: '0 16px 16px', borderRadius: 18, overflow: 'hidden', border: '1px solid var(--line)', height: 160, position: 'relative' }}>
        <svg viewBox="0 0 340 160" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
          <rect width="340" height="160" fill="var(--surface-2)" />
          {[60, 140, 220, 300].map((x, i) => <line key={i} x1={x} y1="0" x2={x} y2="160" stroke="var(--surface)" strokeWidth="9" />)}
          {[45, 100].map((y, i) => <line key={i} x1="0" y1={y} x2="340" y2={y} stroke="var(--surface)" strokeWidth="9" />)}
          <path d="M40 130 L100 90 L150 110 L210 60 L270 80 L300 40" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          {([[40, 130], [100, 90], [150, 110], [210, 60], [270, 80]] as [number, number][]).map((p, i) => (
            <g key={i}>
              <circle cx={p[0]} cy={p[1]} r="9" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2.5" />
              <text x={p[0]} y={p[1] + 3.5} textAnchor="middle" fontSize="9" fontWeight="800" fill="var(--accent)">{i + 1}</text>
            </g>
          ))}
          <circle cx="300" cy="40" r="7" fill="var(--accent)" stroke="white" strokeWidth="2.5" />
        </svg>
        <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'var(--ink)', color: 'white', borderRadius: 8, padding: '4px 9px', fontSize: 11, fontWeight: 700 }} className="center gap-2">
          <Ic.nav size={12} />Estimasi 14 km · 6 stop
        </div>
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {MY_TASKS.map((n, i) => (
          <div key={n.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 13, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{
                width: 24, height: 24, borderRadius: 99, background: 'var(--accent-soft)',
                color: 'var(--accent-ink)', display: 'grid', placeItems: 'center',
                fontWeight: 800, fontSize: 11,
              }} className="num">{i + 1}</span>
              {i < MY_TASKS.length - 1 && <span style={{ width: 2, height: 14, background: 'var(--line-2)' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{n.nama}</div>
              <div className="muted center gap-2" style={{ fontSize: 12 }}><Ic.pin size={12} />{n.alamat}</div>
            </div>
            <button onClick={() => onReport(n)} className="btn btn-sm btn-primary" style={{ flex: 'none' }}>Lapor</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MRiwayat({ tasks: MY_TASKS, done }: { tasks: Nasabah[]; done: string[] }) {
  const reported = MY_TASKS.filter(t => done.includes(t.id));
  return (
    <div>
      <MHeader title="Riwayat" sub={`${reported.length} laporan dikirim hari ini`} />
      {reported.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 30px', color: 'var(--ink-4)' }}>
          <div className="stat-ic" style={{ width: 56, height: 56, margin: '0 auto 14px', background: 'var(--surface-2)', color: 'var(--ink-4)' }}>
            <Ic.clipboard size={26} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-2)' }}>Belum ada laporan</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Laporan kunjungan yang Anda kirim akan muncul di sini.</div>
        </div>
      ) : (
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reported.map(n => (
            <div key={n.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
              <ImgPh label={`◦ foto · ${n.nama} ◦`} h={88} style={{ borderRadius: 0, border: 'none' }} />
              <div style={{ padding: 12 }}>
                <div className="between">
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{n.nama}</div>
                  <Badge c="var(--accent)" soft="var(--accent-soft)" icon={Ic.checkCircle}>Terkirim</Badge>
                </div>
                <div className="muted center gap-2" style={{ fontSize: 12, marginTop: 4 }}>
                  <Ic.location size={12} style={{ color: 'var(--accent)' }} />Lokasi tervalidasi · baru saja
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MLapor({ n, me: ME, onClose, onDone }: {
  n: Nasabah; me: Petugas; onClose: () => void; onDone: (id: string) => void;
}) {
  const create = useCreateKunjungan();
  const [hasil, setHasil] = useState<HasilKunjungan>('bayar');
  const [nominal, setNominal] = useState(String(n.angsuran));
  const [foto, setFoto] = useState(0);
  const [catatan, setCatatan] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    setSending(true);
    try {
      await create.mutateAsync({
        nasabah: n.id, petugas: ME.id, hasil, nominal: Number(nominal),
        catatan, lokasi: n.alamat, photos: [],
      });
    } catch { /* swallow */ }
    setTimeout(() => onDone(n.id), 600);
  };

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="between" style={{ padding: '8px 16px 12px' }}>
        <button onClick={onClose} className="btn btn-ghost btn-sm"><Ic.x size={16} />Batal</button>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Lapor Kunjungan</div>
        <span style={{ width: 56 }} />
      </div>
      <div style={{ flex: 1, padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 13 }} className="center gap-3">
          <div className="stat-ic" style={{ background: KOL[n.kol].soft, color: KOL[n.kol].ink }}><Ic.user size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{n.nama}</div>
            <div className="muted" style={{ fontSize: 12 }}>{n.alamat}</div>
          </div>
          <KolBadge kol={n.kol} />
        </div>

        <div>
          <MLabel>Foto Bukti Kunjungan</MLabel>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            {[0, 1, 2].map(i => (
              foto > i
                ? <ImgPh key={i} label="✓ terfoto" h={76}
                    style={{ color: 'var(--accent)', background: 'var(--accent-soft)', borderColor: 'var(--accent)' }} />
                : <button key={i} onClick={() => setFoto(f => Math.max(f, i + 1))} style={{
                    height: 76, borderRadius: 12, border: '1.5px dashed var(--line-2)',
                    background: 'var(--surface-2)', color: 'var(--ink-4)', display: 'grid', placeItems: 'center',
                  }}><Ic.camera size={20} /></button>
            ))}
          </div>
        </div>

        <div>
          <MLabel>Hasil Kunjungan</MLabel>
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {(Object.entries(HASIL_KUNJUNGAN) as [HasilKunjungan, typeof HASIL_KUNJUNGAN[HasilKunjungan]][]).map(([k, v]) => (
              <button key={k} onClick={() => setHasil(k)} style={{
                padding: '11px 10px', borderRadius: 12, fontWeight: 700, fontSize: 12.5,
                border: hasil === k ? `1.5px solid ${v.c}` : '1px solid var(--line)',
                background: hasil === k ? v.soft : 'var(--surface)',
                color: hasil === k ? v.c : 'var(--ink-2)',
              }}>{v.label}</button>
            ))}
          </div>
        </div>

        {hasil === 'bayar' && (
          <div>
            <MLabel>Nominal Pembayaran</MLabel>
            <div className="search" style={{ background: 'var(--surface)' }}>
              <span style={{ fontWeight: 800, color: 'var(--ink-3)' }}>Rp</span>
              <input value={Number(nominal).toLocaleString('id-ID')} inputMode="numeric"
                onChange={e => setNominal(e.target.value.replace(/\D/g, ''))} style={{ fontWeight: 700 }} />
            </div>
          </div>
        )}

        <div>
          <MLabel>Catatan</MLabel>
          <textarea className="input" rows={3} placeholder="Kondisi usaha, kesepakatan, dll…"
            value={catatan} onChange={e => setCatatan(e.target.value)}
            style={{ resize: 'none', background: 'var(--surface)' }} />
        </div>

        <div className="center gap-3" style={{ background: 'var(--accent-soft)', borderRadius: 12, padding: '11px 13px' }}>
          <Ic.location size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--accent-ink)' }}>Lokasi terdeteksi otomatis</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--accent-ink)', opacity: 0.8 }}>-6.4823, 106.8541 · akurasi 6m</div>
          </div>
          <Ic.checkCircle size={18} style={{ color: 'var(--accent)' }} />
        </div>
      </div>

      <div style={{ padding: 16, borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button onClick={submit} disabled={sending || foto === 0} className="btn btn-primary"
          style={{ width: '100%', padding: 14, fontSize: 15, opacity: foto === 0 ? 0.5 : 1 }}>
          {sending ? 'Mengirim…' : foto === 0 ? 'Ambil foto dulu' : <><Ic.send size={16} />Kirim Laporan</>}
        </button>
      </div>
    </div>
  );
}

function MLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div>;
}

function MTabBar({ tab, setTab, onReport }: { tab: Tab; setTab: (t: Tab) => void; onReport: () => void }) {
  const tabs: ({ k: Tab; ic: IconKey; label: string } | { k: '_add' })[] = [
    { k: 'beranda', ic: 'home', label: 'Beranda' },
    { k: 'rute', ic: 'route', label: 'Rute' },
    { k: '_add' },
    { k: 'riwayat', ic: 'clipboard', label: 'Riwayat' },
    { k: 'profil', ic: 'user', label: 'Profil' },
  ];
  return (
    <div style={{
      borderTop: '1px solid var(--line)',
      background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
      backdropFilter: 'blur(10px)',
      display: 'flex', padding: '8px 8px 26px', alignItems: 'center',
    }}>
      {tabs.map(t => {
        if (t.k === '_add') return (
          <div key="add" style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <button onClick={onReport} style={{
              width: 50, height: 50, borderRadius: 99, border: 'none', background: 'var(--accent)', color: 'white',
              display: 'grid', placeItems: 'center', boxShadow: '0 6px 16px oklch(0.55 0.14 156 / 0.4)', marginTop: -24,
            }}><Ic.plus size={24} /></button>
          </div>
        );
        const Icon = Ic[t.ic];
        const on = tab === t.k;
        return (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: 1, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            color: on ? 'var(--accent)' : 'var(--ink-4)',
          }}>
            <Icon size={21} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
