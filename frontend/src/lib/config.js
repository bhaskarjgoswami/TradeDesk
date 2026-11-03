// Public client config. These values ship to every browser by design: the
// anon key only allows Supabase Auth (all tables are backend-only), so it is
// safe to commit. Env vars override them, except unfilled placeholders, so a
// stale "xxxx" value in the hosting dashboard can't silently break login.
const PUBLIC = {
  supabaseUrl: "https://nltngvrqawdwltauqkiw.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sdG5ndnJxYXdkd2x0YXVxa2l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDYzNTEsImV4cCI6MjA5NzcyMjM1MX0.VEOrEmaqQ7RXHVG9d8sHUDAbEG0EeNLVc1yBKOXeo50",
  apiUrl: "https://tradedesk-nopw.onrender.com",
};

const real = (v) => typeof v === "string" && v.trim() !== "" && !/xxxx|your-|example/i.test(v);
const env = import.meta.env;

export const config = {
  supabaseUrl: real(env.VITE_SUPABASE_URL) ? env.VITE_SUPABASE_URL : PUBLIC.supabaseUrl,
  supabaseAnonKey: real(env.VITE_SUPABASE_ANON_KEY) ? env.VITE_SUPABASE_ANON_KEY : PUBLIC.supabaseAnonKey,
  apiUrl: real(env.VITE_API_URL) ? env.VITE_API_URL : env.DEV ? "http://localhost:8787" : PUBLIC.apiUrl,
};
