import { useMemo, useState } from 'react';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { Avatar, AreaChart, Badge, Donut, Modal, Stat, cssVar } from '../components/UI';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import {
  RP, RPjt, useNasabahList, usePayflow, usePetugasFinder,
} from '../data/queries';
import { downloadAuthed } from '../lib/download';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Nasabah, Petugas } from '../types';

const BASE = import.meta.env.VITE_API_URL || '/api';

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const override = useAuth.getState().branchOverride;
  if (override) h['x-branch-id'] = override;
  return h;
}

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
          <div className="center gap-2">
            <BulkImportButton />
            <ExportCsvButton range={range} />
          </div>
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

// Bulk import pembayaran from CSV. Browser parses + validates, then POSTs
// the row array to /angsuran/bulk. The server applies them in one
// transaction and returns per-row outcomes.
interface ParsedPay {
  row: number;
  data?: {
    kodeNasabah: string;
    tanggal: string;
    jam: string;
    metode: 'tunai' | 'transfer' | 'autodebet';
    status: 'berhasil' | 'pending' | 'gagal';
    nominal: number;
  };
  errors: string[];
}

const PAY_CSV_HEADERS = ['kodeNasabah', 'tanggal', 'jam', 'metode', 'status', 'nominal'];
const PAY_SAMPLE_CSV = PAY_CSV_HEADERS.join(',') + '\n' +
  'N2024001,2026-06-15,09:30,tunai,berhasil,500000\n' +
  'N2024002,2026-06-15,11:00,transfer,berhasil,750000\n' +
  'N2024003,2026-06-16,08:45,autodebet,pending,250000\n';

function downloadPayTemplate() {
  const blob = new Blob(['\ufeff' + PAY_SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'template-pembayaran.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// Same RFC-4180 parser as in Nasabah.tsx — kept inline so the chunk stays
// independent and we don't grow a shared util that only has two callers.
function parsePayCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (cur !== '' || row.length > 0) { row.push(cur); out.push(row); row = []; cur = ''; }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else cur += c;
  }
  if (cur !== '' || row.length > 0) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(cell => cell !== ''));
}

function BulkImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        <Ic.download size={14} style={{ transform: 'rotate(180deg)' }} />Import CSV
      </button>
      {open && <BulkImport onClose={() => setOpen(false)} onDone={() => { setOpen(false); window.location.reload(); }} />}
    </>
  );
}

function BulkImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [parsed, setParsed] = useState<ParsedPay[]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{ imported: number; total: number; outcomes: Array<{ kodeNasabah: string; status: string }> } | null>(null);
  const [sending, setSending] = useState(false);
  const [globalErr, setGlobalErr] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    setGlobalErr(null);
    const text = await file.text();
    const rows = parsePayCsv(text);
    if (rows.length < 2) { setGlobalErr('File CSV kosong atau tidak punya header.'); return; }
    const header = rows[0].map(h => h.trim());
    const colIdx = (k: string) => header.findIndex(h => h.toLowerCase() === k.toLowerCase());

    const missing = ['kodeNasabah', 'tanggal', 'nominal'].filter(c => colIdx(c) < 0);
    if (missing.length) { setGlobalErr(`Header CSV kurang kolom: ${missing.join(', ')}`); return; }

    const out: ParsedPay[] = [];
    for (let r = 1; r < rows.length; r++) {
      const errs: string[] = [];
      const row = rows[r];
      const get = (k: string) => {
        const i = colIdx(k);
        return i >= 0 ? (row[i] ?? '').trim() : '';
      };
      const kodeNasabah = get('kodeNasabah');
      if (!kodeNasabah) errs.push('kodeNasabah wajib');
      const tanggalStr = get('tanggal');
      if (!/^\d{4}-\d{2}-\d{2}/.test(tanggalStr)) errs.push('tanggal harus YYYY-MM-DD');
      const jam = get('jam') || '00:00';
      if (!/^\d{2}:\d{2}$/.test(jam)) errs.push('jam harus HH:MM');
      const metode = (get('metode') || 'tunai').toLowerCase() as 'tunai' | 'transfer' | 'autodebet';
      if (!['tunai', 'transfer', 'autodebet'].includes(metode)) errs.push('metode tidak valid');
      const status = (get('status') || 'berhasil').toLowerCase() as 'berhasil' | 'pending' | 'gagal';
      if (!['berhasil', 'pending', 'gagal'].includes(status)) errs.push('status tidak valid');
      const nominalRaw = get('nominal').replace(/[^\d.-]/g, '');
      const nominal = Number(nominalRaw);
      if (!Number.isFinite(nominal) || nominal <= 0) errs.push('nominal harus angka > 0');

      out.push({
        row: r + 1,
        data: errs.length === 0
          ? { kodeNasabah, tanggal: tanggalStr, jam, metode, status, nominal }
          : undefined,
        errors: errs,
      });
    }
    setParsed(out);
  };

  const valid = parsed.filter(p => p.data && p.errors.length === 0);
  const invalid = parsed.filter(p => p.errors.length > 0);
  const totalNominal = valid.reduce((s, p) => s + (p.data?.nominal ?? 0), 0);

  const submit = async () => {
    if (valid.length === 0) return;
    setSending(true);
    try {
      const r = await axios.post(`${BASE}/angsuran/bulk`,
        { rows: valid.map(p => p.data!) },
        { withCredentials: true, headers: headers() });
      setResult(r.data);
    } catch (e: any) {
      setGlobalErr(e?.response?.data?.error === 'rate_limited'
        ? 'Terlalu banyak request. Coba lagi sebentar.'
        : 'Gagal import. Periksa data.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal onClose={onClose} max={780}>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="section-title">Bulk Import Pembayaran</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            Upload CSV (max 2.000 baris). Sisa outstanding nasabah akan dikurangi otomatis untuk status berhasil.
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
      </div>
      <div className="modal-body">
        {!result && (
          <>
            <div className="between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <label className="btn">
                <Ic.download size={15} style={{ transform: 'rotate(180deg)' }} />Pilih file CSV
                <input type="file" accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
              </label>
              <button className="btn btn-sm btn-ghost" onClick={downloadPayTemplate}>
                <Ic.download size={13} />Unduh template
              </button>
              {fileName && <span className="muted mono" style={{ fontSize: 11.5 }}>{fileName}</span>}
            </div>

            {globalErr && (
              <div className="center gap-2" style={{
                marginBottom: 12, background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
                borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
              }}>
                <Ic.alert size={15} />{globalErr}
              </div>
            )}

            {parsed.length > 0 && (
              <>
                <div className="center gap-3" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                  <div className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
                    <Ic.checkCircle size={13} />{valid.length} valid · {RP(totalNominal)}
                  </div>
                  {invalid.length > 0 && (
                    <div className="chip" style={{ background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
                      <Ic.alert size={13} />{invalid.length} error
                    </div>
                  )}
                </div>
                <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                      <tr><th>Row</th><th>Nasabah</th><th>Tanggal</th><th style={{ textAlign: 'right' }}>Nominal</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {parsed.map(p => (
                        <tr key={p.row} style={{ background: p.errors.length ? 'var(--col-macet-soft)' : undefined }}>
                          <td className="mono">{p.row}</td>
                          <td className="mono">{p.data?.kodeNasabah ?? '—'}</td>
                          <td className="mono">{p.data?.tanggal ?? '—'}</td>
                          <td className="num" style={{ textAlign: 'right' }}>{p.data ? RP(p.data.nominal) : '—'}</td>
                          <td style={{ fontSize: 11.5 }}>
                            {p.errors.length === 0
                              ? <span style={{ color: 'var(--accent)' }}>OK</span>
                              : <span style={{ color: 'var(--col-macet)' }}>{p.errors.join(' · ')}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {result && (
          <div>
            <div className="card card-pad" style={{ background: 'var(--accent-soft)', boxShadow: 'none', marginBottom: 12 }}>
              <div className="center gap-2" style={{ color: 'var(--accent-ink)', fontWeight: 800, fontSize: 14 }}>
                <Ic.checkCircle size={18} />{result.imported} pembayaran ter-import dari {result.total} baris.
              </div>
            </div>
            {result.outcomes.filter(o => o.status !== 'imported').length > 0 && (
              <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 12 }}>
                <table className="table" style={{ fontSize: 12 }}>
                  <thead><tr><th>Kode Nasabah</th><th>Status</th></tr></thead>
                  <tbody>
                    {result.outcomes.filter(o => o.status !== 'imported').map((o, i) => (
                      <tr key={`${o.kodeNasabah}-${i}`}>
                        <td className="mono">{o.kodeNasabah}</td>
                        <td style={{ color: 'var(--col-macet)' }}>{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="modal-foot">
        {result
          ? <button className="btn btn-primary" onClick={onDone}>Selesai</button>
          : <>
              <button className="btn" onClick={onClose}>Batal</button>
              <button className="btn btn-primary" disabled={valid.length === 0 || sending} onClick={submit}>
                {sending ? 'Mengirim…' : `Import ${valid.length} baris`}
              </button>
            </>
        }
      </div>
    </Modal>
  );
}
