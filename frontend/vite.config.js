import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Fail closed: a preview must have its own backend and Supabase project.
if (process.env.VERCEL_ENV === "preview") {
  const api = process.env.VITE_API_URL || "";
  const auth = process.env.VITE_SUPABASE_URL || "";
  if (!api || !auth || !process.env.VITE_SUPABASE_ANON_KEY || api.includes("tradedesk-nopw.onrender.com") || auth.includes("nltngvrqawdwltauqkiw.supabase.co")) {
    throw new Error("Preview requires isolated staging API and Supabase configuration; production fallback is disabled.");
  }
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // index.html: React (landing, legal, billing); app/index.html: the journal UI
      input: { main: resolve(__dirname, "index.html"), app: resolve(__dirname, "app/index.html") },
    },
  },
});
