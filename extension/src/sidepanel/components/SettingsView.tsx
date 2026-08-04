import { useEffect, useState } from "react";
import { providerBadge } from "../../shared/ai/providerLabel";
import { MessageType, sendMessage } from "../../shared/messaging/protocol";
import type { FeaturePrefs, UserPrefs } from "../../shared/types";

type HealthRow = { provider: string; ok: boolean; detail?: string };

export function SettingsView(props: {
  prefs: UserPrefs;
  auth: { authenticated: boolean; email: string | null };
  onUpdate: (partial: Partial<UserPrefs>) => void;
  onSync: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [health, setHealth] = useState<HealthRow[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const f = props.prefs.featurePrefs;

  async function loadHealth(recheck = false) {
    setHealthBusy(true);
    try {
      const rows = await sendMessage<HealthRow[]>({
        type: MessageType.AI_HEALTH,
        recheck,
      });
      setHealth(rows);
    } catch (e) {
      setHealth([
        {
          provider: "gemini-nano",
          ok: false,
          detail: e instanceof Error ? e.message : "Health check failed",
        },
      ]);
    } finally {
      setHealthBusy(false);
    }
  }

  useEffect(() => {
    void loadHealth(false);
  }, []);

  function toggleFeature(key: keyof FeaturePrefs) {
    props.onUpdate({
      featurePrefs: { ...f, [key]: !f[key] },
    });
  }

  const nano = health?.find((h) => h.provider === "gemini-nano");
  const groq = health?.find((h) => h.provider === "groq");

  return (
    <section className="glass space-y-4 rounded-xl p-3 text-sm">
      <div>
        <h3 className="font-display font-semibold">AI providers</h3>
        <p className="mt-1 text-xs text-[var(--aka-muted)]">
          Order: Gemini Nano (on-device) → Groq (fallback). Responses never fake
          Nano — if Nano is unavailable, you will see Groq.
        </p>
        <div className="mt-2 space-y-2 rounded-lg bg-white/50 p-2 dark:bg-slate-900/40">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">
                Nano status:{" "}
                {nano == null
                  ? "Checking…"
                  : nano.ok
                    ? "Available"
                    : "Unavailable"}
              </p>
              <p className="mt-0.5 text-xs text-[var(--aka-muted)]">
                {nano?.detail ?? "Probing Prompt API in the service worker…"}
              </p>
            </div>
            <button
              type="button"
              disabled={healthBusy}
              className="shrink-0 rounded-lg bg-sky-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => void loadHealth(true)}
            >
              {healthBusy ? "Checking…" : "Recheck Nano"}
            </button>
          </div>
          {groq && (
            <p className="text-xs text-[var(--aka-muted)]">
              {providerBadge("groq", { fallback: false })}:{" "}
              {groq.ok ? "ready" : "unavailable"}
              {groq.detail ? ` — ${groq.detail}` : ""}
            </p>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--aka-muted)]">
          To enable Nano: Chrome 128+ (Canary/Dev best) →{" "}
          <code className="text-[10px]">chrome://flags/#prompt-api-for-gemini-nano</code>{" "}
          Enabled →{" "}
          <code className="text-[10px]">
            chrome://flags/#optimization-guide-on-device-model
          </code>{" "}
          Enabled BypassPerfRequirement → restart → wait for the model in{" "}
          <code className="text-[10px]">chrome://components</code>. Then Recheck
          Nano.
        </p>
      </div>

      <div>
        <h3 className="font-display font-semibold">Theme</h3>
        <div className="mt-2 flex gap-2">
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => props.onUpdate({ theme: t })}
              className={`rounded-lg px-3 py-1.5 capitalize ${
                props.prefs.theme === t
                  ? "bg-sky-accent text-white"
                  : "bg-white/60"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display font-semibold">Privacy mode</h3>
        <p className="mt-1 text-xs text-[var(--aka-muted)]">
          <strong>Private</strong> — IndexedDB only (no Convex data sync).{" "}
          <strong>Sync</strong> (default) — highlights &amp; notes push/pull via
          Convex when signed in. <strong>Cloud AI</strong> — same sync as Sync.
          Auth always uses Convex. AI timeline, vectors, and Groq keys stay
          local.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["private", "sync", "cloud_ai"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => props.onUpdate({ privacyMode: m })}
              className={`rounded-lg px-3 py-1.5 ${
                props.prefs.privacyMode === m
                  ? "bg-sky-accent text-white"
                  : "bg-white/60"
              }`}
            >
              {m === "cloud_ai" ? "Cloud AI" : m[0]!.toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!props.auth.authenticated || props.prefs.privacyMode === "private"}
          className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          onClick={() => void props.onSync()}
        >
          Sync now
        </button>
        {!props.auth.authenticated && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Sign in above to enable Convex sync.
          </p>
        )}
      </div>

      <div>
        <h3 className="font-display font-semibold">Feature toggles</h3>
        <div className="mt-2 space-y-1">
          {(
            [
              ["keywordsTile", "Keywords tile"],
              ["stickyNotes", "Sticky note keyword marks"],
              ["saveHighlight", "Save Highlight (tooltip)"],
              ["aiSummary", "AI Summary (tooltip)"],
              ["summarizePage", "Summarize Page (tooltip)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f[key]}
                onChange={() => toggleFeature(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display font-semibold">AI style</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["concise", "detailed", "bullets"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => props.onUpdate({ summaryStyle: s })}
              className={`rounded-lg px-3 py-1.5 capitalize ${
                props.prefs.summaryStyle === s
                  ? "bg-sky-accent text-white"
                  : "bg-white/60"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["neutral", "friendly", "professional"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => props.onUpdate({ tone: t })}
              className={`rounded-lg px-3 py-1.5 capitalize ${
                props.prefs.tone === t
                  ? "bg-sky-accent text-white"
                  : "bg-white/60"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display font-semibold">Groq override (optional)</h3>
        <p className="mt-1 text-xs text-[var(--aka-muted)]">
          AI uses Gemini Nano when available, then a developer-bundled Groq
          fallback in the service worker. End users do not need a key. Paste
          here only to override the build-time key (power users / debugging).
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            className="w-full rounded-lg border border-slate-300/50 bg-white/50 px-2 py-1.5"
            placeholder="Optional override gsk_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-sky-accent px-3 py-1.5 font-semibold text-white"
            onClick={() => {
              props.onUpdate({ groqApiKey: apiKey });
              setApiKey("");
            }}
          >
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
