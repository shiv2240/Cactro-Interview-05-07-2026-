import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import manifest from "./manifest.json";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const PLACEHOLDERS = new Set([
  "",
  "YOUR_GROQ_API_KEY_HERE",
  "REPLACE_WITH_YOUR_GROQ_API_KEY",
]);

/** Pull developer Groq key for SW-only define (never commit secrets). */
function resolveDeveloperGroqKey(mode: string): string {
  const env = loadEnv(mode, __dirname, "");
  const candidates = [
    process.env.GROQ_API_KEY,
    process.env.VITE_GROQ_API_KEY,
    env.GROQ_API_KEY,
    env.VITE_GROQ_API_KEY,
    readGroqFromConfigJs(resolve(repoRoot, "config.js")),
  ];
  for (const raw of candidates) {
    const key = typeof raw === "string" ? raw.trim() : "";
    if (key && !PLACEHOLDERS.has(key)) return key;
  }
  return "";
}

function readGroqFromConfigJs(path: string): string {
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8");
    const match = text.match(/GROQ_API_KEY\s*:\s*['"`]([^'"`]+)['"`]/);
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

export default defineConfig(({ mode }) => {
  const bundledGroqKey = resolveDeveloperGroqKey(mode);
  if (bundledGroqKey) {
    console.log(
      "[aka] Bundled Groq fallback key for SW (from env or config.js): present"
    );
  } else {
    console.warn(
      "[aka] No developer Groq key found. Set extension/.env VITE_GROQ_API_KEY, GROQ_API_KEY, or root config.js HS_CONFIG.GROQ_API_KEY for cloud AI fallback."
    );
  }

  return {
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
    define: {
      // Injected only where referenced — keep imports out of content scripts.
      __AKA_BUNDLED_GROQ_KEY__: JSON.stringify(bundledGroqKey),
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
  };
});
