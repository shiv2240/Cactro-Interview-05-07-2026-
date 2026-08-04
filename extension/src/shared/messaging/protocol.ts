import { z } from "zod";
import type {
  AIAction,
  AIResponseEnvelope,
  FeaturePrefs,
  Highlight,
  Note,
  PrivacyMode,
  ThemePreference,
  UserPrefs,
  WorkspaceId,
} from "../types";

/** Typed message protocol between content / sidepanel ↔ service worker */

export const MessageType = {
  PING: "PING",
  SAVE_HIGHLIGHT: "SAVE_HIGHLIGHT",
  LIST_HIGHLIGHTS: "LIST_HIGHLIGHTS",
  DELETE_HIGHLIGHT: "DELETE_HIGHLIGHT",
  SEARCH_HIGHLIGHTS: "SEARCH_HIGHLIGHTS",
  PREFS_GET: "PREFS_GET",
  PREFS_SET: "PREFS_SET",
  AI_GENERATE: "AI_GENERATE",
  AI_STREAM: "AI_STREAM",
  AI_STREAM_CHUNK: "AI_STREAM_CHUNK",
  AI_STREAM_DONE: "AI_STREAM_DONE",
  AUTH_LOGIN: "AUTH_LOGIN",
  AUTH_REGISTER: "AUTH_REGISTER",
  AUTH_LOGOUT: "AUTH_LOGOUT",
  AUTH_STATUS: "AUTH_STATUS",
  AUTH_CHANGE_PASSWORD: "AUTH_CHANGE_PASSWORD",
  SYNC_NOW: "SYNC_NOW",
  NOTE_UPSERT: "NOTE_UPSERT",
  NOTE_LIST: "NOTE_LIST",
  NOTE_DELETE: "NOTE_DELETE",
  NOTE_SEARCH: "NOTE_SEARCH",
  TIMELINE_LIST: "TIMELINE_LIST",
  VECTOR_SEARCH: "VECTOR_SEARCH",
  PERSONALIZATION_GET: "PERSONALIZATION_GET",
  PERSONALIZATION_FEEDBACK: "PERSONALIZATION_FEEDBACK",
  SET_WORKSPACE: "SET_WORKSPACE",
  OPEN_SIDE_PANEL: "OPEN_SIDE_PANEL",
  /** Broadcast-only: IDB highlights mutated (save/delete/sync pull) */
  HIGHLIGHTS_CHANGED: "HIGHLIGHTS_CHANGED",
  /** Broadcast-only: IDB notes mutated (upsert/delete/sync pull) */
  NOTES_CHANGED: "NOTES_CHANGED",
} as const;

/** Events pushed from the SW to open extension pages (side panel). Not request/response. */
export type DataChangedEvent =
  | { type: typeof MessageType.HIGHLIGHTS_CHANGED }
  | { type: typeof MessageType.NOTES_CHANGED };

export function broadcastHighlightsChanged(): void {
  try {
    void chrome.runtime
      .sendMessage({ type: MessageType.HIGHLIGHTS_CHANGED } satisfies DataChangedEvent)
      .catch(() => undefined);
  } catch {
    /* no listeners / SW wake edge */
  }
}

export function broadcastNotesChanged(): void {
  try {
    void chrome.runtime
      .sendMessage({ type: MessageType.NOTES_CHANGED } satisfies DataChangedEvent)
      .catch(() => undefined);
  } catch {
    /* no listeners / SW wake edge */
  }
}

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType];

const workspaceSchema = z.enum([
  "work",
  "personal",
  "coding",
  "research",
  "study",
]);

const aiActionSchema = z.enum([
  "summarize",
  "explain",
  "rewrite",
  "flashcards",
  "page_summary",
  "highlights_summary",
]);

const featurePrefsSchema = z.object({
  keywordsTile: z.boolean(),
  stickyNotes: z.boolean(),
  saveHighlight: z.boolean(),
  aiSummary: z.boolean(),
  summarizePage: z.boolean(),
});

export const messageSchemas = {
  [MessageType.PING]: z.object({ type: z.literal(MessageType.PING) }),
  [MessageType.SAVE_HIGHLIGHT]: z.object({
    type: z.literal(MessageType.SAVE_HIGHLIGHT),
    text: z.string().min(1).max(50_000),
    url: z.string().min(1).max(4_000),
    title: z.string().max(1_000),
    workspaceId: workspaceSchema.optional(),
  }),
  [MessageType.LIST_HIGHLIGHTS]: z.object({
    type: z.literal(MessageType.LIST_HIGHLIGHTS),
    workspaceId: workspaceSchema.optional(),
  }),
  [MessageType.DELETE_HIGHLIGHT]: z.object({
    type: z.literal(MessageType.DELETE_HIGHLIGHT),
    id: z.string().min(1),
  }),
  [MessageType.SEARCH_HIGHLIGHTS]: z.object({
    type: z.literal(MessageType.SEARCH_HIGHLIGHTS),
    query: z.string().max(500),
    workspaceId: workspaceSchema.optional(),
  }),
  [MessageType.PREFS_GET]: z.object({ type: z.literal(MessageType.PREFS_GET) }),
  [MessageType.PREFS_SET]: z.object({
    type: z.literal(MessageType.PREFS_SET),
    prefs: z
      .object({
        theme: z.enum(["light", "dark", "system"]).optional(),
        privacyMode: z.enum(["private", "sync", "cloud_ai"]).optional(),
        workspaceId: workspaceSchema.optional(),
        featurePrefs: featurePrefsSchema.partial().optional(),
        summaryStyle: z.enum(["concise", "detailed", "bullets"]).optional(),
        tone: z.enum(["neutral", "friendly", "professional"]).optional(),
        groqApiKey: z.string().max(200).optional(),
      })
      .strict(),
  }),
  [MessageType.AI_GENERATE]: z.object({
    type: z.literal(MessageType.AI_GENERATE),
    action: aiActionSchema,
    text: z.string().min(1).max(100_000),
    pageTitle: z.string().max(1_000).optional(),
    url: z.string().max(4_000).optional(),
  }),
  [MessageType.AI_STREAM]: z.object({
    type: z.literal(MessageType.AI_STREAM),
    requestId: z.string().min(1),
    action: aiActionSchema,
    text: z.string().min(1).max(100_000),
    pageTitle: z.string().max(1_000).optional(),
    url: z.string().max(4_000).optional(),
  }),
  [MessageType.AUTH_LOGIN]: z.object({
    type: z.literal(MessageType.AUTH_LOGIN),
    email: z.string().email().max(320),
    password: z.string().min(6).max(200),
  }),
  [MessageType.AUTH_REGISTER]: z.object({
    type: z.literal(MessageType.AUTH_REGISTER),
    email: z.string().email().max(320),
    password: z.string().min(6).max(200),
  }),
  [MessageType.AUTH_LOGOUT]: z.object({ type: z.literal(MessageType.AUTH_LOGOUT) }),
  [MessageType.AUTH_STATUS]: z.object({ type: z.literal(MessageType.AUTH_STATUS) }),
  [MessageType.AUTH_CHANGE_PASSWORD]: z.object({
    type: z.literal(MessageType.AUTH_CHANGE_PASSWORD),
    currentPassword: z.string().min(6).max(200),
    newPassword: z.string().min(6).max(200),
  }),
  [MessageType.SYNC_NOW]: z.object({ type: z.literal(MessageType.SYNC_NOW) }),
  [MessageType.NOTE_UPSERT]: z.object({
    type: z.literal(MessageType.NOTE_UPSERT),
    note: z.object({
      id: z.string().optional(),
      title: z.string().max(500),
      body: z.string().max(200_000),
      tags: z.array(z.string().max(64)).max(50),
      pinned: z.boolean(),
      favorite: z.boolean(),
      workspaceId: workspaceSchema.optional(),
    }),
  }),
  [MessageType.NOTE_LIST]: z.object({
    type: z.literal(MessageType.NOTE_LIST),
    workspaceId: workspaceSchema.optional(),
  }),
  [MessageType.NOTE_DELETE]: z.object({
    type: z.literal(MessageType.NOTE_DELETE),
    id: z.string().min(1),
  }),
  [MessageType.NOTE_SEARCH]: z.object({
    type: z.literal(MessageType.NOTE_SEARCH),
    query: z.string().max(500),
    workspaceId: workspaceSchema.optional(),
  }),
  [MessageType.TIMELINE_LIST]: z.object({
    type: z.literal(MessageType.TIMELINE_LIST),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  [MessageType.VECTOR_SEARCH]: z.object({
    type: z.literal(MessageType.VECTOR_SEARCH),
    query: z.string().min(1).max(2_000),
    workspaceId: workspaceSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  [MessageType.PERSONALIZATION_GET]: z.object({
    type: z.literal(MessageType.PERSONALIZATION_GET),
  }),
  [MessageType.PERSONALIZATION_FEEDBACK]: z.object({
    type: z.literal(MessageType.PERSONALIZATION_FEEDBACK),
    accepted: z.boolean(),
    action: aiActionSchema,
    textPreview: z.string().max(500).optional(),
  }),
  [MessageType.SET_WORKSPACE]: z.object({
    type: z.literal(MessageType.SET_WORKSPACE),
    workspaceId: workspaceSchema,
  }),
  [MessageType.OPEN_SIDE_PANEL]: z.object({
    type: z.literal(MessageType.OPEN_SIDE_PANEL),
  }),
} as const;

export type ExtensionRequest =
  | { type: "PING" }
  | {
      type: "SAVE_HIGHLIGHT";
      text: string;
      url: string;
      title: string;
      workspaceId?: WorkspaceId;
    }
  | { type: "LIST_HIGHLIGHTS"; workspaceId?: WorkspaceId }
  | { type: "DELETE_HIGHLIGHT"; id: string }
  | { type: "SEARCH_HIGHLIGHTS"; query: string; workspaceId?: WorkspaceId }
  | { type: "PREFS_GET" }
  | { type: "PREFS_SET"; prefs: Partial<UserPrefs> & { featurePrefs?: Partial<FeaturePrefs> } }
  | {
      type: "AI_GENERATE";
      action: AIAction;
      text: string;
      pageTitle?: string;
      url?: string;
    }
  | {
      type: "AI_STREAM";
      requestId: string;
      action: AIAction;
      text: string;
      pageTitle?: string;
      url?: string;
    }
  | { type: "AUTH_LOGIN"; email: string; password: string }
  | { type: "AUTH_REGISTER"; email: string; password: string }
  | { type: "AUTH_LOGOUT" }
  | { type: "AUTH_STATUS" }
  | {
      type: "AUTH_CHANGE_PASSWORD";
      currentPassword: string;
      newPassword: string;
    }
  | { type: "SYNC_NOW" }
  | {
      type: "NOTE_UPSERT";
      note: {
        id?: string;
        title: string;
        body: string;
        tags: string[];
        pinned: boolean;
        favorite: boolean;
        workspaceId?: WorkspaceId;
      };
    }
  | { type: "NOTE_LIST"; workspaceId?: WorkspaceId }
  | { type: "NOTE_DELETE"; id: string }
  | { type: "NOTE_SEARCH"; query: string; workspaceId?: WorkspaceId }
  | { type: "TIMELINE_LIST"; limit?: number }
  | {
      type: "VECTOR_SEARCH";
      query: string;
      workspaceId?: WorkspaceId;
      limit?: number;
    }
  | { type: "PERSONALIZATION_GET" }
  | {
      type: "PERSONALIZATION_FEEDBACK";
      accepted: boolean;
      action: AIAction;
      textPreview?: string;
    }
  | { type: "SET_WORKSPACE"; workspaceId: WorkspaceId }
  | { type: "OPEN_SIDE_PANEL" };

export type ExtensionResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export function validateMessage(raw: unknown): ExtensionRequest {
  if (!raw || typeof raw !== "object" || !("type" in raw)) {
    throw new Error("Invalid message: missing type");
  }
  const type = (raw as { type: string }).type;
  const schema = messageSchemas[type as keyof typeof messageSchemas];
  if (!schema) throw new Error(`Unknown message type: ${type}`);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid message payload: ${parsed.error.issues[0]?.message ?? "validation failed"}`);
  }
  return parsed.data as ExtensionRequest;
}

export function sendMessage<T = unknown>(
  message: ExtensionRequest
): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: ExtensionResponse) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!response || response.ok === false) {
          reject(new Error(response?.error ?? "Request failed"));
          return;
        }
        resolve(response.data as T);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export type {
  AIResponseEnvelope,
  Highlight,
  Note,
  PrivacyMode,
  ThemePreference,
  UserPrefs,
  WorkspaceId,
};
