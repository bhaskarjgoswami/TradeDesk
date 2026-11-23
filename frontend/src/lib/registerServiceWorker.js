// One registration path for both shells (landing/React and the journal at /app).
// register() is idempotent per scope, so a visitor moving between shells keeps one worker.
export function registerServiceWorker(nav = globalThis.navigator, doc = globalThis.document, win = globalThis.window) {
  if (!nav || !("serviceWorker" in nav)) return false;
  const register = () => nav.serviceWorker.register("/sw.js").catch(() => {});
  if (doc.readyState === "complete") register(); else win.addEventListener("load", register, { once: true });
  return true;
}
