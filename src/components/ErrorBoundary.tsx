import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const LAYOUT_KEY = "ydevdesk_layout_v2";

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("YDevDesk ErrorBoundary:", error, info);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleResetLayoutAndReload = () => {
    try {
      localStorage.removeItem(LAYOUT_KEY);
    } catch {
      // ignore storage errors before reload
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="h-screen w-screen flex items-center justify-center p-6 bg-[var(--bg)] text-[var(--txt-main)]">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl space-y-4">
          <div className="space-y-1">
            <h1 className="text-sm font-semibold text-[var(--txt-main)]">
              Beklenmeyen Bir Hata Oluştu
            </h1>
            <p className="text-xs text-[var(--txt-muted)]">
              Arayüz oluşturulurken bir sorunla karşılaşıldı.
            </p>
          </div>

          <pre className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs font-mono text-[var(--err)] overflow-auto max-h-40 whitespace-pre-wrap break-words select-text">
            {error.message || String(error)}
          </pre>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={this.handleResetLayoutAndReload}
              className="px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:border-[var(--accent)] transition-colors cursor-pointer"
            >
              Düzeni Sıfırla ve Yenile
            </button>
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-xs font-medium text-black hover:opacity-90 transition-opacity cursor-pointer"
            >
              Tekrar Dene
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
