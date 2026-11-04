// Public auth configuration must belong to this deployment environment.
// Missing preview/development settings must never fall back to production.
const real = (v) => typeof v === "string" && v.trim() !== "" && !/xxxx|your-|example/i.test(v);
const env = import.meta.env;

export const config = {
  supabaseUrl: real(env.VITE_SUPABASE_URL) ? env.VITE_SUPABASE_URL : "",
  supabaseAnonKey: real(env.VITE_SUPABASE_ANON_KEY) ? env.VITE_SUPABASE_ANON_KEY : "",
  apiUrl: real(env.VITE_API_URL) ? env.VITE_API_URL : env.DEV ? "http://localhost:8787" : "",
};
if (!config.supabaseUrl || !config.supabaseAnonKey || !config.apiUrl) {
  throw new Error("TradeDesk environment is incomplete. Configure VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_API_URL for this environment.");
}
