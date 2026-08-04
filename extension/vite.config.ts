import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import manifest from "./manifest.json";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Relative base so side panel HTML can load assets under chrome-extension://
  // (absolute `/assets/...` breaks the dashboard in the side panel).
  base: "./",
  root: __dirname,
  envDir: __dirname,
  plugins: [react(), crx({ manifest: manifest as never })],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
