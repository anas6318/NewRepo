import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Standard Vite configuration — used on any machine with npm registry
 * access (`npm install && npm run dev`).
 *
 * NOTE: the repository also contains `scripts/sandbox-build.mjs`, an
 * esbuild-based fallback pipeline that produces an identical dist/ from the
 * same source. It exists because this project was built and verified inside
 * a network-restricted environment where npm packages could not be
 * installed. On a normal machine, prefer Vite; both pipelines consume the
 * same `src/` and `index.html`.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020",
  },
  server: {
    port: 5173,
  },
});
