import { getDB } from "../db/schema";
import type { AIAction, PersonalizationProfile, UserPrefs } from "../types";
import { setPrefs } from "../db/schema";

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

  let tone: UserPrefs["tone"] = current.tone;
  let summaryStyle: UserPrefs["summaryStyle"] = current.summaryStyle;
  if (input.accepted && input.action === "summarize") {
    summaryStyle = "concise";
  }
  if (input.accepted && input.action === "explain") {
    tone = "friendly";
  }

  const next: PersonalizationProfile = {
    interests,
    tone,
    summaryStyle,
    acceptedActions: current.acceptedActions + (input.accepted ? 1 : 0),
    rejectedActions: current.rejectedActions + (input.accepted ? 0 : 1),
    updatedAt: Date.now(),
  };

  await db.put("personalization", { id: "default", ...next });
  await setPrefs({ tone: next.tone, summaryStyle: next.summaryStyle });
  return next;
}
