import { getGroqApiKey } from "../swConfig";
import type { AIProvider, GenerateOptions, StreamChunk } from "../types";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
/** Fastest interactive model used in legacy popup/content paths — prefer over 70B. */
export const GROQ_FAST_MODEL = "llama-3.1-8b-instant";
export const GROQ_REQUEST_TIMEOUT_MS = 8_000;

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** Groq cloud — primary for interactive summarize. SW-only. */
export class GroqProvider implements AIProvider {
  readonly id = "groq" as const;
  private initialized = false;
  private keyCache: string | null | undefined;

  async initialize(): Promise<void> {
    this.initialized = true;
    // Prefetch key so first generate/stream doesn't wait on storage.
    void this.resolveKey();
  }

  private async resolveKey(): Promise<string | null> {
    if (this.keyCache !== undefined) return this.keyCache;
    const key = await getGroqApiKey();
    this.keyCache = key || null;
    return this.keyCache;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(await this.resolveKey());
  }

  /**
   * Tiny non-blocking warm ping — opens TLS / keeps connection hot.
   * Aborts after a short budget so it never blocks UI.
   */
  async warmup(): Promise<void> {
    const key = await this.resolveKey();
    if (!key) return;
    const { signal, cleanup } = withTimeout(undefined, 2_500);
    try {
      await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model: GROQ_FAST_MODEL,
          temperature: 0,
          max_tokens: 1,
          messages: [{ role: "user", content: "ok" }],
        }),
      });
    } catch {
      /* warm ping is best-effort */
    } finally {
      cleanup();
    }
  }

  async generate(options: GenerateOptions): Promise<string> {
    const key = await this.resolveKey();
    if (!key) throw new Error("Groq API key not configured");

    const timeoutMs = options.timeoutMs ?? GROQ_REQUEST_TIMEOUT_MS;
    const { signal, cleanup } = withTimeout(options.signal, timeoutMs);
    const t0 = Date.now();
    try {
      const resp = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model: GROQ_FAST_MODEL,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 400,
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
      console.log(
        `[AI latency] groq generate network=${Date.now() - t0}ms model=${GROQ_FAST_MODEL}`
      );
      return data.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (e) {
      if (signal.aborted) {
        throw new Error(`Groq timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      cleanup();
    }
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const key = await this.resolveKey();
    if (!key) throw new Error("Groq API key not configured");

    const timeoutMs = options.timeoutMs ?? GROQ_REQUEST_TIMEOUT_MS;
    const { signal, cleanup } = withTimeout(options.signal, timeoutMs);
    const t0 = Date.now();
    let ttftMs: number | null = null;

    try {
      const resp = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model: GROQ_FAST_MODEL,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 400,
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
        throw new Error(
          `Groq stream error ${resp.status}: ${errText.slice(0, 200)}`
        );
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
            console.log(
              `[AI latency] groq stream ttft=${ttftMs ?? "-"}ms total=${Date.now() - t0}ms model=${GROQ_FAST_MODEL}`
            );
            yield { text: "", done: true };
            return;
          }
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              if (ttftMs === null) ttftMs = Date.now() - t0;
              yield { text: delta, done: false };
            }
          } catch {
            /* skip malformed chunk */
          }
        }
      }
      console.log(
        `[AI latency] groq stream ttft=${ttftMs ?? "-"}ms total=${Date.now() - t0}ms model=${GROQ_FAST_MODEL}`
      );
      yield { text: "", done: true };
    } catch (e) {
      if (signal.aborted) {
        throw new Error(`Groq timed out after ${timeoutMs}ms`);
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
      detail: available
        ? this.initialized
          ? `Groq ready (${GROQ_FAST_MODEL})`
          : "Groq key present"
        : "Groq API key missing",
    };
  }

  async dispose(): Promise<void> {
    this.initialized = false;
    this.keyCache = undefined;
  }
}
