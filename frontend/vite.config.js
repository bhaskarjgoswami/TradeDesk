import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

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
