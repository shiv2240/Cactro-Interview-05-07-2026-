import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AICacheEntry,
  AITimelineEvent,
  Highlight,
  Note,
  OfflineQueueItem,
  PersonalizationProfile,
  UserPrefs,
  VectorRecord,
} from "../types";
import { DEFAULT_PREFS } from "../types";

interface KnowledgeDB extends DBSchema {
  highlights: {
    key: string;
    value: Highlight;
    indexes: {
      "by-workspace": string;
      "by-timestamp": number;
      "by-updated": number;
    };
  };
  notes: {
    key: string;
    value: Note;
    indexes: {
      "by-workspace": string;
      "by-updated": number;
    };
  };
  prefs: {
    key: string;
    value: UserPrefs & { id: string };
  };
  offlineQueue: {
    key: string;
    value: OfflineQueueItem;
    indexes: { "by-created": number };
  };
  aiCache: {
    key: string;
    value: AICacheEntry;
    indexes: { "by-expires": number };
  };
  timeline: {
    key: string;
    value: AITimelineEvent;
    indexes: { "by-created": number };
  };
  personalization: {
    key: string;
    value: PersonalizationProfile & { id: string };
  };
  vectors: {
    key: string;
    value: VectorRecord;
    indexes: {
      "by-workspace": string;
      "by-source": string;
    };
  };
}

const DB_NAME = "ai-knowledge-assistant";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<KnowledgeDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<KnowledgeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KnowledgeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const highlights = db.createObjectStore("highlights", { keyPath: "id" });
        highlights.createIndex("by-workspace", "workspaceId");
        highlights.createIndex("by-timestamp", "timestamp");
        highlights.createIndex("by-updated", "updatedAt");

        const notes = db.createObjectStore("notes", { keyPath: "id" });
        notes.createIndex("by-workspace", "workspaceId");
        notes.createIndex("by-updated", "updatedAt");

        db.createObjectStore("prefs", { keyPath: "id" });

        const queue = db.createObjectStore("offlineQueue", { keyPath: "id" });
        queue.createIndex("by-created", "createdAt");

        const cache = db.createObjectStore("aiCache", { keyPath: "id" });
        cache.createIndex("by-expires", "expiresAt");

        const timeline = db.createObjectStore("timeline", { keyPath: "id" });
        timeline.createIndex("by-created", "createdAt");

        db.createObjectStore("personalization", { keyPath: "id" });

        const vectors = db.createObjectStore("vectors", { keyPath: "id" });
        vectors.createIndex("by-workspace", "workspaceId");
        vectors.createIndex("by-source", "sourceId");
      },
    });
  }
  return dbPromise;
}

export async function getPrefs(): Promise<UserPrefs> {
  const db = await getDB();
  const row = await db.get("prefs", "default");
  if (!row) return { ...DEFAULT_PREFS, featurePrefs: { ...DEFAULT_PREFS.featurePrefs } };
  const { id: _id, ...prefs } = row;
  return {
    ...DEFAULT_PREFS,
    ...prefs,
    featurePrefs: { ...DEFAULT_PREFS.featurePrefs, ...prefs.featurePrefs },
  };
}

export async function setPrefs(partial: Partial<UserPrefs>): Promise<UserPrefs> {
  const db = await getDB();
  const current = await getPrefs();
  const next: UserPrefs = {
    ...current,
    ...partial,
    featurePrefs: {
      ...current.featurePrefs,
      ...(partial.featurePrefs ?? {}),
    },
  };
  await db.put("prefs", { id: "default", ...next });
  return next;
}

export { DEFAULT_PREFS };
