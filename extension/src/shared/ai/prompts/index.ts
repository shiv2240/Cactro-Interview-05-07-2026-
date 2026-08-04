import type { AIAction, AIRequestContext } from "../types";

const ACTION_INSTRUCTIONS: Record<string, string> = {
  summarize: `Summarize ONLY the user's selected text in context.
The user selected text is the primary subject — do not invent a different topic from the page title.
Ignore website chrome (nav, menus, sidebars, "Search", "Edit", "Watch", "Talk", language switchers).
Include short page context only when it clarifies the selection.

Markdown:
## Overview
## Main Topics
## Key Takeaways
Be brief.`,
  explain: `Explain ONLY the user's selected term or phrase (exact string in "The user selected: …").
Center every section on that term (e.g. "Maryland", "Edwin A. Locke"). Do NOT summarize the whole page topic instead.
NEVER quote or paraphrase website chrome: nav, menus, "Jump to content", "Main menu", "Search", "Donate", "Create account", "Log in", "Contents hide", "Toggle … subsection", TOC lists, language switchers.
If cleaned page context is missing or looks like UI chrome, explain the term from the page title + your knowledge of the selection only.

Markdown:
## Meaning
## On this page
## Why it matters
Be brief.`,
  rewrite: `Rewrite for clarity. Return only the rewritten text.`,
  flashcards: `Create up to 5 flashcards:
### Q: ...
A: ...`,
  page_summary: `Summarize the main article content below.
Ignore nav, menus, headers, footers, sidebars, and Wikipedia chrome ("Search", "Talk", "Edit", "Watch", TOC).
Do not treat UI labels as topics.

Markdown:
## Overview
## Main Topics
## Key Takeaways`,
  highlights_summary: `Themes + takeaways from highlights:
## Overview
## Themes
## Key Takeaways`,
};

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
  const style = ctx.summaryStyle ?? "concise";
  const instruction =
    ACTION_INSTRUCTIONS[ctx.action] ?? ACTION_INSTRUCTIONS.summarize;

  const system = `Concise knowledge assistant. Style: ${style}. No invented facts. Markdown OK. Always prioritize the user's exact selection over page title or nav chrome.`;

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

  const prompt = `${instruction}

${body}`;

  const lenForBudget = selected.length || ctx.text.length;
  return {
    system,
    prompt,
    maxTokens: maxTokensForAction(ctx.action, lenForBudget),
    temperature: 0.2,
  };
}
