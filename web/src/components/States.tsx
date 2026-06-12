import type { ReactNode } from 'react';
import { Ic } from './Icons';

export function Skeleton({ h = 120 }: { h?: number }) {
  return (
    <div className="card" style={{
      height: h, padding: 18,
      background: 'linear-gradient(110deg, var(--surface-2) 30%, var(--surface) 50%, var(--surface-2) 70%)',
      backgroundSize: '200% 100%', animation: 'sk 1.4s ease-in-out infinite',
    }} />
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="card card-pad" style={{ textAlign: 'center', padding: '36px 24px' }}>
      <div className="stat-ic" style={{ width: 48, height: 48, margin: '0 auto 12px', background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>
        <Ic.alert size={22} />
      </div>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Gagal memuat data</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
        {message ?? 'Periksa koneksi internet atau coba lagi sebentar.'}
      </div>
      {onRetry && (
        <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={onRetry}>
          <Ic.send size={14} />Coba lagi
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--ink-4)' }}>
      <div className="stat-ic" style={{ width: 48, height: 48, margin: '0 auto 12px', background: 'var(--surface-2)', color: 'var(--ink-4)' }}>
        {icon ?? <Ic.search size={22} />}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-2)' }}>{title}</div>
      {hint && <div style={{ fontSize: 13, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
