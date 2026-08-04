import type { AIAction, AIRequestContext } from "../types";

const ACTION_INSTRUCTIONS: Record<string, string> = {
  summarize: `Summarize in markdown:
## Overview
## Main Topics
## Key Takeaways
Be brief.`,
  explain: `Explain plainly: meaning, why it matters, jargon. Be brief.`,
  rewrite: `Rewrite for clarity. Return only the rewritten text.`,
  flashcards: `Create up to 5 flashcards:
### Q: ...
A: ...`,
  page_summary: `Page summary:
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
    return 150;
  }
  if (action === "summarize" || action === "explain") return 280;
  if (action === "rewrite") return 500;
  if (action === "flashcards") return 600;
  if (action === "page_summary" || action === "highlights_summary") return 450;
  return 300;
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

  // Lean system — skip workspace/tone fluff when not needed for speed.
  const system = `Concise knowledge assistant. Style: ${style}. No invented facts. Markdown OK.`;

  const meta = [
    ctx.pageTitle ? `Title: ${ctx.pageTitle}` : null,
    ctx.url ? `URL: ${ctx.url}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Cap input for interactive latency (still enough for page summaries).
  const textCap =
    ctx.action === "page_summary" || ctx.action === "highlights_summary"
      ? 24_000
      : 8_000;

  const prompt = `${instruction}

${meta ? meta + "\n\n" : ""}---
${ctx.text.slice(0, textCap)}
---`;

  return {
    system,
    prompt,
    maxTokens: maxTokensForAction(ctx.action, ctx.text.length),
    temperature: 0.2,
  };
}
