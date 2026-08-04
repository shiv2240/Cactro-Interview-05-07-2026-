import type { AIProvider, GenerateOptions, StreamChunk } from "../types";

const USABLE = new Set(["readily", "available"]);

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
    return session.prompt(input);
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const session = await this.ensureSession();
    const input = options.system
      ? `${options.system}\n\n${options.prompt}`
      : options.prompt;
    const stream = session.promptStreaming(input);
    let previous = "";
    for await (const chunk of stream) {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      const delta = text.startsWith(previous) ? text.slice(previous.length) : text;
      previous = text.startsWith(previous) ? text : previous + text;
      if (delta) yield { text: delta, done: false };
    }
    yield { text: "", done: true };
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
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<string>;
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
