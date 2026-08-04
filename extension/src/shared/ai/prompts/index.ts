import type { AIRequestContext } from "../types";

const ACTION_INSTRUCTIONS: Record<string, string> = {
  summarize: `Summarize the text into three sections:
## Overview
## Main Topics
## Key Takeaways
Keep it clear and useful.`,
  explain: `Explain the selected text in plain language. Cover what it means, why it matters, and any jargon.`,
  rewrite: `Rewrite the text to improve clarity while preserving meaning. Return only the rewritten text.`,
  flashcards: `Create 5 flashcards from the text as markdown:
### Q: ...
A: ...`,
  page_summary: `Summarize this page content into:
## Overview
## Agenda / Main Topics
## Key Takeaways`,
  highlights_summary: `Summarize these saved highlights into themes and actionable takeaways:
## Overview
## Themes
## Key Takeaways`,
};

export function buildPrompt(ctx: AIRequestContext): {
  system: string;
  prompt: string;
} {
  const style = ctx.summaryStyle ?? "concise";
  const tone = ctx.tone ?? "neutral";
  const workspace = ctx.workspaceLabel ?? "Personal";

  const system = [
    "You are an AI knowledge assistant embedded in a Chrome extension.",
    `Tone: ${tone}. Summary style: ${style}.`,
    `Current workspace: ${workspace}.`,
    "Do not invent facts. Prefer structured markdown.",
  ].join(" ");

  const instruction =
    ACTION_INSTRUCTIONS[ctx.action] ?? ACTION_INSTRUCTIONS.summarize;

  const meta = [
    ctx.pageTitle ? `Page title: ${ctx.pageTitle}` : null,
    ctx.url ? `URL: ${ctx.url}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `${instruction}

${meta ? meta + "\n\n" : ""}---
${ctx.text.slice(0, 80_000)}
---`;

  return { system, prompt };
}
