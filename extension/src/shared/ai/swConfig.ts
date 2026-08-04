/**
 * SW-only runtime config. Never import this module from content scripts.
 */
export function getConvexHttpUrl(): string {
  return (
    import.meta.env.VITE_CONVEX_HTTP_URL ||
    "https://ardent-partridge-610.convex.site"
  );
}

export async function getGroqApiKey(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get(["groq_api_key"]);
    if (typeof stored.groq_api_key === "string" && stored.groq_api_key.trim()) {
      return stored.groq_api_key.trim();
    }
  } catch {
    /* ignore */
  }
  const fromEnv = import.meta.env.VITE_GROQ_API_KEY;
  if (typeof fromEnv === "string" && fromEnv.trim() && fromEnv !== "YOUR_GROQ_API_KEY_HERE") {
    return fromEnv.trim();
  }
  return null;
}

export async function setGroqApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ groq_api_key: key });
}
