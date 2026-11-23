// Report uncaught errors from the React shell to the TradeDesk API.
// Deduplicated, capped per page load, and sent without credentials.
const MAX_REPORTS = 5;
const clip = (value, max) => (value == null ? "" : String(value)).slice(0, max);

export function createErrorReporter({ endpoint, send, max = MAX_REPORTS, location, userAgent }) {
  const seen = new Set();
  let sent = 0;
  return function report(info) {
    if (sent >= max || !endpoint) return false;
    const payload = {
      message: clip(info.message || "Unknown error", 500),
      source: clip(info.source, 300),
      line: Number.isFinite(info.line) ? info.line : null,
      col: Number.isFinite(info.col) ? info.col : null,
      stack: clip(info.stack, 4000),
      // Query strings and fragments can carry auth tokens; keep only the path.
      url: clip(location ? location.origin + location.pathname : "", 300),
      ua: clip(userAgent, 300),
    };
    const key = `${payload.message}|${payload.source}|${payload.line}|${payload.col}`;
    if (seen.has(key)) return false;
    seen.add(key);
    sent++;
    try { send(endpoint, JSON.stringify(payload)); } catch {}
    return true;
  };
}

function beaconSend(endpoint, body) {
  const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
  if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) return;
  fetch(endpoint, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(() => {});
}

export function installErrorReporter(apiBase) {
  if (typeof window === "undefined" || !apiBase) return;
  const report = createErrorReporter({ endpoint: `${apiBase}/client-errors`, send: beaconSend, location: window.location, userAgent: navigator.userAgent });
  window.addEventListener("error", (event) => {
    // Resource load failures (img/script) have no message; skip them.
    if (!event.message && !event.error) return;
    report({ message: event.message || event.error?.message, source: event.filename, line: event.lineno, col: event.colno, stack: event.error?.stack });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report({ message: "Unhandled rejection: " + (reason?.message || clip(reason, 300)), stack: reason?.stack });
  });
}
