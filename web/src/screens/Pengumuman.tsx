import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { Ic } from '../components/Icons';
import { tokenStore } from '../lib/api';
import { useAuth } from '../lib/auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

type Severity = 'INFO' | 'WARN' | 'CRIT';
type Audience = 'PETUGAS' | 'SUPERVISOR' | 'ALL';

function headers() {
  const t = tokenStore.get();
  const h: Record<string, string> = {};
  if (t) h.Authorization = `Bearer ${t}`;
  const o = useAuth.getState().branchOverride;
  if (o) h['x-branch-id'] = o;
  return h;
}

async function broadcast(payload: {
  title: string; body?: string; severity: Severity; audience: Audience; link?: string;
}): Promise<{ ok: boolean; recipients: number }> {
  return (await axios.post(`${BASE}/announcements/broadcast`, payload, {
    withCredentials: true, headers: headers(),
  })).data;
}

const SEVERITY_META: Record<Severity, { label: string; bg: string; color: string }> = {
  INFO: { label: 'Info', bg: 'var(--accent-soft)', color: 'var(--accent)' },
  WARN: { label: 'Peringatan', bg: 'var(--col-dpk-soft)', color: 'var(--col-dpk)' },
  CRIT: { label: 'Kritis', bg: 'var(--col-macet-soft)', color: 'var(--col-macet)' },
};

export function ScreenPengumuman() {
  const role = useAuth(s => s.user?.role);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Severity>('INFO');
  const [audience, setAudience] = useState<Audience>('PETUGAS');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const canSubmit = !busy && title.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(null); setOkMsg(null);
    try {
      const r = await broadcast({
        title: title.trim(),
        body: body.trim() || undefined,
        severity, audience,
      });
      setOkMsg(`Terkirim ke ${r.recipients} penerima.`);
      setTitle(''); setBody(''); setSeverity('INFO');
    } catch (e: any) {
      const c = e?.response?.data?.error;
      if (c === 'no_recipients') setErr('Tidak ada penerima sesuai filter audience + cabang.');
      else setErr('Gagal mengirim pengumuman.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content" style={{ maxWidth: 720, margin: '0 auto' }}>
      <form onSubmit={submit} className="card card-pad fade-up">
        <div className="section-title" style={{ marginBottom: 6 }}>Kirim Pengumuman</div>
        <div className="page-sub" style={{ marginBottom: 18 }}>
          Broadcast notifikasi sekaligus ke seluruh petugas (atau supervisor) di cabang Anda.
          Penerima dapat di bel notifikasi + push OS.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <Label>Judul</Label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)}
              required maxLength={200} placeholder="Briefing pagi · jam 07:00 di kantor cabang" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Label>Isi (opsional)</Label>
            <textarea className="input" rows={4} value={body} onChange={e => setBody(e.target.value)}
              maxLength={2000} placeholder="Detail pengumuman, instruksi, atau pengingat…"
              style={{ resize: 'vertical' }} />
          </div>
          <div>
            <Label>Tingkat Kepentingan</Label>
            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              {(Object.keys(SEVERITY_META) as Severity[]).map(s => {
                const meta = SEVERITY_META[s];
                const on = severity === s;
                return (
                  <button key={s} type="button" onClick={() => setSeverity(s)} style={{
                    padding: '10px 8px', borderRadius: 10, fontWeight: 700, fontSize: 12.5,
                    border: on ? `1.5px solid ${meta.color}` : '1px solid var(--line)',
                    background: on ? meta.bg : 'var(--surface)',
                    color: on ? meta.color : 'var(--ink-2)',
                    cursor: 'pointer',
                  }}>{meta.label}</button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Audience</Label>
            <select className="input" value={audience} onChange={e => setAudience(e.target.value as Audience)}>
              <option value="PETUGAS">Petugas (di cabang Anda)</option>
              {role !== 'PETUGAS' && <option value="SUPERVISOR">Supervisor</option>}
              <option value="ALL">Semua (petugas + supervisor)</option>
            </select>
          </div>
        </div>

        {err && (
          <div className="center gap-2" style={{
            marginTop: 14, background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
          }}>
            <Ic.alert size={15} />{err}
          </div>
        )}
        {okMsg && (
          <div className="center gap-2" style={{
            marginTop: 14, background: 'var(--accent-soft)', color: 'var(--accent-ink)',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
          }}>
            <Ic.checkCircle size={15} />{okMsg}
          </div>
        )}

        <div className="center gap-2" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Mengirim…' : <><Ic.send size={15} />Kirim</>}
          </button>
        </div>
      </form>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
      {children}
    </span>
  );
}
