import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { buffer: createRequire(import.meta.url).resolve("buffer/") },
  },
  worker: { format: "es" },
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
