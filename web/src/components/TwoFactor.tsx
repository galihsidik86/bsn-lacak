import { useEffect, useState } from 'react';
import axios from 'axios';
import QRCode from 'qrcode';
import { Ic } from './Icons';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

interface Status { enabled: boolean; pending: boolean; enabledAt: string | null }
interface SetupData { secret: string; otpauth: string }

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchStatus(): Promise<Status> {
  return (await axios.get(`${BASE}/auth/totp/status`, {
    withCredentials: true, headers: authHeaders(),
  })).data;
}

async function startSetup(): Promise<SetupData> {
  return (await axios.post(`${BASE}/auth/totp/setup`, {}, {
    withCredentials: true, headers: authHeaders(),
  })).data;
}

async function verifySetup(code: string): Promise<void> {
  await axios.post(`${BASE}/auth/totp/verify-setup`, { code }, {
    withCredentials: true, headers: authHeaders(),
  });
}

async function disable(code: string, currentPassword: string): Promise<void> {
  await axios.post(`${BASE}/auth/totp/disable`, { code, currentPassword }, {
    withCredentials: true, headers: authHeaders(),
  });
}

export function TwoFactorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const refresh = async () => {
    try { setStatus(await fetchStatus()); } catch { /* ignore */ }
  };

  useEffect(() => { void refresh(); }, []);

  const beginSetup = async () => {
    setBusy(true); setErr(null);
    try {
      const s = await startSetup();
      setSetup(s);
      setQrSrc(await QRCode.toDataURL(s.otpauth, { margin: 1, width: 220 }));
    } catch (e: any) {
      if (e?.response?.data?.error === 'already_enabled') setErr('2FA sudah aktif.');
      else setErr('Gagal memulai setup.');
    } finally { setBusy(false); }
  };

  const finishSetup = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true); setErr(null);
    try {
      await verifySetup(code);
      setSetup(null); setQrSrc(null); setCode('');
      await refresh();
    } catch (e: any) {
      if (e?.response?.data?.error === 'invalid_code') setErr('Kode salah. Coba lagi.');
      else setErr('Gagal verifikasi.');
    } finally { setBusy(false); }
  };

  const submitDisable = async () => {
    if (code.length !== 6 || !pw || busy) return;
    setBusy(true); setErr(null);
    try {
      await disable(code, pw);
      setDisabling(false); setCode(''); setPw('');
      await refresh();
    } catch (e: any) {
      const c = e?.response?.data?.error;
      if (c === 'invalid_code') setErr('Kode salah.');
      else if (c === 'invalid_password') setErr('Password saat ini salah.');
      else setErr('Gagal menonaktifkan.');
    } finally { setBusy(false); }
  };

  if (!status) return null;

  return (
    <div className="card card-pad fade-up" style={{ marginBottom: 18 }}>
      <div className="between" style={{ marginBottom: 6 }}>
        <div className="section-title">Two-Factor Authentication (2FA)</div>
        {status.enabled && (
          <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
            <Ic.checkCircle size={13} />Aktif
          </span>
        )}
      </div>
      <div className="page-sub" style={{ marginBottom: 16 }}>
        Tambahkan lapis verifikasi kedua dengan aplikasi authenticator (Google Authenticator, Authy, 1Password) untuk
        memperkuat keamanan akun Anda.
      </div>

      {/* IDLE: not enabled, no pending setup */}
      {!status.enabled && !setup && (
        <button className="btn btn-primary" onClick={beginSetup} disabled={busy}>
          <Ic.bell size={15} />Aktifkan 2FA
        </button>
      )}

      {/* SETUP IN PROGRESS */}
      {setup && (
        <div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
            <li>Scan QR berikut di aplikasi authenticator, atau masukkan kode manual.</li>
            <li>Setelah ter-pair, ketik kode 6-digit yang muncul.</li>
            <li>Mulai login berikutnya, Anda akan diminta kode ini.</li>
          </ol>
          <div className="grid gap-4" style={{ gridTemplateColumns: '220px 1fr', marginTop: 14, alignItems: 'start' }}>
            <div>
              {qrSrc && <img src={qrSrc} alt="QR setup 2FA" style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid var(--line)' }} />}
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, marginTop: 8 }}>Kode manual</div>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, wordBreak: 'break-all' }}>{setup.secret}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Kode dari aplikasi authenticator
              </div>
              <input className="input" inputMode="numeric" pattern="\d{6}" maxLength={6}
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                style={{ letterSpacing: 4, fontWeight: 700, fontSize: 16, width: '100%' }} />
              {err && (
                <div className="center gap-2" style={{
                  marginTop: 10, background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
                  borderRadius: 10, padding: '8px 10px', fontSize: 12, fontWeight: 600,
                }}>
                  <Ic.alert size={14} />{err}
                </div>
              )}
              <div className="center gap-2" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => { setSetup(null); setQrSrc(null); setCode(''); setErr(null); }}>Batal</button>
                <button className="btn btn-primary" onClick={finishSetup} disabled={busy || code.length !== 6}>
                  {busy ? 'Verifikasi…' : 'Aktifkan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ALREADY ENABLED */}
      {status.enabled && !setup && (
        <>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Aktif sejak {status.enabledAt ? new Date(status.enabledAt).toLocaleString('id-ID') : '—'}.
          </div>
          {!disabling ? (
            <button className="btn" onClick={() => { setDisabling(true); setErr(null); }}
              style={{ marginTop: 14, background: 'var(--col-macet-soft)', color: 'var(--col-macet)', border: 'none' }}>
              <Ic.x size={15} />Matikan 2FA
            </button>
          ) : (
            <div style={{ marginTop: 14, padding: 14, background: 'var(--col-macet-soft)', borderRadius: 12 }}>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                Untuk mematikan 2FA, masukkan password Anda saat ini dan kode aktual dari aplikasi authenticator.
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <input className="input" type="password" value={pw} onChange={e => setPw(e.target.value)}
                  placeholder="Password saat ini" autoComplete="current-password" />
                <input className="input" inputMode="numeric" pattern="\d{6}" maxLength={6}
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Kode 6-digit"
                  style={{ letterSpacing: 4, fontWeight: 700 }} />
              </div>
              {err && (
                <div className="center gap-2" style={{
                  marginTop: 10, background: 'var(--surface)', color: 'var(--col-macet)',
                  borderRadius: 10, padding: '8px 10px', fontSize: 12, fontWeight: 600,
                }}>
                  <Ic.alert size={14} />{err}
                </div>
              )}
              <div className="center gap-2" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => { setDisabling(false); setCode(''); setPw(''); setErr(null); }}>Batal</button>
                <button className="btn" onClick={submitDisable} disabled={busy || code.length !== 6 || !pw}
                  style={{ background: 'var(--col-macet)', color: 'white', border: 'none' }}>
                  {busy ? 'Memproses…' : 'Matikan 2FA'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
