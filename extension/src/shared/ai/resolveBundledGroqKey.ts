/**
 * Build-time Groq key accessor — service worker / AI providers only.
 * Vite replaces `__AKA_BUNDLED_GROQ_KEY__` at build time from
 * `extension/.env` / `GROQ_API_KEY` / root `config.js` (see vite.config.ts).
 * Never import this module from content scripts.
 */

declare const __AKA_BUNDLED_GROQ_KEY__: string | undefined;

const PLACEHOLDERS = new Set([
  "",
  "YOUR_GROQ_API_KEY_HERE",
  "REPLACE_WITH_YOUR_GROQ_API_KEY",
]);

export function resolveBundledGroqKey(): string | null {
  try {
    const raw =
      typeof __AKA_BUNDLED_GROQ_KEY__ === "string" ? __AKA_BUNDLED_GROQ_KEY__ : "";
    const key = raw.trim();
    if (!key || PLACEHOLDERS.has(key)) return null;
    return key;
  } catch {
    return null;
  }
}
