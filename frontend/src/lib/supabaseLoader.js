// Load supabase-js (~220 kB) only when a page actually needs Auth, so the
// public landing page stays light for signed-out visitors.
let client, loaded = null;
export const loadSupabase = () => (client ||= import("./supabase.js").then((m) => m.supabase));

// Pages that import the client statically (the journal at /app) register it,
// so Auth state is used even when browser storage is unavailable.
export function registerClient(instance) {
  loaded = instance;
  client ||= Promise.resolve(instance);
}

// supabase-js persists the session under "sb-<project-ref>-auth-token".
export function hasStoredSession(storage) {
  try {
    for (let i = 0; i < storage.length; i++) {
      if (/^sb-.+-auth-token$/.test(storage.key(i) || "")) return true;
    }
  } catch {}
  return false;
}

// True when this page load must start the Auth client: a saved session to
// restore, or credentials/errors in the URL that Auth has to consume.
export function needsAuthClient(storage, authReturn) {
  return !!loaded || hasStoredSession(storage) || !!authReturn?.hasCredentials || !!authReturn?.error;
}
