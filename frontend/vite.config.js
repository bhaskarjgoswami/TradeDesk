import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Fail closed: a preview must have its own backend and Supabase project.
if (process.env.VERCEL_ENV === "preview") {
  const api = process.env.VITE_API_URL || "";
  const auth = process.env.VITE_SUPABASE_URL || "";
  if (!api || !auth || !process.env.VITE_SUPABASE_ANON_KEY || api.includes("tradedesk-nopw.onrender.com") || api.includes("tradedesk-api-sg.onrender.com") || auth.includes("nltngvrqawdwltauqkiw.supabase.co")) {
    throw new Error("Preview requires isolated staging API and Supabase configuration; production fallback is disabled.");
  }
}

// Dev only: mirror vercel.json's "/app" -> "/app/index.html" rewrite. Without it the
// dev server serves the React site at /app, which bounces between /app and /login.
const journalAppRewrite = {
  name: "journal-app-rewrite",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = req.url.split("?");
      if (path === "/app") req.url = "/app/index.html" + (query ? "?" + query : "");
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), journalAppRewrite],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // index.html: React (landing, legal, billing); app/index.html: the journal UI
      input: { main: resolve(__dirname, "index.html"), app: resolve(__dirname, "app/index.html") },
    },
  },
});
