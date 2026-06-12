import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { err: Error | null }

// Without an error boundary, a thrown render error unmounts the whole React
// tree in production builds — the user just sees a blank page. This catches
// it and shows the message + a way to recover.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State { return { err }; }

  componentDidCatch(err: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[bsn] uncaught render error:', err, info.componentStack);
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)' }}>
        <div className="card card-pad" style={{ maxWidth: 520, textAlign: 'center' }}>
          <div className="stat-ic" style={{ width: 52, height: 52, margin: '0 auto 16px', background: 'var(--col-macet-soft)', color: 'var(--col-macet)' }}>!</div>
          <h2 style={{ fontWeight: 800, fontSize: 18, margin: '0 0 8px' }}>Terjadi kesalahan</h2>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55, margin: '0 0 16px' }}>
            Halaman ini mengalami error saat dimuat. Coba muat ulang. Kalau berulang, hubungi administrator dan sertakan pesan di bawah.
          </p>
          <pre style={{
            textAlign: 'left', background: 'var(--surface-2)', padding: 12, borderRadius: 8,
            fontSize: 11.5, fontFamily: 'var(--mono)', overflow: 'auto', maxHeight: 200,
          }}>{this.state.err.message}</pre>
          <button className="btn btn-primary" style={{ marginTop: 16, width: '100%' }}
            onClick={() => { this.setState({ err: null }); location.reload(); }}>
            Muat Ulang
          </button>
        </div>
      </div>
    );
  }
}
