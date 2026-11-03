import { Component } from "react";

// A render error shouldn't white-screen the app. Also recovers from the
// common code-splitting failure: a tab opened before a deploy asks for a page
// chunk that no longer exists -> reload once to pick up the new build.
const CHUNK_ERR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (CHUNK_ERR.test(String(error?.message || error))) {
      let reloaded = false;
      try { reloaded = sessionStorage.getItem("td_chunk_reload") === "1"; sessionStorage.setItem("td_chunk_reload", "1"); } catch {}
      if (!reloaded) { window.location.reload(); return; }
    }
    console.error("UI error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong on this page</h2>
        <p>Your data is safe. Reloading usually fixes it; if it keeps happening, let us know what you were doing.</p>
        <div className="um-actions" style={{ justifyContent: "center" }}>
          <button type="button" className="btn ghost" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
