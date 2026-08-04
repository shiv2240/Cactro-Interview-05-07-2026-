import { getPrefs, setPrefs } from "../db/schema";
import type { FeaturePrefs, ThemePreference } from "../types";
import { DEFAULT_FEATURE_PREFS } from "../types";

const FEATURE_KEY = "hs_feature_prefs";
const THEME_KEY = "theme";

/** Map legacy v1 feature-pref keys onto the v2 FeaturePrefs shape. */
function normalizeFeaturePrefs(raw: Record<string, unknown>): FeaturePrefs {
  return {
    keywordsTile:
      typeof raw.keywordsTile === "boolean"
        ? raw.keywordsTile
        : raw.keywordsTileEnabled !== false,
    stickyNotes:
      typeof raw.stickyNotes === "boolean"
        ? raw.stickyNotes
        : raw.stickyNotesEnabled !== false,
    saveHighlight:
      typeof raw.saveHighlight === "boolean"
        ? raw.saveHighlight
        : raw.tooltipSave !== false,
    aiSummary:
      typeof raw.aiSummary === "boolean"
        ? raw.aiSummary
        : raw.tooltipAiSummary !== false,
    summarizePage:
      typeof raw.summarizePage === "boolean"
        ? raw.summarizePage
        : raw.tooltipSummarizePage !== false,
  };
}

/** Bridge legacy chrome.storage keys with IndexedDB prefs. */
export async function hydratePrefsFromChromeStorage(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([FEATURE_KEY, THEME_KEY]);
    const patch: Parameters<typeof setPrefs>[0] = {};
    if (result[THEME_KEY] === "light" || result[THEME_KEY] === "dark" || result[THEME_KEY] === "system") {
      patch.theme = result[THEME_KEY] as ThemePreference;
    }
    if (result[FEATURE_KEY] && typeof result[FEATURE_KEY] === "object") {
      patch.featurePrefs = {
        ...DEFAULT_FEATURE_PREFS,
        ...normalizeFeaturePrefs(result[FEATURE_KEY] as Record<string, unknown>),
      };
    }
    if (Object.keys(patch).length) await setPrefs(patch);
  } catch {
    /* ignore */
  }
}

export async function mirrorPrefsToChromeStorage(): Promise<void> {
  try {
    const prefs = await getPrefs();
    await chrome.storage.local.set({
      [THEME_KEY]: prefs.theme,
      [FEATURE_KEY]: prefs.featurePrefs,
    });
  } catch {
    /* ignore */
  }
}

export { DEFAULT_FEATURE_PREFS };
