import { getDB } from "./schema";
import type { AICacheEntry, AIProviderId } from "../types";

const MAX_CACHE = 80;
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6; // 6h

function hashKey(parts: string[]): string {
  const raw = parts.join("::");
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return `c_${Math.abs(h)}`;
}

export async function getCachedAI(
  action: string,
  text: string
): Promise<AICacheEntry | null> {
  const db = await getDB();
  const id = hashKey([action, text.slice(0, 2000)]);
  const entry = await db.get("aiCache", id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    await db.delete("aiCache", id);
    return null;
  }
  return entry;
}

export async function setCachedAI(
  action: string,
  text: string,
  value: string,
  provider: AIProviderId
): Promise<void> {
  const db = await getDB();
  const id = hashKey([action, text.slice(0, 2000)]);
  const now = Date.now();
  await db.put("aiCache", {
    id,
    key: id,
    value,
    provider,
    createdAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  });

  // LRU-ish: trim oldest when over cap
  const all = await db.getAll("aiCache");
  if (all.length > MAX_CACHE) {
    all
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, all.length - MAX_CACHE)
      .forEach((e) => void db.delete("aiCache", e.id));
  }
}
