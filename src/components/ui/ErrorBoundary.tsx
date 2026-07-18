import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Last-resort error boundary — the localized error page handles routed
 * errors; this catches render crashes anywhere in the tree. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[crowned] render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", background: "#0b0b0d", color: "#f6f4ef", fontFamily: "system-ui, sans-serif" }}>
          <div>
            <p style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: "#c6a355", fontWeight: 700 }}>CROWNED</p>
            <h1 style={{ margin: "12px 0" }}>Something went wrong / حدث خطأ / משהו השתבש</h1>
            <p style={{ opacity: 0.75, marginBottom: 20 }}>Please reload the page. / يرجى تحديث الصفحة. / נסו לרענן את הדף.</p>
            <button
              onClick={() => window.location.assign("/")}
              style={{ background: "#c6a355", color: "#0b0b0d", border: 0, padding: "12px 28px", fontWeight: 700, borderRadius: 4, cursor: "pointer" }}
            >
              CROWNED — Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
