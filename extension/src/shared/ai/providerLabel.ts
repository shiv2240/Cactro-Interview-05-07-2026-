import type { AIProviderId } from "../types";

/** User-facing label for which model served a response. */
export function providerBadge(
  provider: AIProviderId | string | undefined,
  opts?: { cached?: boolean; fallback?: boolean }
): string {
  let label: string;
  if (provider === "gemini-nano") {
    label = "Gemini Nano";
  } else if (provider === "groq") {
    label = opts?.fallback === false ? "Groq" : "Groq (fallback)";
  } else {
    label = provider ? String(provider) : "AI";
  }
  if (opts?.cached) label += " · cached";
  return label;
}
