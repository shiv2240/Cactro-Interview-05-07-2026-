import { useState } from "react";
import type { FeaturePrefs, UserPrefs } from "../../shared/types";

export function SettingsView(props: {
  prefs: UserPrefs;
  onUpdate: (partial: Partial<UserPrefs>) => void;
  onSync: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const f = props.prefs.featurePrefs;

  function toggleFeature(key: keyof FeaturePrefs) {
    props.onUpdate({
      featurePrefs: { ...f, [key]: !f[key] },
    });
  }

  return (
    <section className="glass space-y-4 rounded-xl p-3 text-sm">
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
          Private = local only · Sync = notes/highlights to Convex · Cloud AI =
          sync + allow cloud AI memory prefs
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
          className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
          onClick={() => void props.onSync()}
        >
          Sync now
        </button>
      </div>

      <div>
        <h3 className="font-display font-semibold">Feature toggles</h3>
        <div className="mt-2 space-y-1">
          {(
            [
              ["keywordsTile", "Keywords tile"],
              ["stickyNotes", "Sticky notes button"],
              ["saveHighlight", "Save highlight"],
              ["aiSummary", "AI summary / explain"],
              ["summarizePage", "Summarize page"],
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
        <h3 className="font-display font-semibold">Groq API key</h3>
        <p className="mt-1 text-xs text-[var(--aka-muted)]">
          Stored in extension storage and used only by the service worker.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            className="w-full rounded-lg border border-slate-300/50 bg-white/50 px-2 py-1.5"
            placeholder="gsk_…"
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
