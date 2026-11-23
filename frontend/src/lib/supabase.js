import "./authReturn";
import { createClient } from "@supabase/supabase-js";

import { config } from "./config";
import { registerClient } from "./supabaseLoader";

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
registerClient(supabase);
