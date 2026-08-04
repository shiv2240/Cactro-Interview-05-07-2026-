/**
 * SW-only runtime config. Never import this module from content scripts.
 */
import { resolveBundledGroqKey } from "./resolveBundledGroqKey";

const STORAGE_KEY = "groq_api_key";
const PLACEHOLDERS = new Set([
  "",
  "YOUR_GROQ_API_KEY_HERE",
  "REPLACE_WITH_YOUR_GROQ_API_KEY",
]);

export function getConvexHttpUrl(): string {
  return (
    import.meta.env.VITE_CONVEX_HTTP_URL ||
    "https://ardent-partridge-610.convex.site"
  );
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!key || PLACEHOLDERS.has(key)) return null;
  return key;
}

/**
 * Resolve Groq key for the service worker:
 * 1. Optional chrome.storage override (Settings power-user)
 * 2. Build-time bundled developer key (config.js / .env / GROQ_API_KEY)
 * 3. Legacy Vite env fallback (same as bundled when injected)
 */
export async function getGroqApiKey(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const fromStorage = normalizeKey(stored[STORAGE_KEY]);
    if (fromStorage) return fromStorage;
  } catch {
    /* ignore storage errors in SW */
  }

  const bundled = resolveBundledGroqKey();
  if (bundled) return bundled;

  const fromEnv = normalizeKey(import.meta.env.VITE_GROQ_API_KEY);
  if (fromEnv) return fromEnv;

  return null;
}

export async function setGroqApiKey(key: string): Promise<void> {
  const normalized = key.trim();
  if (!normalized) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}

/** Seed storage from the bundled developer key when empty (install / first wake). */
export async function seedGroqKeyFromBundle(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    if (normalizeKey(stored[STORAGE_KEY])) return false;
    const bundled = resolveBundledGroqKey();
    if (!bundled) return false;
    await chrome.storage.local.set({ [STORAGE_KEY]: bundled });
    return true;
  } catch {
    return false;
  }
}

export function hasBundledGroqKey(): boolean {
  return Boolean(resolveBundledGroqKey());
}
