import { getDB } from "../db/schema";
import type { AIAction, PersonalizationProfile, UserPrefs } from "../types";

const DEFAULT_PROFILE: PersonalizationProfile = {
  interests: [],
  tone: "neutral",
  summaryStyle: "concise",
  acceptedActions: 0,
  rejectedActions: 0,
  updatedAt: Date.now(),
};

export async function getProfile(): Promise<PersonalizationProfile> {
  const db = await getDB();
  const row = await db.get("personalization", "default");
  if (!row) return { ...DEFAULT_PROFILE };
  const { id: _id, ...profile } = row;
  return profile;
}

/**
 * Settings is the source of truth for tone/style.
 * Keep the personalization profile in sync so Timeline reflects explicit choices.
 */
export async function syncProfileStyleFromPrefs(partial: {
  tone?: UserPrefs["tone"];
  summaryStyle?: UserPrefs["summaryStyle"];
}): Promise<PersonalizationProfile> {
  const db = await getDB();
  const current = await getProfile();
  const next: PersonalizationProfile = {
    ...current,
    tone: partial.tone ?? current.tone,
    summaryStyle: partial.summaryStyle ?? current.summaryStyle,
    updatedAt: Date.now(),
  };
  await db.put("personalization", { id: "default", ...next });
  return next;
}

/**
 * Accept/Reject updates interests + counts.
 * Tone/style stay as the user's Settings choice (not overwritten by heuristics).
 */
export async function recordFeedback(input: {
  accepted: boolean;
  action: AIAction;
  textPreview?: string;
}): Promise<PersonalizationProfile> {
  const db = await getDB();
  const current = await getProfile();
  const interests = [...current.interests];
  if (input.accepted && input.textPreview) {
    const tokens = input.textPreview
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t.length > 4)
      .slice(0, 5);
    for (const t of tokens) {
      if (!interests.includes(t) && interests.length < 40) interests.push(t);
    }
  }

  const next: PersonalizationProfile = {
    interests,
    // Preserve Settings-driven tone/style; feedback only learns interests/counts.
    tone: current.tone,
    summaryStyle: current.summaryStyle,
    acceptedActions: current.acceptedActions + (input.accepted ? 1 : 0),
    rejectedActions: current.rejectedActions + (input.accepted ? 0 : 1),
    updatedAt: Date.now(),
  };

  await db.put("personalization", { id: "default", ...next });
  return next;
}
