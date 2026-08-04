import {
  listAllHighlightsForSync,
  upsertHighlightLocal,
} from "../db/highlights";
import { listAllNotesForSync, upsertNoteLocal } from "../db/notes";
import { getDB, getPrefs } from "../db/schema";
import type { Highlight, Note, OfflineQueueItem } from "../types";
import { getConvexHttpUrl } from "../ai/swConfig";

async function getSessionToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(["session_token"]);
    return typeof result.session_token === "string" ? result.session_token : null;
  } catch {
    return null;
  }
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getSessionToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function register(email: string, password: string) {
  const resp = await fetch(`${getConvexHttpUrl()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "Registration failed");
  await chrome.storage.local.set({
    session_token: data.token,
    user_email: data.email,
  });
  return { email: data.email as string };
}

export async function login(email: string, password: string) {
  const resp = await fetch(`${getConvexHttpUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "Login failed");
  await chrome.storage.local.set({
    session_token: data.token,
    user_email: data.email,
  });
  return { email: data.email as string };
}

export async function logout() {
  const token = await getSessionToken();
  if (token) {
    try {
      await fetch(`${getConvexHttpUrl()}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      /* ignore */
    }
  }
  await chrome.storage.local.remove(["session_token", "user_email"]);
}

export async function authStatus(): Promise<{
  authenticated: boolean;
  email: string | null;
}> {
  try {
    const result = await chrome.storage.local.get(["session_token", "user_email"]);
    return {
      authenticated: Boolean(result.session_token),
      email: typeof result.user_email === "string" ? result.user_email : null,
    };
  } catch {
    return { authenticated: false, email: null };
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
) {
  const token = await getSessionToken();
  if (!token) throw new Error("Not authenticated");
  const resp = await fetch(`${getConvexHttpUrl()}/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, currentPassword, newPassword }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error ?? "Failed to change password");
  return data;
}

async function pushHighlight(h: Highlight): Promise<void> {
  const resp = await fetch(`${getConvexHttpUrl()}/highlights`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      id: h.id,
      text: h.text,
      url: h.url,
      title: h.title,
      timestamp: h.timestamp,
    }),
  });
  if (resp.status === 401) throw new Error("Unauthorized");
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Highlight sync failed");
  }
}

async function deleteRemoteHighlight(id: string): Promise<void> {
  const resp = await fetch(`${getConvexHttpUrl()}/highlights/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (resp.status === 401) throw new Error("Unauthorized");
  if (!resp.ok && resp.status !== 404) {
    throw new Error("Highlight delete sync failed");
  }
}

async function pushNote(n: Note): Promise<void> {
  const resp = await fetch(`${getConvexHttpUrl()}/notes`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      id: n.id,
      title: n.title,
      body: n.body,
      tags: n.tags,
      pinned: n.pinned,
      favorite: n.favorite,
      workspaceId: n.workspaceId,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      deleted: n.deleted ?? false,
    }),
  });
  if (resp.status === 404) return; // endpoint may not exist yet during migrate
  if (resp.status === 401) throw new Error("Unauthorized");
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Note sync failed");
  }
}

async function deleteRemoteNote(id: string): Promise<void> {
  const resp = await fetch(`${getConvexHttpUrl()}/notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (resp.status === 404) return;
  if (resp.status === 401) throw new Error("Unauthorized");
  if (!resp.ok) throw new Error("Note delete sync failed");
}

async function pullHighlights(): Promise<void> {
  const resp = await fetch(`${getConvexHttpUrl()}/highlights`, {
    headers: await authHeaders(),
  });
  if (resp.status === 401) throw new Error("Unauthorized");
  if (!resp.ok) return;
  const remote = (await resp.json()) as Array<{
    id: string;
    text: string;
    url: string;
    title: string;
    timestamp: number;
  }>;
  const prefs = await getPrefs();
  for (const r of remote) {
    await upsertHighlightLocal({
      id: r.id,
      text: r.text,
      url: r.url,
      title: r.title,
      timestamp: r.timestamp,
      updatedAt: r.timestamp,
      workspaceId: prefs.workspaceId,
      syncedAt: Date.now(),
    });
  }
}

async function pullNotes(): Promise<void> {
  const resp = await fetch(`${getConvexHttpUrl()}/notes`, {
    headers: await authHeaders(),
  });
  if (resp.status === 404 || !resp.ok) return;
  const remote = (await resp.json()) as Note[];
  for (const n of remote) {
    await upsertNoteLocal({ ...n, syncedAt: Date.now() });
  }
}

async function processQueueItem(item: OfflineQueueItem): Promise<void> {
  switch (item.op) {
    case "upsert_highlight":
      await pushHighlight(item.payload as Highlight);
      break;
    case "delete_highlight":
      await deleteRemoteHighlight((item.payload as { id: string }).id);
      break;
    case "upsert_note":
      await pushNote(item.payload as Note);
      break;
    case "delete_note":
      await deleteRemoteNote((item.payload as { id: string }).id);
      break;
    default:
      break;
  }
}

export async function syncNow(): Promise<{
  pushed: number;
  pulled: boolean;
  errors: string[];
}> {
  const prefs = await getPrefs();
  if (prefs.privacyMode === "private") {
    return { pushed: 0, pulled: false, errors: ["Private mode — sync disabled"] };
  }

  const status = await authStatus();
  if (!status.authenticated) {
    return { pushed: 0, pulled: false, errors: ["Not signed in"] };
  }

  const errors: string[] = [];
  const db = await getDB();
  const queue = await db.getAllFromIndex("offlineQueue", "by-created");
  let pushed = 0;

  for (const item of queue) {
    try {
      await processQueueItem(item);
      await db.delete("offlineQueue", item.id);
      pushed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      await db.put("offlineQueue", {
        ...item,
        attempts: item.attempts + 1,
        lastError: msg,
      });
    }
  }

  // Also push any local highlights not yet synced (migration / first sync)
  try {
    const locals = await listAllHighlightsForSync();
    for (const h of locals) {
      if (h.deleted || h.syncedAt) continue;
      try {
        await pushHighlight(h);
        await upsertHighlightLocal({ ...h, syncedAt: Date.now() });
        pushed++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    const notes = await listAllNotesForSync();
    for (const n of notes) {
      if (n.deleted || n.syncedAt) continue;
      try {
        await pushNote(n);
        await upsertNoteLocal({ ...n, syncedAt: Date.now() });
        pushed++;
      } catch {
        /* notes endpoint optional during rollout */
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  let pulled = false;
  try {
    await pullHighlights();
    await pullNotes();
    pulled = true;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }

  return { pushed, pulled, errors };
}
