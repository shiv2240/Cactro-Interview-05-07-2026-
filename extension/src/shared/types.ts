/** Shared domain types for the AI Knowledge Assistant */

export type PrivacyMode = "private" | "sync" | "cloud_ai";
export type ThemePreference = "light" | "dark" | "system";
export type WorkspaceId =
  | "work"
  | "personal"
  | "coding"
  | "research"
  | "study";

export type AIAction =
  | "summarize"
  | "explain"
  | "rewrite"
  | "flashcards"
  | "page_summary"
  | "highlights_summary";

export type AIProviderId = "gemini-nano" | "groq";

export interface FeaturePrefs {
  keywordsTile: boolean;
  stickyNotes: boolean;
  saveHighlight: boolean;
  aiSummary: boolean;
  summarizePage: boolean;
}

export const DEFAULT_FEATURE_PREFS: FeaturePrefs = {
  keywordsTile: true,
  stickyNotes: true,
  saveHighlight: true,
  aiSummary: true,
  summarizePage: true,
};

export interface Highlight {
  id: string;
  text: string;
  url: string;
  title: string;
  timestamp: number;
  workspaceId: WorkspaceId;
  updatedAt: number;
  syncedAt?: number;
  deleted?: boolean;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  workspaceId: WorkspaceId;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
  deleted?: boolean;
}

export interface UserPrefs {
  theme: ThemePreference;
  privacyMode: PrivacyMode;
  workspaceId: WorkspaceId;
  featurePrefs: FeaturePrefs;
  summaryStyle: "concise" | "detailed" | "bullets";
  tone: "neutral" | "friendly" | "professional";
  groqApiKey?: string;
}

export const DEFAULT_PREFS: UserPrefs = {
  theme: "light",
  privacyMode: "sync",
  workspaceId: "personal",
  featurePrefs: DEFAULT_FEATURE_PREFS,
  summaryStyle: "concise",
  tone: "neutral",
};

export interface OfflineQueueItem {
  id: string;
  op: "upsert_highlight" | "delete_highlight" | "upsert_note" | "delete_note" | "upsert_prefs";
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface AICacheEntry {
  id: string;
  key: string;
  value: string;
  provider: AIProviderId;
  createdAt: number;
  expiresAt: number;
}

export interface AIResponseEnvelope {
  text: string;
  provider: AIProviderId;
  confidence: number;
  latencyMs: number;
  cached: boolean;
  streamed: boolean;
}

export interface AITimelineEvent {
  id: string;
  action: AIAction;
  preview: string;
  provider: AIProviderId;
  workspaceId: WorkspaceId;
  createdAt: number;
  latencyMs: number;
}

export interface PersonalizationProfile {
  interests: string[];
  tone: UserPrefs["tone"];
  summaryStyle: UserPrefs["summaryStyle"];
  acceptedActions: number;
  rejectedActions: number;
  updatedAt: number;
}

export interface VectorRecord {
  id: string;
  sourceType: "note" | "highlight";
  sourceId: string;
  workspaceId: WorkspaceId;
  embedding: number[];
  textPreview: string;
  updatedAt: number;
}

export const WORKSPACES: { id: WorkspaceId; label: string }[] = [
  { id: "work", label: "Work" },
  { id: "personal", label: "Personal" },
  { id: "coding", label: "Coding" },
  { id: "research", label: "Research" },
  { id: "study", label: "Study" },
];
