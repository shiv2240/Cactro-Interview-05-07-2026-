import { getDB, getPrefs } from "./schema";
import type { Note, OfflineQueueItem, WorkspaceId } from "../types";

function newId(): string {
  return crypto.randomUUID();
}

export async function upsertNote(input: {
  id?: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  workspaceId?: WorkspaceId;
}): Promise<Note> {
  const db = await getDB();
  const prefs = await getPrefs();
  const now = Date.now();
  const existing = input.id ? await db.get("notes", input.id) : undefined;
  const note: Note = {
    id: input.id ?? newId(),
    title: input.title.trim() || "Untitled note",
    body: input.body,
    tags: input.tags,
    pinned: input.pinned,
    favorite: input.favorite,
    workspaceId: input.workspaceId ?? existing?.workspaceId ?? prefs.workspaceId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deleted: false,
  };
  await db.put("notes", note);

  if (prefs.privacyMode !== "private") {
    await enqueue({
      id: newId(),
      op: "upsert_note",
      payload: note,
      createdAt: now,
      attempts: 0,
    });
  }
  return note;
}

export async function listNotes(workspaceId?: WorkspaceId): Promise<Note[]> {
  const db = await getDB();
  const prefs = await getPrefs();
  const ws = workspaceId ?? prefs.workspaceId;
  const all = await db.getAllFromIndex("notes", "by-workspace", ws);
  return all
    .filter((n) => !n.deleted)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}

export async function searchNotes(
  query: string,
  workspaceId?: WorkspaceId
): Promise<Note[]> {
  const q = query.trim().toLowerCase();
  const items = await listNotes(workspaceId);
  if (!q) return items;
  return items.filter(
    (n) =>
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export async function deleteNote(id: string): Promise<boolean> {
  const db = await getDB();
  const existing = await db.get("notes", id);
  if (!existing) return false;
  const prefs = await getPrefs();
  const now = Date.now();
  await db.put("notes", { ...existing, deleted: true, updatedAt: now });

  if (prefs.privacyMode !== "private") {
    await enqueue({
      id: newId(),
      op: "delete_note",
      payload: { id },
      createdAt: now,
      attempts: 0,
    });
  }
  return true;
}

export async function upsertNoteLocal(n: Note): Promise<void> {
  const db = await getDB();
  const existing = await db.get("notes", n.id);
  if (existing && existing.updatedAt > n.updatedAt) return;
  await db.put("notes", n);
}

export async function listAllNotesForSync(): Promise<Note[]> {
  const db = await getDB();
  return db.getAll("notes");
}

async function enqueue(item: OfflineQueueItem): Promise<void> {
  const db = await getDB();
  await db.put("offlineQueue", item);
}
