import { getDB, getPrefs } from "./schema";
import type { Highlight, OfflineQueueItem, WorkspaceId } from "../types";

function newId(): string {
  return crypto.randomUUID();
}

export async function saveHighlight(input: {
  text: string;
  url: string;
  title: string;
  workspaceId?: WorkspaceId;
}): Promise<Highlight> {
  const db = await getDB();
  const prefs = await getPrefs();
  const now = Date.now();
  const highlight: Highlight = {
    id: newId(),
    text: input.text.trim(),
    url: input.url,
    title: input.title || "Untitled",
    timestamp: now,
    updatedAt: now,
    workspaceId: input.workspaceId ?? prefs.workspaceId,
  };
  await db.put("highlights", highlight);

  if (prefs.privacyMode !== "private") {
    await enqueue({
      id: newId(),
      op: "upsert_highlight",
      payload: highlight,
      createdAt: now,
      attempts: 0,
    });
  }
  return highlight;
}

export async function listHighlights(
  workspaceId?: WorkspaceId
): Promise<Highlight[]> {
  const db = await getDB();
  const prefs = await getPrefs();
  const ws = workspaceId ?? prefs.workspaceId;
  const all = await db.getAllFromIndex("highlights", "by-workspace", ws);
  return all
    .filter((h) => !h.deleted)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function searchHighlights(
  query: string,
  workspaceId?: WorkspaceId
): Promise<Highlight[]> {
  const q = query.trim().toLowerCase();
  const items = await listHighlights(workspaceId);
  if (!q) return items;
  return items.filter(
    (h) =>
      h.text.toLowerCase().includes(q) ||
      h.title.toLowerCase().includes(q) ||
      h.url.toLowerCase().includes(q)
  );
}

export async function deleteHighlight(id: string): Promise<boolean> {
  const db = await getDB();
  const existing = await db.get("highlights", id);
  if (!existing) return false;
  const prefs = await getPrefs();
  const now = Date.now();
  const tombstone: Highlight = {
    ...existing,
    deleted: true,
    updatedAt: now,
  };
  await db.put("highlights", tombstone);

  if (prefs.privacyMode !== "private") {
    await enqueue({
      id: newId(),
      op: "delete_highlight",
      payload: { id },
      createdAt: now,
      attempts: 0,
    });
  }
  return true;
}

export async function upsertHighlightLocal(h: Highlight): Promise<void> {
  const db = await getDB();
  const existing = await db.get("highlights", h.id);
  if (existing && existing.updatedAt > h.updatedAt) return;
  await db.put("highlights", h);
}

export async function listAllHighlightsForSync(): Promise<Highlight[]> {
  const db = await getDB();
  return db.getAll("highlights");
}

async function enqueue(item: OfflineQueueItem): Promise<void> {
  const db = await getDB();
  await db.put("offlineQueue", item);
}
