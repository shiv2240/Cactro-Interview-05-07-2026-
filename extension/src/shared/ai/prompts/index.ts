import type { AIAction, AIRequestContext } from "../types";
import type { UserPrefs } from "../../types";

type SummaryStyle = UserPrefs["summaryStyle"];
type Tone = UserPrefs["tone"];

const ACTION_INSTRUCTIONS: Record<string, string> = {
  summarize: `Summarize ONLY the user's selected text in context.
The user selected text is the primary subject — do not invent a different topic from the page title.
Ignore website chrome (nav, menus, sidebars, "Search", "Edit", "Watch", "Talk", language switchers).
Include short page context only when it clarifies the selection.`,
  explain: `Explain ONLY the user's selected term or phrase (exact string in "The user selected: …").
Center every section on that term (e.g. "Maryland", "Edwin A. Locke"). Do NOT summarize the whole page topic instead.
NEVER quote or paraphrase website chrome: nav, menus, "Jump to content", "Main menu", "Search", "Donate", "Create account", "Log in", "Contents hide", "Toggle … subsection", TOC lists, language switchers.
If cleaned page context is missing or looks like UI chrome, explain the term from the page title + your knowledge of the selection only.`,
  rewrite: `Rewrite for clarity. Return only the rewritten text.`,
  flashcards: `Create up to 5 flashcards:
### Q: ...
A: ...`,
  page_summary: `Summarize the main article content below.
Ignore nav, menus, headers, footers, sidebars, and Wikipedia chrome ("Search", "Talk", "Edit", "Watch", TOC).
Do not treat UI labels as topics.`,
  highlights_summary: `Themes + takeaways from the user's saved highlights.
Group related ideas; do not invent highlights that are not listed.`,
};

/** Default sectioned layout when style is concise or detailed. */
const STRUCTURE_HINTS: Partial<Record<AIAction, string>> = {
  summarize: `## Overview\n## Main Topics\n## Key Takeaways`,
  explain: `## Meaning\n## On this page\n## Why it matters`,
  page_summary: `## Overview\n## Main Topics\n## Key Takeaways`,
  highlights_summary: `## Overview\n## Themes\n## Key Takeaways`,
};

const STYLE_INSTRUCTIONS: Record<SummaryStyle, string> = {
  concise:
    "Keep the answer short and dense. Prefer 3–6 short sentences or a tight sectioned layout. No fluff.",
  detailed:
    "Be thorough: expand with supporting detail, nuance, and examples where helpful. Still stay factual.",
  bullets:
    "Respond as markdown bullet points only. Use `-` bullets (nested bullets OK). Do not use ## headings or long prose paragraphs.",
};

const TONE_INSTRUCTIONS: Record<Tone, string> = {
  neutral:
    "Tone: neutral and factual. Plain language, no cheerleading or corporate polish.",
  friendly:
    "Tone: warm and conversational — friendly, approachable, and lightly encouraging without being gimmicky.",
  professional:
    "Tone: professional and polished — clear, precise, and suitable for workplace or academic use.",
};

function normalizeStyle(raw: string | undefined): SummaryStyle {
  if (raw === "detailed" || raw === "bullets" || raw === "concise") return raw;
  return "concise";
}

function normalizeTone(raw: string | undefined): Tone {
  if (raw === "friendly" || raw === "professional" || raw === "neutral")
    return raw;
  return "neutral";
}

/** Explicit style + tone lines injected into every generate/stream call. */
export function styleAndToneInstructions(
  summaryStyle?: string,
  tone?: string
): string {
  const style = normalizeStyle(summaryStyle);
  const t = normalizeTone(tone);
  return `${STYLE_INSTRUCTIONS[style]}\n${TONE_INSTRUCTIONS[t]}`;
}

function formatHintForAction(
  action: AIAction,
  style: SummaryStyle
): string | null {
  if (action === "rewrite" || action === "flashcards") return null;
  if (style === "bullets") {
    return "Format: markdown bullet list only (no ## headings).";
  }
  const structure = STRUCTURE_HINTS[action];
  if (!structure) return null;
  if (style === "detailed") {
    return `Markdown sections:\n${structure}\nExpand each section with useful detail.`;
  }
  return `Markdown sections (keep brief):\n${structure}`;
}

/** Token budgets tuned for TTFT / short interactive summaries. */
export function maxTokensForAction(action: AIAction, textLen: number): number {
  // Word / short phrase meaning → keep tiny
  if (textLen < 80 && (action === "summarize" || action === "explain")) {
    return 220;
  }
  if (action === "summarize" || action === "explain") return 320;
  if (action === "rewrite") return 500;
  if (action === "flashcards") return 600;
  if (action === "page_summary" || action === "highlights_summary") return 450;
  return 300;
}

function isSelectionFocused(action: AIAction): boolean {
  return action === "summarize" || action === "explain";
}

export function buildPrompt(ctx: AIRequestContext): {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
} {
  const style = normalizeStyle(ctx.summaryStyle);
  const tone = normalizeTone(ctx.tone);
  const instruction =
    ACTION_INSTRUCTIONS[ctx.action] ?? ACTION_INSTRUCTIONS.summarize;
  const formatHint = formatHintForAction(ctx.action, style);
  const personalization = styleAndToneInstructions(style, tone);

  const system = `You are a knowledge assistant. No invented facts. Markdown OK when asked. Always prioritize the user's exact selection over page title or nav chrome.

User preferences (must follow):
${personalization}`;

  const meta = [
    ctx.pageTitle ? `Page title (secondary context only): ${ctx.pageTitle}` : null,
    ctx.url ? `URL: ${ctx.url}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const selected =
    (ctx.selectedText ?? "").trim() ||
    (isSelectionFocused(ctx.action) ? ctx.text.trim() : "");

  const textCap =
    ctx.action === "page_summary" || ctx.action === "highlights_summary"
      ? 24_000
      : 8_000;

  const contextCap = 3_000;
  const pageContext = (ctx.pageContext ?? "").trim().slice(0, contextCap);

  let body: string;
  if (isSelectionFocused(ctx.action) && selected) {
    const parts = [
      `The user selected: "${selected}"`,
      `Focus only on this. Ignore website chrome.`,
      meta || null,
      pageContext
        ? `Cleaned page context (secondary, use only if needed):\n${pageContext}`
        : null,
      // Keep raw text block for longer selections when it differs
      ctx.text.trim() &&
      ctx.text.trim() !== selected &&
      ctx.text.trim().length > selected.length + 20
        ? `Additional selected passage:\n${ctx.text.slice(0, textCap)}`
        : null,
    ].filter(Boolean);
    body = parts.join("\n\n");
  } else {
    body = `${meta ? meta + "\n\n" : ""}---\n${ctx.text.slice(0, textCap)}\n---`;
  }

  const prompt = [
    instruction,
    formatHint,
    `Follow these style/tone rules:\n${personalization}`,
    body,
  ]
    .filter(Boolean)
    .join("\n\n");

  const lenForBudget = selected.length || ctx.text.length;
  const maxTokens =
    style === "detailed"
      ? Math.min(maxTokensForAction(ctx.action, lenForBudget) + 120, 700)
      : maxTokensForAction(ctx.action, lenForBudget);

  return {
    system,
    prompt,
    maxTokens,
    temperature: tone === "friendly" ? 0.35 : 0.2,
  };
}
