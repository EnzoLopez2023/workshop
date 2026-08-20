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
      <main className="fatal-state" role="alert">
        <span className="fatal-state-mark" aria-hidden="true">!</span>
        <h1>Workshop could not open this page</h1>
        <p>The page hit an unexpected error. Reload it to return to the saved workspace.</p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
        <details>
          <summary>Technical details</summary>
          <pre>{this.state.error.message}</pre>
        </details>
      </main>
    );
  }
}
