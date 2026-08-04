import { getGroqApiKey } from "../swConfig";
import type { AIProvider, GenerateOptions, StreamChunk } from "../types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

/** Groq cloud fallback — only callable from the service worker. */
export class GroqProvider implements AIProvider {
  readonly id = "groq" as const;
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async isAvailable(): Promise<boolean> {
    const key = await getGroqApiKey();
    return Boolean(key);
  }

  async generate(options: GenerateOptions): Promise<string> {
    const key = await getGroqApiKey();
    if (!key) throw new Error("Groq API key not configured");

    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: options.signal,
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 2048,
        messages: [
          ...(options.system
            ? [{ role: "system", content: options.system }]
            : []),
          { role: "user", content: options.prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Groq error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const key = await getGroqApiKey();
    if (!key) throw new Error("Groq API key not configured");

    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: options.signal,
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
        messages: [
          ...(options.system
            ? [{ role: "system", content: options.system }]
            : []),
          { role: "user", content: options.prompt },
        ],
      }),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Groq stream error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          yield { text: "", done: true };
          return;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield { text: delta, done: false };
        } catch {
          /* skip malformed chunk */
        }
      }
    }
    yield { text: "", done: true };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const available = await this.isAvailable();
    return {
      ok: available,
      detail: available
        ? this.initialized
          ? "Groq ready"
          : "Groq key present"
        : "Groq API key missing",
    };
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }
}
