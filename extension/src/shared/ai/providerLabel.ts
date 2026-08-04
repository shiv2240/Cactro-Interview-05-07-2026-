import type { AIProviderId } from "../types";

/**
 * User-facing meta for AI responses.
 * Provider brand names (Gemini Nano / Groq) are intentionally hidden —
 * end users only see generic timing / cache hints.
 */
export function providerBadge(
  _provider: AIProviderId | string | undefined,
  opts?: { cached?: boolean; fallback?: boolean }
): string {
  // Keep signature for call sites; do not surface Nano/Groq names in the UI.
  if (opts?.cached) return "Cached";
  return "";
}

/** Latency-only meta line for status / card footers (no provider names). */
export function aiMetaLine(
  latencyMs: number | undefined,
  opts?: { cached?: boolean }
): string {
  const parts: string[] = [];
  if (opts?.cached) parts.push("Cached");
  if (latencyMs != null) parts.push(`${latencyMs}ms`);
  return parts.join(" · ");
}
