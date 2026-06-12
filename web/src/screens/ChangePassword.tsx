import { useState, type FormEvent } from 'react';
import { Ic } from '../components/Icons';
import { Modal } from '../components/UI';
import { changePassword, doLogout } from '../lib/auth';

const MIN_LEN = 12;

interface Check { label: string; ok: (pw: string) => boolean }
const CHECKS: Check[] = [
  { label: `Minimal ${MIN_LEN} karakter`, ok: (p) => p.length >= MIN_LEN },
  { label: 'Huruf besar & kecil', ok: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'Angka', ok: (p) => /\d/.test(p) },
  { label: 'Simbol (! @ # …)', ok: (p) => /[^A-Za-z0-9]/.test(p) },
];

interface Props { forced?: boolean; onClose?: () => void }

export function ChangePassword({ forced, onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const checks = CHECKS.map(c => ({ ...c, passed: c.ok(next) }));
  const allChecks = checks.every(c => c.passed);
  const matches = next.length > 0 && next === confirm;
  const canSubmit = !busy && current.length > 0 && allChecks && matches;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await changePassword(current, next);
      // Backend revokes all refresh tokens → force re-login.
      await doLogout();
    } catch (e: any) {
      const code = e?.response?.data?.error;
      if (code === 'invalid_credentials') setErr('Password saat ini salah.');
      else if (code === 'weak_password') setErr('Password baru belum memenuhi syarat keamanan.');
      else if (code === 'same_password') setErr('Password baru tidak boleh sama dengan password saat ini.');
      else setErr('Gagal mengubah password. Coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={() => { if (!forced && onClose) onClose(); }} max={460}>
      <form onSubmit={submit}>
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <div className="section-title">{forced ? 'Ganti Password Wajib' : 'Ganti Password'}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
              {forced
                ? 'Anda harus mengganti password sebelum bisa melanjutkan.'
                : 'Anda akan diminta login ulang setelah berhasil ganti password.'}
            </div>
          </div>
          {!forced && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic.x size={16} /></button>
          )}
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Password saat ini" value={current} onChange={setCurrent} autoComplete="current-password" />
          <Field label="Password baru" value={next} onChange={setNext} autoComplete="new-password" />
          <Field label="Konfirmasi password baru" value={confirm} onChange={setConfirm} autoComplete="new-password" />

          <div className="card card-pad" style={{ background: 'var(--surface-2)', boxShadow: 'none', padding: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 8, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Syarat password
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {checks.map((c, i) => (
                <div key={i} className="center gap-2" style={{ fontSize: 12, color: c.passed ? 'var(--accent)' : 'var(--ink-3)', fontWeight: 600 }}>
                  {c.passed ? <Ic.checkCircle size={14} /> : <Ic.x size={14} />}
                  {c.label}
                </div>
              ))}
              <div className="center gap-2" style={{ fontSize: 12, color: matches ? 'var(--accent)' : 'var(--ink-3)', fontWeight: 600 }}>
                {matches ? <Ic.checkCircle size={14} /> : <Ic.x size={14} />}
                Konfirmasi cocok
              </div>
            </div>
          </div>

          {err && (
            <div className="center gap-2" style={{
              background: 'var(--col-macet-soft)', color: 'var(--col-macet)',
              borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
            }}>
              <Ic.alert size={15} />{err}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {!forced && <button type="button" className="btn" onClick={onClose}>Batal</button>}
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Menyimpan…' : 'Simpan & Logout'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 5 }}>
        {label}
      </span>
      <div className="search">
        <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} required maxLength={256} />
        <button type="button" onClick={() => setShow(s => !s)}
          style={{ border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer' }}
          aria-label={show ? 'Sembunyikan' : 'Tampilkan'}>
          <Ic.eye size={16} />
        </button>
      </div>
    </label>
  );
}
