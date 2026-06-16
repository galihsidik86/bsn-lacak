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
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
      background: 'linear-gradient(160deg, var(--bg) 0%, var(--accent-soft) 100%)',
    }}>
      <form onSubmit={totp ? submitTotp : submit} className="card fade-up"
        style={{ width: '100%', maxWidth: 420, padding: 32, boxShadow: 'var(--sh-3)' }}>
        <div className="center gap-3" style={{ marginBottom: 22 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, flex: 'none',
            background: 'linear-gradient(150deg, var(--accent), var(--accent-700))',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 6px 16px oklch(0.50 0.12 162 / 0.4), inset 0 0 0 1px oklch(0.85 0.1 84 / 0.35)',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7">
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
              <rect x="5" y="5" width="14" height="14" rx="1.5" transform="rotate(45 12 12)" />
              <circle cx="12" cy="12" r="2.4" fill="var(--gold)" stroke="none" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.1 }}>BSN Lacak</div>
            <div style={{ fontSize: 12, color: 'var(--gold-ink)', fontWeight: 700 }}>Bank Syariah Nasional</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '4px 0 4px' }}>
          {totp ? 'Kode Verifikasi 2FA' : 'Masuk ke Dashboard'}
        </h1>
        <p className="muted" style={{ fontSize: 13.5, margin: '0 0 22px', lineHeight: 1.5 }}>
          {totp
            ? `Buka aplikasi authenticator Anda dan masukkan kode 6-digit untuk ${totp.username}.`
            : 'Sistem Tracking Penagihan untuk supervisor dan petugas lapangan.'}
        </p>

        {totp ? (
          <>
            <label style={{ display: 'block', marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
                Kode 6-digit
              </span>
              <div className="search">
                <Ic.eye size={16} />
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric" pattern="\d{6}" autoFocus required
                  className="num" style={{ letterSpacing: 4, fontWeight: 700, fontSize: 16 }}
                  placeholder="••••••" />
              </div>
            </label>

            {err && (
              <div className="center gap-2" style={{
                background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
                borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
                marginBottom: 14,
              }}>
                <Ic.alert size={15} />{err}
              </div>
            )}

            <button type="submit" className="btn btn-primary"
              disabled={busy || code.length !== 6}
              style={{ width: '100%', padding: '12px 14px', fontSize: 14, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Memverifikasi…' : 'Verifikasi & Masuk'}
            </button>
            <button type="button" className="btn"
              onClick={backToCreds}
              style={{ width: '100%', padding: '10px 14px', fontSize: 13, marginTop: 10, background: 'transparent' }}>
              ← Kembali ke login
            </button>
          </>
        ) : (
        <>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
            Username
          </span>
          <div className="search">
            <Ic.user size={16} />
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoFocus required maxLength={64}
              placeholder="supervisor / p1" />
          </div>
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
            Password
          </span>
          <div className="search">
            <Ic.settings size={16} />
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required maxLength={256}
              placeholder="••••••••" />
            <button type="button" onClick={() => setShow(s => !s)}
              style={{ border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer' }}
              aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}>
              <Ic.eye size={16} />
            </button>
          </div>
        </label>

        {err && (
          <div className="center gap-2" style={{
            background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
            marginBottom: 14,
          }}>
            <Ic.alert size={15} />{err}
          </div>
        )}

        <button type="submit" className="btn btn-primary"
          disabled={busy || !username || !password}
          style={{ width: '100%', padding: '12px 14px', fontSize: 14, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Memverifikasi…' : (<><Ic.arrowRight size={16} />Masuk</>)}
        </button>
        </>
        )}

        <p className="muted" style={{ fontSize: 11.5, marginTop: 18, textAlign: 'center', lineHeight: 1.5 }}>
          Dengan masuk, Anda menyetujui kebijakan akses & audit log internal BSN.
        </p>
      </form>
    </div>
  );
}
