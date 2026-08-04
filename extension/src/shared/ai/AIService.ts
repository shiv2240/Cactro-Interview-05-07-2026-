import { getCachedAI, setCachedAI } from "../db/aiCache";
import { getPrefs } from "../db/schema";
import { addTimelineEvent } from "../db/timeline";
import { WORKSPACES, type WorkspaceId } from "../types";
import { buildPrompt } from "./prompts";
import {
  GeminiNanoProvider,
  NANO_GENERATE_TIMEOUT_MS,
  NanoTimeoutError,
} from "./providers/geminiNano";
import {
  GroqProvider,
  GROQ_REQUEST_TIMEOUT_MS,
} from "./providers/groq";
import type { AIProvider, AIRequestContext, AIResponseEnvelope } from "./types";

/** Prefer prefs enrichment if ready within this budget; else send lean prompt. */
const ENRICH_BUDGET_MS = 50;

class ProviderManager {
  private groq = new GroqProvider();
  private nano = new GeminiNanoProvider();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([
      this.groq.initialize().catch(() => undefined),
      this.nano.initialize().catch(() => undefined),
    ]);
    this.initialized = true;
  }

  /**
   * Interactive hot path: Groq only.
   * Nano is never tried before Groq.
   */
  async pickPrimary(): Promise<AIProvider> {
    await this.init();
    if (await this.groq.isAvailable()) return this.groq;
    throw new Error(
      "No AI provider available. Groq key is not configured for this build."
    );
  }

  /** Offline / Groq-failure fallback only. */
  async pickNanoFallback(): Promise<AIProvider | null> {
    await this.init();
    try {
      if (await this.nano.isAvailable()) return this.nano;
    } catch {
      /* ignore */
    }
    return null;
  }

  async health(): Promise<{ provider: string; ok: boolean; detail?: string }[]> {
    await this.init();
    const providers: AIProvider[] = [this.groq, this.nano];
    return Promise.all(
      providers.map(async (p) => {
        const h = await p.healthCheck();
        return { provider: p.id, ...h };
      })
    );
  }

  async recheck(): Promise<{ provider: string; ok: boolean; detail?: string }[]> {
    await this.init();
    await Promise.all([
      this.groq.dispose().catch(() => undefined),
      this.nano.dispose().catch(() => undefined),
    ]);
    this.initialized = false;
    await this.init();
    return this.health();
  }

  /** Non-blocking TLS/connection warm for Groq. */
  async warmup(): Promise<void> {
    await this.init();
    if (await this.groq.isAvailable()) {
      void this.groq.warmup();
    }
  }
}

const manager = new ProviderManager();

async function enrichContext(
  ctx: AIRequestContext
): Promise<{ enriched: AIRequestContext; workspaceId: WorkspaceId }> {
  const prefsPromise = getPrefs();
  const raced = await Promise.race([
    prefsPromise.then((prefs) => ({ prefs, timedOut: false as const })),
    new Promise<{ prefs: null; timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ prefs: null, timedOut: true }), ENRICH_BUDGET_MS)
    ),
  ]);

  if (raced.timedOut || !raced.prefs) {
    // Kick off AI without waiting; fire-and-forget prefs for timeline later.
    void prefsPromise;
    return { enriched: { ...ctx }, workspaceId: "personal" };
  }

  const prefs = raced.prefs;
  return {
    enriched: {
      ...ctx,
      summaryStyle: ctx.summaryStyle ?? prefs.summaryStyle,
      tone: ctx.tone ?? prefs.tone,
      workspaceLabel:
        ctx.workspaceLabel ??
        WORKSPACES.find((w) => w.id === prefs.workspaceId)?.label,
    },
    workspaceId: prefs.workspaceId,
  };
}

function logBreakdown(parts: Record<string, number | string | boolean>) {
  const bits = Object.entries(parts)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[AI latency] ${bits}`);
}

export async function generateAI(
  ctx: AIRequestContext
): Promise<AIResponseEnvelope> {
  const start = Date.now();

  const cached = await getCachedAI(ctx.action, ctx.text);
  if (cached) {
    const latencyMs = Date.now() - start;
    logBreakdown({
      path: "generate",
      cached: true,
      total: latencyMs,
      action: ctx.action,
    });
    return {
      text: cached.value,
      provider: cached.provider,
      confidence: 0.85,
      latencyMs,
      cached: true,
      streamed: false,
    };
  }

  const enrichT0 = Date.now();
  const { enriched, workspaceId } = await enrichContext(ctx);
  const enrichMs = Date.now() - enrichT0;
  const { system, prompt, maxTokens, temperature } = buildPrompt(enriched);

  let provider = await manager.pickPrimary();
  let text = "";
  const networkT0 = Date.now();

  try {
    text = await provider.generate({
      system,
      prompt,
      maxTokens,
      temperature,
      timeoutMs: GROQ_REQUEST_TIMEOUT_MS,
    });
  } catch (primaryErr) {
    // Groq failed → optional Nano (never before Groq). Timeout only on Nano path.
    const fallback = await manager.pickNanoFallback();
    if (fallback) {
      provider = fallback;
      text = await provider.generate({
        system,
        prompt,
        maxTokens,
        temperature,
        timeoutMs: NANO_GENERATE_TIMEOUT_MS,
      });
    } else {
      throw primaryErr;
    }
  }

  const networkMs = Date.now() - networkT0;
  const latencyMs = Date.now() - start;
  logBreakdown({
    path: "generate",
    provider: provider.id,
    queue: enrichMs,
    network: networkMs,
    total: latencyMs,
    action: ctx.action,
  });

  void setCachedAI(ctx.action, ctx.text, text, provider.id);
  void addTimelineEvent({
    action: ctx.action,
    preview: text.slice(0, 160),
    provider: provider.id,
    workspaceId,
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

  const cached = await getCachedAI(ctx.action, ctx.text);
  if (cached) {
    const latencyMs = Date.now() - start;
    logBreakdown({
      path: "stream",
      cached: true,
      total: latencyMs,
      action: ctx.action,
    });
    yield { chunk: cached.value, done: false };
    yield {
      chunk: "",
      done: true,
      envelope: {
        text: cached.value,
        provider: cached.provider,
        confidence: 0.85,
        latencyMs,
        cached: true,
        streamed: true,
      },
    };
    return;
  }

  const enrichT0 = Date.now();
  const { enriched, workspaceId } = await enrichContext(ctx);
  const enrichMs = Date.now() - enrichT0;
  const { system, prompt, maxTokens, temperature } = buildPrompt(enriched);

  let provider = await manager.pickPrimary();
  let full = "";
  let ttftMs: number | null = null;
  const networkT0 = Date.now();

  try {
    for await (const part of provider.stream({
      system,
      prompt,
      maxTokens,
      temperature,
      timeoutMs: GROQ_REQUEST_TIMEOUT_MS,
    })) {
      if (part.text) {
        if (ttftMs === null) ttftMs = Date.now() - start;
        full += part.text;
        yield { chunk: part.text, done: false };
      }
      if (part.done) break;
    }
  } catch (err) {
    // Drop partial Groq output and try Nano only on explicit Groq failure.
    const fallback = await manager.pickNanoFallback();
    if (provider.id === "groq" && fallback) {
      provider = fallback;
      full = "";
      ttftMs = null;
      for await (const part of provider.stream({
        system,
        prompt,
        maxTokens,
        temperature,
        timeoutMs: NANO_GENERATE_TIMEOUT_MS,
      })) {
        if (part.text) {
          if (ttftMs === null) ttftMs = Date.now() - start;
          full += part.text;
          yield { chunk: part.text, done: false };
        }
        if (part.done) break;
      }
    } else {
      throw err instanceof NanoTimeoutError
        ? err
        : err instanceof Error
          ? err
          : new Error("AI streaming failed");
    }
  }

  const networkMs = Date.now() - networkT0;
  const latencyMs = Date.now() - start;
  logBreakdown({
    path: "stream",
    provider: provider.id,
    queue: enrichMs,
    ttft: ttftMs ?? "-",
    network: networkMs,
    total: latencyMs,
    action: ctx.action,
  });

  void setCachedAI(ctx.action, ctx.text, full, provider.id);
  void addTimelineEvent({
    action: ctx.action,
    preview: full.slice(0, 160),
    provider: provider.id,
    workspaceId,
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

/** Fire-and-forget Groq warm ping (install / SW wake / side panel open). */
export async function warmupAI(): Promise<{ started: boolean }> {
  void manager.warmup();
  return { started: true };
}

export { GROQ_REQUEST_TIMEOUT_MS };
