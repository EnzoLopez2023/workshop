import React from 'react';

interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        maxWidth: 640, margin: '80px auto', padding: '32px 28px',
        backgroundColor: 'var(--color-flap)', border: '1px solid var(--color-line)',
        borderRadius: 3, color: 'var(--color-ink)',
      }}>
        <h2 style={{ fontFamily: 'var(--font-board)', margin: '0 0 12px', fontSize: '1.5rem' }}>
          Something went wrong
        </h2>
        <p style={{ color: 'var(--color-muted)', margin: '0 0 20px' }}>
          The page hit an unexpected error. Reload to start fresh.
        </p>
        <pre style={{
          backgroundColor: 'var(--color-flap-shade)', padding: 12, borderRadius: 3,
          fontSize: '0.78rem', whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 240,
        }}>
          {this.state.error.message}
        </pre>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
          style={{ marginTop: 18 }}
        >
          Reload
        </button>
      </div>
    );
  }
}
