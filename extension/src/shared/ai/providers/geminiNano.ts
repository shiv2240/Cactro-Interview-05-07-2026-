import type { AIProvider, GenerateOptions, StreamChunk } from "../types";

/** Chrome Prompt API / Gemini Nano provider (when available in Chrome). */
export class GeminiNanoProvider implements AIProvider {
  readonly id = "gemini-nano" as const;
  private session: ChromeAISession | null = null;
  private ready = false;

  async initialize(): Promise<void> {
    const ai = getChromeAI();
    if (!ai?.languageModel) {
      this.ready = false;
      return;
    }
    try {
      const availability = await ai.languageModel.availability();
      if (availability !== "readily" && availability !== "available" && availability !== "after-download") {
        this.ready = false;
        return;
      }
      this.session = await ai.languageModel.create({
        temperature: 0.4,
        topK: 40,
      });
      this.ready = true;
    } catch {
      this.ready = false;
      this.session = null;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.ready && this.session) return true;
    const ai = getChromeAI();
    if (!ai?.languageModel) return false;
    try {
      const availability = await ai.languageModel.availability();
      return (
        availability === "readily" ||
        availability === "available" ||
        availability === "after-download"
      );
    } catch {
      return false;
    }
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
      // Some implementations return cumulative text
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
      detail: available ? "Gemini Nano available" : "Gemini Nano unavailable",
    };
  }

  async dispose(): Promise<void> {
    this.session?.destroy?.();
    this.session = null;
    this.ready = false;
  }

  private async ensureSession(): Promise<ChromeAISession> {
    if (!this.session) await this.initialize();
    if (!this.session) throw new Error("Gemini Nano is not available");
    return this.session;
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
