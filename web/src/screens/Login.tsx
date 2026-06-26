import { useState, type FormEvent } from 'react';
import { Ic } from '../components/Icons';
import { doLogin, doTotpLogin } from '../lib/auth';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [totp, setTotp] = useState<{ challenge: string; username: string } | null>(null);
  const [code, setCode] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !username || !password) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await doLogin(username.trim(), password);
      if (result.kind === 'totp') {
        setTotp({ challenge: result.totpChallenge, username: result.username });
      }
    } catch (e: any) {
      const code = e?.response?.data?.error;
      const status = e?.response?.status;
      if (status === 423) setErr('Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');
      else if (code === 'invalid_credentials') setErr('Username atau password salah.');
      else if (status === 429) setErr('Terlalu banyak percobaan. Tunggu beberapa menit.');
      else setErr('Gagal masuk. Periksa koneksi atau hubungi administrator.');
    } finally {
      setBusy(false);
    }
  };

  const submitTotp = async (e: FormEvent) => {
    e.preventDefault();
    if (!totp || busy || code.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      await doTotpLogin(totp.challenge, code, totp.username);
    } catch (e: any) {
      const c = e?.response?.data?.error;
      if (c === 'invalid_code') setErr('Kode salah. Coba lagi.');
      else if (c === 'challenge_invalid') {
        setErr('Sesi 2FA kedaluwarsa. Login ulang.');
        setTotp(null); setCode(''); setPassword('');
      }
      else setErr('Gagal verifikasi. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const backToCreds = () => { setTotp(null); setCode(''); setErr(null); };

  return (
    <div className="m-login-shell">
      <form onSubmit={totp ? submitTotp : submit} className="m-login-card">
        <div className="m-login-brand">
          <div className="m-login-mark">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7" aria-hidden="true">
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
              <rect x="5" y="5" width="14" height="14" rx="1.5" transform="rotate(45 12 12)" />
              <circle cx="12" cy="12" r="2.4" fill="var(--gold)" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="m-login-brand-name">BSN Lacak</div>
            <div className="m-login-brand-sub">Bank Syariah Nasional</div>
          </div>
        </div>

        <h1 className="m-login-title">
          {totp ? 'Kode Verifikasi 2FA' : 'Masuk ke Dashboard'}
        </h1>
        <p className="m-login-intro">
          {totp
            ? `Buka aplikasi authenticator Anda dan masukkan kode 6-digit untuk ${totp.username}.`
            : 'Sistem Tracking Penagihan untuk supervisor dan petugas lapangan.'}
        </p>

        {totp ? (
          <>
            <label className="m-login-field">
              <span className="m-login-field-label">Kode 6-digit</span>
              <div className="m-login-input-wrap">
                <Ic.eye size={18} aria-hidden="true" />
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric" pattern="\d{6}" autoFocus required
                  className="num" style={{ letterSpacing: 6, fontWeight: 700, fontSize: '1.125rem' }}
                  placeholder="••••••" />
              </div>
            </label>

            {err && (
              <div className="m-login-error">
                <Ic.alert size={16} aria-hidden="true" />{err}
              </div>
            )}

            <button type="submit" className="m-login-submit" disabled={busy || code.length !== 6}>
              {busy ? 'Memverifikasi…' : 'Verifikasi & Masuk'}
            </button>
            <button type="button" className="m-login-back" onClick={backToCreds}>
              ← Kembali ke login
            </button>
          </>
        ) : (
          <>
            <label className="m-login-field">
              <span className="m-login-field-label">Username</span>
              <div className="m-login-input-wrap">
                <Ic.user size={18} aria-hidden="true" />
                <input value={username} onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username" autoFocus required maxLength={64}
                  placeholder="supervisor / p1" />
              </div>
            </label>

            <label className="m-login-field">
              <span className="m-login-field-label">Password</span>
              <div className="m-login-input-wrap">
                <Ic.settings size={18} aria-hidden="true" />
                <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required maxLength={256}
                  placeholder="••••••••" />
                <button type="button" onClick={() => setShow(s => !s)}
                  className="m-login-toggle"
                  aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}>
                  <Ic.eye size={18} aria-hidden="true" />
                </button>
              </div>
            </label>

            {err && (
              <div className="m-login-error">
                <Ic.alert size={16} aria-hidden="true" />{err}
              </div>
            )}

            <button type="submit" className="m-login-submit"
              disabled={busy || !username || !password}>
              {busy ? 'Memverifikasi…' : (<><Ic.arrowRight size={18} aria-hidden="true" />Masuk</>)}
            </button>
          </>
        )}

        <p className="m-login-footnote">
          Dengan masuk, Anda menyetujui kebijakan akses & audit log internal BSN.
        </p>
      </form>
    </div>
  );
}
