import { getCachedAI, setCachedAI } from "../db/aiCache";
import { getPrefs } from "../db/schema";
import { addTimelineEvent } from "../db/timeline";
import { WORKSPACES } from "../types";
import { buildPrompt } from "./prompts";
import { GeminiNanoProvider } from "./providers/geminiNano";
import { GroqProvider } from "./providers/groq";
import type { AIProvider, AIRequestContext, AIResponseEnvelope } from "./types";

class ProviderManager {
  private providers: AIProvider[] = [];
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.providers = [new GeminiNanoProvider(), new GroqProvider()];
    await Promise.all(this.providers.map((p) => p.initialize().catch(() => undefined)));
    this.initialized = true;
  }

  async pick(): Promise<AIProvider> {
    await this.init();
    // Order: Gemini Nano (on-device) → Groq (developer-bundled / optional override)
    for (const p of this.providers) {
      try {
        if (await p.isAvailable()) return p;
      } catch {
        /* try next provider */
      }
    }
    throw new Error(
      "No AI provider available. Gemini Nano is unavailable and no Groq fallback key is configured for this build."
    );
  }

  async health(): Promise<{ provider: string; ok: boolean; detail?: string }[]> {
    await this.init();
    return Promise.all(
      this.providers.map(async (p) => {
        const h = await p.healthCheck();
        return { provider: p.id, ...h };
      })
    );
  }

  /** Force dispose + re-probe (Settings → Recheck Nano). */
  async recheck(): Promise<{ provider: string; ok: boolean; detail?: string }[]> {
    await this.init();
    await Promise.all(this.providers.map((p) => p.dispose().catch(() => undefined)));
    this.initialized = false;
    await this.init();
    return this.health();
  }
}

const manager = new ProviderManager();

export async function generateAI(
  ctx: AIRequestContext
): Promise<AIResponseEnvelope> {
  const start = Date.now();
  const cached = await getCachedAI(ctx.action, ctx.text);
  if (cached) {
    // Envelope always includes provider so UI can badge Nano vs Groq.
    return {
      text: cached.value,
      provider: cached.provider,
      confidence: 0.85,
      latencyMs: Date.now() - start,
      cached: true,
      streamed: false,
    };
  }

  const prefs = await getPrefs();
  const enriched: AIRequestContext = {
    ...ctx,
    summaryStyle: ctx.summaryStyle ?? prefs.summaryStyle,
    tone: ctx.tone ?? prefs.tone,
    workspaceLabel:
      ctx.workspaceLabel ??
      WORKSPACES.find((w) => w.id === prefs.workspaceId)?.label,
  };

  const { system, prompt } = buildPrompt(enriched);
  let provider = await manager.pick();
  let text = "";

  try {
    text = await provider.generate({ system, prompt });
  } catch (primaryErr) {
    // Invisible fallback: try next provider
    await manager.init();
    const fallback = new GroqProvider();
    if (provider.id !== "groq" && (await fallback.isAvailable())) {
      provider = fallback;
      text = await provider.generate({ system, prompt });
    } else {
      throw primaryErr;
    }
  }

  const latencyMs = Date.now() - start;
  await setCachedAI(ctx.action, ctx.text, text, provider.id);
  await addTimelineEvent({
    action: ctx.action,
    preview: text.slice(0, 160),
    provider: provider.id,
    workspaceId: prefs.workspaceId,
    createdAt: Date.now(),
    latencyMs,
  });

  return {
    text,
    provider: provider.id,
    confidence: provider.id === "gemini-nano" ? 0.8 : 0.75,
    latencyMs,
    cached: false,
    streamed: false,
  };
}

export async function* streamAI(
  ctx: AIRequestContext
): AsyncGenerator<{ chunk: string; done: boolean; envelope?: AIResponseEnvelope }> {
  const start = Date.now();
  const prefs = await getPrefs();
  const enriched: AIRequestContext = {
    ...ctx,
    summaryStyle: ctx.summaryStyle ?? prefs.summaryStyle,
    tone: ctx.tone ?? prefs.tone,
    workspaceLabel:
      ctx.workspaceLabel ??
      WORKSPACES.find((w) => w.id === prefs.workspaceId)?.label,
  };
  const { system, prompt } = buildPrompt(enriched);

  let provider = await manager.pick();
  let full = "";

  try {
    for await (const part of provider.stream({ system, prompt })) {
      if (part.text) {
        full += part.text;
        yield { chunk: part.text, done: false };
      }
      if (part.done) break;
    }
  } catch {
    const fallback = new GroqProvider();
    if (provider.id !== "groq" && (await fallback.isAvailable())) {
      provider = fallback;
      full = "";
      for await (const part of provider.stream({ system, prompt })) {
        if (part.text) {
          full += part.text;
          yield { chunk: part.text, done: false };
        }
        if (part.done) break;
      }
    } else {
      throw new Error("AI streaming failed");
    }
  }

  const latencyMs = Date.now() - start;
  await setCachedAI(ctx.action, ctx.text, full, provider.id);
  await addTimelineEvent({
    action: ctx.action,
    preview: full.slice(0, 160),
    provider: provider.id,
    workspaceId: prefs.workspaceId,
    createdAt: Date.now(),
    latencyMs,
  });

  yield {
    chunk: "",
    done: true,
    envelope: {
      text: full,
      provider: provider.id,
      confidence: provider.id === "gemini-nano" ? 0.8 : 0.75,
      latencyMs,
      cached: false,
      streamed: true,
    },
  };
}

export async function aiHealth(opts?: { recheck?: boolean }) {
  if (opts?.recheck) return manager.recheck();
  return manager.health();
}
