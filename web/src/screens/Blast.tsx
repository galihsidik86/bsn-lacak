import { useEffect, useState } from 'react';
import { Ic, type IconKey } from '../components/Icons';
import { Badge, KolBadge, Modal, Ring } from '../components/UI';
import { RP, TEMPLATES, useBlastHistory, useSegmen } from '../data/queries';
import { api } from '../lib/api';
import type { Nasabah } from '../types';

type SegKey = 'h3' | 'hari_ini' | 'lewat';
interface SegmentDef {
  key: SegKey;
  label: string;
  desc: string;
  icon: IconKey;
  c: string;
  soft: string;
  tpl: keyof typeof TEMPLATES;
}

const SEGMENTS: SegmentDef[] = [
  { key: 'h3', label: 'Belum Jatuh Tempo (H-3)', desc: 'Reminder dini untuk nasabah lancar', icon: 'clock',
    c: 'var(--col-dpk)', soft: 'var(--col-dpk-soft)', tpl: 'belum' },
  { key: 'hari_ini', label: 'Jatuh Tempo Hari Ini', desc: 'Tagihan jatuh tempo per hari ini', icon: 'bell',
    c: 'var(--accent)', soft: 'var(--accent-soft)', tpl: 'hari_ini' },
  { key: 'lewat', label: 'Lewat Jatuh Tempo', desc: 'Sudah menunggak, perlu penagihan', icon: 'alert',
    c: 'var(--col-macet)', soft: 'var(--col-macet-soft)', tpl: 'lewat' },
];

type Kanal = 'wa' | 'sms';
type Stage = null | 'confirm' | 'progress' | 'done';

export function ScreenBlast() {
  const SEGMEN = useSegmen();
  const { data: BLAST_HISTORY } = useBlastHistory();

  const [segKey, setSegKey] = useState<SegKey>('hari_ini');
  const [kanal, setKanal] = useState<Kanal>('wa');
  const seg = SEGMENTS.find(s => s.key === segKey)!;
  const recipients: Nasabah[] = SEGMEN[segKey];
  const [tpl, setTpl] = useState(TEMPLATES[seg.tpl]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Stage>(null);

  useEffect(() => { setTpl(TEMPLATES[seg.tpl]); setExcluded(new Set()); }, [segKey, seg.tpl]);

  const active = recipients.filter(r => !excluded.has(r.id));
  const sample = active[0] || recipients[0];
  const preview = sample ? tpl
    .replace('{nama}', sample.nama)
    .replace('{angsuran}', RP(sample.angsuran))
    .replace('{tgl}', sample.dueIn > 0 ? `${sample.dueIn} hari lagi` : 'hari ini')
    .replace('{dpd}', String(sample.dpd)) : tpl;

  const toggle = (id: string) => {
    const s = new Set(excluded);
    if (s.has(id)) s.delete(id); else s.add(id);
    setExcluded(s);
  };

  return (
    <div className="content">
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 20 }}>
        {SEGMENTS.map(s => {
          const Icon = Ic[s.icon];
          const on = segKey === s.key;
          return (
            <button key={s.key} onClick={() => setSegKey(s.key)} className="card card-pad fade-up"
              style={{
                textAlign: 'left', cursor: 'pointer',
                border: on ? `1.5px solid ${s.c}` : '1px solid var(--line)',
                outline: on ? `3px solid ${s.soft}` : 'none',
              }}>
              <div className="between">
                <div className="stat-ic" style={{ background: s.soft, color: s.c }}><Icon size={19} /></div>
                <div className="num" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em' }}>{SEGMEN[s.key].length}</div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, marginTop: 12 }}>{s.label}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{s.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div className="card card-pad fade-up">
          <div className="between" style={{ marginBottom: 16 }}>
            <div className="section-title">Susun Pesan Blast</div>
            <div className="seg">
              <button className={kanal === 'wa' ? 'on' : ''} onClick={() => setKanal('wa')}>
                <span className="center gap-2"><Ic.wa size={15} style={{ color: kanal === 'wa' ? 'var(--wa)' : 'inherit' }} />WhatsApp</span>
              </button>
              <button className={kanal === 'sms' ? 'on' : ''} onClick={() => setKanal('sms')}>
                <span className="center gap-2"><Ic.sms size={15} style={{ color: kanal === 'sms' ? 'var(--sms)' : 'inherit' }} />SMS</span>
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 7 }}>TEMPLATE PESAN</div>
          <textarea className="input" rows={5} value={tpl} onChange={e => setTpl(e.target.value)}
            style={{ resize: 'none', lineHeight: 1.55, fontFamily: 'inherit' }} />
          <div className="center gap-2" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: 'var(--ink-4)', fontWeight: 700 }}>Sisipkan:</span>
            {['{nama}', '{angsuran}', '{tgl}', '{dpd}'].map(v => (
              <button key={v} className="chip mono" style={{ cursor: 'pointer', fontSize: 11.5 }}
                onClick={() => setTpl(t => t + ' ' + v)}>{v}</button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-4)', fontWeight: 600 }}>
              {tpl.length} karakter {kanal === 'sms' && `· ${Math.ceil(tpl.length / 160)} SMS`}
            </span>
          </div>

          <div className="between" style={{ margin: '20px 0 10px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-3)' }}>PENERIMA · {active.length} aktif</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setExcluded(new Set())}>Pilih semua</button>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
            {recipients.slice(0, 30).map(r => {
              const off = excluded.has(r.id);
              return (
                <label key={r.id} className="between" style={{ padding: '9px 13px', borderBottom: '1px solid var(--line)', cursor: 'pointer', opacity: off ? 0.45 : 1 }}>
                  <div className="center gap-3">
                    <input type="checkbox" checked={!off} onChange={() => toggle(r.id)} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{r.nama}</div>
                      <div className="muted mono" style={{ fontSize: 11.5 }}>{r.hp}</div>
                    </div>
                  </div>
                  <div className="center gap-2">
                    <KolBadge kol={r.kol} />
                    <span className="num muted" style={{ fontSize: 12, fontWeight: 600 }}>{RP(r.angsuran)}</span>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="between" style={{ marginTop: 18 }}>
            <div className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
              Estimasi biaya: <span className="num" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                {kanal === 'sms' ? RP(active.length * 350) : 'Gratis (WA Business)'}
              </span>
            </div>
            <button className="btn btn-primary" onClick={() => setSending('confirm')} disabled={active.length === 0}>
              {kanal === 'wa' ? <Ic.wa size={16} /> : <Ic.sms size={16} />}Kirim ke {active.length} nasabah
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-pad fade-up">
            <div className="section-title" style={{ marginBottom: 14 }}>Pratinjau {kanal === 'wa' ? 'WhatsApp' : 'SMS'}</div>
            <PhonePreview kanal={kanal} text={preview} />
          </div>
          <div className="card fade-up" style={{ overflow: 'hidden' }}>
            <div className="card-pad" style={{ paddingBottom: 10 }}><div className="section-title">Riwayat Blast</div></div>
            <div style={{ padding: '0 6px 6px' }}>
              {BLAST_HISTORY.map(b => (
                <div key={b.id} className="between" style={{ padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
                  <div className="center gap-3">
                    <div className="stat-ic" style={{
                      width: 34, height: 34,
                      background: b.kanal === 'wa' ? 'var(--accent-soft)' : 'oklch(0.93 0.04 245)',
                      color: b.kanal === 'wa' ? 'var(--wa)' : 'var(--sms)',
                    }}>{b.kanal === 'wa' ? <Ic.wa size={16} /> : <Ic.sms size={16} />}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{b.judul}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{b.tgl}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {b.status === 'terjadwal'
                      ? <Badge c="var(--col-dpk)" soft="var(--col-dpk-soft)" icon={Ic.clock}>Terjadwal</Badge>
                      : <div className="num" style={{ fontSize: 12, fontWeight: 700 }}>
                        {b.terkirim}/{b.target} <span className="muted" style={{ fontWeight: 600 }}>terkirim</span>
                      </div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {sending && <SendFlow seg={seg} kanal={kanal} count={active.length} stage={sending} setStage={setSending}
        recipientIds={active.map(r => r.id)} template={tpl} />}
    </div>
  );
}

function PhonePreview({ kanal, text }: { kanal: Kanal; text: string }) {
  return (
    <div style={{
      background: kanal === 'wa' ? 'oklch(0.93 0.02 150)' : 'var(--surface-2)',
      borderRadius: 16, padding: 16, minHeight: 180,
      backgroundImage: kanal === 'wa' ? 'radial-gradient(oklch(0.85 0.03 150 / 0.5) 1px, transparent 1px)' : 'none',
      backgroundSize: '16px 16px',
    }}>
      <div className="center gap-2" style={{ marginBottom: 12 }}>
        <div className="stat-ic" style={{ width: 30, height: 30, background: kanal === 'wa' ? 'var(--wa)' : 'var(--sms)', color: 'white' }}>
          {kanal === 'wa' ? <Ic.wa size={15} /> : <Ic.sms size={15} />}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>Bank Syariah Nasional</div>
          <div className="muted" style={{ fontSize: 10.5 }}>{kanal === 'wa' ? '+62 811 0000 1234 · Business' : 'BSNSYARIAH'}</div>
        </div>
      </div>
      <div style={{
        background: 'var(--surface)', borderRadius: '4px 14px 14px 14px',
        padding: '11px 13px', fontSize: 12.5, lineHeight: 1.55, boxShadow: 'var(--sh-1)', color: 'var(--ink)',
      }}>
        {text}
        <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--ink-4)', marginTop: 5 }} className="num">07:30 ✓✓</div>
      </div>
    </div>
  );
}

function SendFlow({ seg, kanal, count, stage, setStage, recipientIds, template }: {
  seg: SegmentDef; kanal: Kanal; count: number; stage: Stage; setStage: (s: Stage) => void;
  recipientIds: string[]; template: string;
}) {
  const [prog, setProg] = useState(0);

  useEffect(() => {
    if (stage !== 'progress') return;
    setProg(0);
    // fire-and-forget API call (mock or real)
    api.sendBlast({ segment: seg.key, channel: kanal, template, recipientIds }).catch(() => undefined);
    const t = setInterval(() => setProg(p => {
      if (p >= 100) { clearInterval(t); setStage('done'); return 100; }
      return p + 4;
    }), 60);
    return () => clearInterval(t);
  }, [stage, kanal, seg.key, template, recipientIds, setStage]);

  const sent = Math.round(count * prog / 100);

  return (
    <Modal onClose={() => stage !== 'progress' && setStage(null)} max={440}>
      {stage === 'confirm' && (
        <>
          <div className="modal-head"><div className="section-title">Konfirmasi Pengiriman Blast</div></div>
          <div className="modal-body">
            <p style={{ margin: '0 0 16px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.6 }}>
              Anda akan mengirim pesan <strong>{kanal === 'wa' ? 'WhatsApp' : 'SMS'}</strong> ke <strong>{count} nasabah</strong> pada segmen <strong>{seg.label}</strong>.
            </p>
            <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
              <div className="between" style={{ fontSize: 13 }}>
                <span className="muted">Kanal</span>
                <span style={{ fontWeight: 700 }}>{kanal === 'wa' ? 'WhatsApp Business' : 'SMS Gateway'}</span>
              </div>
              <div className="between" style={{ fontSize: 13, marginTop: 8 }}>
                <span className="muted">Penerima</span>
                <span className="num" style={{ fontWeight: 700 }}>{count} nasabah</span>
              </div>
              <div className="between" style={{ fontSize: 13, marginTop: 8 }}>
                <span className="muted">Estimasi biaya</span>
                <span className="num" style={{ fontWeight: 700 }}>{kanal === 'sms' ? RP(count * 350) : 'Gratis'}</span>
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={() => setStage(null)}>Batal</button>
            <button className="btn btn-primary" onClick={() => setStage('progress')}>Kirim Sekarang</button>
          </div>
        </>
      )}
      {stage === 'progress' && (
        <div className="modal-body" style={{ textAlign: 'center', padding: '36px 28px' }}>
          <Ring value={prog} size={80} thickness={7} />
          <div className="num" style={{ fontSize: 24, fontWeight: 800, marginTop: -56, marginBottom: 40 }}>{prog}%</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Mengirim pesan…</div>
          <div className="muted num" style={{ fontSize: 13, marginTop: 4 }}>{sent} dari {count} terkirim</div>
        </div>
      )}
      {stage === 'done' && (
        <div className="modal-body" style={{ textAlign: 'center', padding: '36px 28px' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 99, background: 'var(--accent-soft)',
            color: 'var(--accent)', display: 'grid', placeItems: 'center', margin: '0 auto 18px',
          }}><Ic.check size={32} /></div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>Blast Terkirim!</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
            {count} pesan {kanal === 'wa' ? 'WhatsApp' : 'SMS'} berhasil dikirim ke nasabah segmen {seg.label}.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 22, width: '100%' }} onClick={() => setStage(null)}>Selesai</button>
        </div>
      )}
    </Modal>
  );
}
