import type { AIProvider, GenerateOptions, StreamChunk } from "../types";

const USABLE = new Set(["readily", "available"]);

/**
 * Max wall-clock time for a single Nano generate/stream before we abort
 * the session and let AIService fall back to Groq.
 */
export const NANO_GENERATE_TIMEOUT_MS = 1_500;

export class NanoTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number = NANO_GENERATE_TIMEOUT_MS) {
    super(`Gemini Nano timed out after ${timeoutMs}ms`);
    this.name = "NanoTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Chrome Prompt API / Gemini Nano (on-device).
 * Never fakes availability — only reports ready after a real session.create().
 *
 * Enable (Chrome 128+ / Canary / Dev recommended):
 *   chrome://flags/#prompt-api-for-gemini-nano → Enabled
 *   chrome://flags/#optimization-guide-on-device-model → Enabled BypassPerfRequirement
 * Restart Chrome, then wait for the model under chrome://components
 * (Optimization Guide On Device Model) or chrome://on-device-internals.
 * Prompt API may be missing in the extension service worker even when flags
 * are on — Settings → Nano status shows the exact probe reason.
 */
export class GeminiNanoProvider implements AIProvider {
  readonly id = "gemini-nano" as const;
  private session: ChromeAISession | null = null;
  private ready = false;
  private lastDetail = "Gemini Nano not checked";

  async initialize(): Promise<void> {
    const ai = getChromeAI();
    if (!ai?.languageModel) {
      this.ready = false;
      this.session = null;
      this.lastDetail =
        "Unavailable: Prompt API missing — enable chrome://flags/#prompt-api-for-gemini-nano (and on-device model flag), restart Chrome";
      return;
    }
    try {
      const availability = await ai.languageModel.availability();
      // "after-download" / "downloadable" / "unavailable" are not usable yet.
      if (!USABLE.has(availability)) {
        this.ready = false;
        this.session = null;
        this.lastDetail = reasonForAvailability(availability);
        return;
      }
      this.session = await ai.languageModel.create({
        temperature: 0.4,
        topK: 40,
      });
      this.ready = true;
      this.lastDetail = `Available: Gemini Nano ready (${availability})`;
    } catch (e) {
      this.ready = false;
      this.session = null;
      this.lastDetail =
        e instanceof Error
          ? `Unavailable: Gemini Nano init failed — ${e.message}`
          : "Unavailable: Gemini Nano init failed";
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.ready && this.session) return true;
    // Re-probe once — never return true based on availability strings alone.
    await this.initialize();
    return Boolean(this.ready && this.session);
  }

  async generate(options: GenerateOptions): Promise<string> {
    const session = await this.ensureSession();
    const input = options.system
      ? `${options.system}\n\n${options.prompt}`
      : options.prompt;
    const timeoutMs = options.timeoutMs ?? NANO_GENERATE_TIMEOUT_MS;
    const { signal, cleanup } = linkTimeoutSignal(options.signal, timeoutMs);

    try {
      const text = await promptWithSignal(session, input, signal);
      if (signal.aborted) throw new NanoTimeoutError(timeoutMs);
      return text;
    } catch (e) {
      if (signal.aborted || isAbortError(e)) {
        await this.abortSession();
        throw new NanoTimeoutError(timeoutMs);
      }
      throw e;
    } finally {
      cleanup();
    }
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const session = await this.ensureSession();
    const input = options.system
      ? `${options.system}\n\n${options.prompt}`
      : options.prompt;
    const timeoutMs = options.timeoutMs ?? NANO_GENERATE_TIMEOUT_MS;
    const { signal, cleanup } = linkTimeoutSignal(options.signal, timeoutMs);

    try {
      const stream = promptStreamingWithSignal(session, input, signal);
      let previous = "";
      for await (const chunk of stream) {
        if (signal.aborted) {
          await this.abortSession();
          throw new NanoTimeoutError(timeoutMs);
        }
        const text = typeof chunk === "string" ? chunk : String(chunk);
        const delta = text.startsWith(previous)
          ? text.slice(previous.length)
          : text;
        previous = text.startsWith(previous) ? text : previous + text;
        if (delta) yield { text: delta, done: false };
      }
      if (signal.aborted) {
        await this.abortSession();
        throw new NanoTimeoutError(timeoutMs);
      }
      yield { text: "", done: true };
    } catch (e) {
      if (e instanceof NanoTimeoutError) throw e;
      if (signal.aborted || isAbortError(e)) {
        await this.abortSession();
        throw new NanoTimeoutError(timeoutMs);
      }
      throw e;
    } finally {
      cleanup();
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const available = await this.isAvailable();
    return {
      ok: available,
      detail:
        this.lastDetail ||
        (available ? "Available: Gemini Nano" : "Unavailable: Gemini Nano"),
    };
  }

  async dispose(): Promise<void> {
    this.session?.destroy?.();
    this.session = null;
    this.ready = false;
    this.lastDetail = "Gemini Nano disposed — recheck required";
  }

  /** Kill the active session after a timeout without marking Nano unavailable. */
  private async abortSession(): Promise<void> {
    try {
      this.session?.destroy?.();
    } catch {
      /* ignore destroy races */
    }
    this.session = null;
    // Keep ready=true so Nano remains usable as backup; ensureSession will recreate.
    this.lastDetail =
      "Available: Gemini Nano (last request timed out)";
  }

  private async ensureSession(): Promise<ChromeAISession> {
    if (!this.session) await this.initialize();
    if (!this.session) throw new Error("Gemini Nano is not available");
    return this.session;
  }
}

function reasonForAvailability(availability: string): string {
  switch (availability) {
    case "downloadable":
    case "after-download":
    case "downloading":
      return `Unavailable: model not ready (${availability}) — wait for download in chrome://components or chrome://on-device-internals`;
    case "unavailable":
      return "Unavailable: on-device model blocked — check Chrome flags / hardware support";
    default:
      return `Unavailable: Gemini Nano status "${availability}"`;
  }
}

interface ChromeAISession {
  prompt(
    input: string,
    opts?: { signal?: AbortSignal }
  ): Promise<string>;
  promptStreaming(
    input: string,
    opts?: { signal?: AbortSignal }
  ): AsyncIterable<string>;
  destroy?: () => void;
}

interface ChromeLanguageModel {
  availability(): Promise<string>;
  create(opts?: { temperature?: number; topK?: number }): Promise<ChromeAISession>;
}

interface ChromeAI {
  languageModel?: ChromeLanguageModel;
}

function getChromeAI(): ChromeAI | undefined {
  const g = globalThis as typeof globalThis & {
    ai?: ChromeAI;
    LanguageModel?: ChromeLanguageModel;
  };
  if (g.ai?.languageModel) return g.ai;
  if (g.LanguageModel) return { languageModel: g.LanguageModel };
  return undefined;
}

/** Combine an optional external signal with a wall-clock timeout. */
function linkTimeoutSignal(
  external: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) {
      controller.abort();
    } else {
      external.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

async function promptWithSignal(
  session: ChromeAISession,
  input: string,
  signal: AbortSignal
): Promise<string> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  // Prefer native AbortSignal on prompt(); race as a hard ceiling if unsupported.
  try {
    return await Promise.race([
      session.prompt(input, { signal }),
      abortPromise(signal),
    ]);
  } catch (e) {
    // Older Prompt API builds reject unknown options — retry without opts + race.
    if (isAbortError(e) || signal.aborted) throw e;
    if (isOptionError(e)) {
      return await Promise.race([session.prompt(input), abortPromise(signal)]);
    }
    throw e;
  }
}

function promptStreamingWithSignal(
  session: ChromeAISession,
  input: string,
  signal: AbortSignal
): AsyncIterable<string> {
  try {
    return session.promptStreaming(input, { signal });
  } catch (e) {
    if (isOptionError(e)) {
      return session.promptStreaming(input);
    }
    throw e;
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true }
    );
  });
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

function isOptionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /signal|option|argument|parameter/i.test(msg);
}
