import { getDB } from "./schema";
import type { AICacheEntry, AIProviderId } from "../types";

const MAX_CACHE = 80;
/** Short TTL for summarize hot-path — identical requests hit in <50ms. */
const DEFAULT_TTL_MS = 1000 * 60 * 10; // 10 min
const MEMORY_MAX = 40;
/** Bump to invalidate junk keyword/selection summaries cached with page chrome. */
const CACHE_VERSION = "v2-nochrome";

type MemEntry = AICacheEntry;

const memory = new Map<string, MemEntry>();

function hashKey(parts: string[]): string {
  const raw = [CACHE_VERSION, ...parts].join("::");
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return `c_${Math.abs(h)}`;
}

function touchMemory(id: string, entry: MemEntry): void {
  memory.delete(id);
  memory.set(id, entry);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export async function getCachedAI(
  action: string,
  text: string
): Promise<AICacheEntry | null> {
  const id = hashKey([action, text.slice(0, 2000)]);
  const now = Date.now();

  const mem = memory.get(id);
  if (mem) {
    if (mem.expiresAt < now) {
      memory.delete(id);
    } else {
      touchMemory(id, mem);
      return mem;
    }
  }

  const db = await getDB();
  const entry = await db.get("aiCache", id);
  if (!entry) return null;
  if (entry.expiresAt < now) {
    await db.delete("aiCache", id);
    return null;
  }
  touchMemory(id, entry);
  return entry;
}

export async function setCachedAI(
  action: string,
  text: string,
  value: string,
  provider: AIProviderId
): Promise<void> {
  const id = hashKey([action, text.slice(0, 2000)]);
  const now = Date.now();
  const entry: AICacheEntry = {
    id,
    key: id,
    value,
    provider,
    createdAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  };
  touchMemory(id, entry);

  // Persist async — don't block the response path on IDB write.
  void (async () => {
    try {
      const db = await getDB();
      await db.put("aiCache", entry);
      const all = await db.getAll("aiCache");
      if (all.length > MAX_CACHE) {
        all
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(0, all.length - MAX_CACHE)
          .forEach((e) => void db.delete("aiCache", e.id));
      }
    } catch {
      /* cache write best-effort */
    }
  })();
}
