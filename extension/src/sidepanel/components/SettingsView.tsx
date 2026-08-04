import type { FeaturePrefs, UserPrefs } from "../../shared/types";

export function SettingsView(props: {
  prefs: UserPrefs;
  auth: { authenticated: boolean; email: string | null };
  onUpdate: (partial: Partial<UserPrefs>) => void;
  onSync: () => Promise<void>;
}) {
  const f = props.prefs.featurePrefs;

  function toggleFeature(key: keyof FeaturePrefs) {
    props.onUpdate({
      featurePrefs: { ...f, [key]: !f[key] },
    });
  }

  return (
    <section className="glass space-y-4 rounded-xl p-3 text-sm">
      <div>
        <h3 className="font-display font-semibold">AI</h3>
        <p className="mt-1 text-xs text-[var(--aka-muted)]">
          Multi-model AI with a fast primary and an automatic backup if that
          model fails — no setup or API keys required.
        </p>
        {/*
          Power-user / debug: Nano health probe, chrome://flags instructions,
          and optional Groq gsk_ override were removed from the end-user UI.
          Internal AIService routes Groq first, then on-device Nano on failure.
        */}
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
          Auth always uses Convex. AI timeline and vectors stay local.
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
    </section>
  );
}
