import { useEffect, useState } from 'react';
import axios from 'axios';
import { Ic } from './Icons';
import { tokenStore } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL || '/api';

type Prefs = Partial<Record<'flagged' | 'reviewResult' | 'sla' | 'announcement' | 'assignment', boolean>>;

const META: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'flagged',       label: 'Laporan kena flag anti-fraud', hint: 'Saat kunjungan ter-flag (risk score > 0) butuh review.' },
  { key: 'reviewResult',  label: 'Hasil review supervisor',      hint: 'Saat laporan Anda di-setujui atau di-tolak.' },
  { key: 'sla',           label: 'SLA breach',                   hint: 'Kunjungan PENDING melebihi window SLA tanpa review.' },
  { key: 'announcement',  label: 'Pengumuman supervisor',        hint: 'Broadcast dari supervisor atau ADMIN.' },
  { key: 'assignment',    label: 'Penugasan nasabah',            hint: 'Saat nasabah baru di-assign ke Anda.' },
];

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function NotifPrefsCard() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${BASE}/notifications/prefs`, { withCredentials: true, headers: authHeaders() });
        setPrefs(r.data);
      } catch { setPrefs({}); }
    })();
  }, []);

  const toggle = async (key: keyof Prefs) => {
    if (!prefs || busy) return;
    setBusy(true);
    const updated = { ...prefs, [key]: !(prefs[key] ?? true) };
    setPrefs(updated);
    try {
      await axios.patch(`${BASE}/notifications/prefs`, { [key]: updated[key] }, {
        withCredentials: true, headers: authHeaders(),
      });
    } catch {
      // Revert on failure.
      setPrefs(prefs);
    } finally {
      setBusy(false);
    }
  };

  if (!prefs) return null;

  return (
    <div className="card card-pad fade-up" style={{ marginBottom: 18 }}>
      <div className="section-title" style={{ marginBottom: 6 }}>Preferensi Notifikasi</div>
      <div className="page-sub" style={{ marginBottom: 16 }}>
        Pilih notifikasi mana yang Anda terima. Diterapkan ke bel notifikasi dan push OS.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {META.map(m => {
          const on = prefs[m.key] !== false;
          return (
            <button key={m.key} onClick={() => toggle(m.key)} disabled={busy}
              className="between" style={{
                width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12,
                background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                border: '1px solid var(--line)', cursor: 'pointer',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="center gap-2" style={{ fontWeight: 700, fontSize: 13 }}>
                  {on && <Ic.checkCircle size={14} style={{ color: 'var(--accent)' }} />}
                  {m.label}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.4 }}>{m.hint}</div>
              </div>
              <span style={{
                width: 38, height: 22, borderRadius: 99, flex: 'none',
                background: on ? 'var(--accent)' : 'var(--line-2)',
                position: 'relative', transition: 'background 0.15s',
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: on ? 18 : 2,
                  width: 18, height: 18, borderRadius: 99, background: 'white',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)', transition: 'left 0.15s',
                }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
