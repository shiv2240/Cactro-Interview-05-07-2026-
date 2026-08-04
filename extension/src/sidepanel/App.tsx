import { useEffect, useMemo, useState, useTransition } from "react";
import { MessageType, sendMessage } from "../shared/messaging/protocol";
import type {
  AIResponseEnvelope,
  AITimelineEvent,
  Highlight,
  Note,
  PersonalizationProfile,
  UserPrefs,
  WorkspaceId,
} from "../shared/types";
import { DEFAULT_PREFS, WORKSPACES } from "../shared/types";
import { AuthPanel } from "./components/AuthPanel";
import { HighlightsView } from "./components/HighlightsView";
import { NotesView } from "./components/NotesView";
import { SettingsView } from "./components/SettingsView";
import { TimelineView } from "./components/TimelineView";

type Tab = "highlights" | "notes" | "timeline" | "settings";

function resolveTheme(pref: UserPrefs["theme"]): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return pref;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("highlights");
  const [prefs, setPrefsState] = useState<UserPrefs>(DEFAULT_PREFS);
  const [auth, setAuth] = useState<{ authenticated: boolean; email: string | null }>({
    authenticated: false,
    email: null,
  });
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [timeline, setTimeline] = useState<AITimelineEvent[]>([]);
  const [profile, setProfile] = useState<PersonalizationProfile | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const [, startTransition] = useTransition();

  const theme = useMemo(() => resolveTheme(prefs.theme), [prefs.theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  async function refresh() {
    const [p, a, h, n, t, prof] = await Promise.all([
      sendMessage<UserPrefs>({ type: MessageType.PREFS_GET }),
      sendMessage<{ authenticated: boolean; email: string | null }>({
        type: MessageType.AUTH_STATUS,
      }),
      sendMessage<Highlight[]>({ type: MessageType.LIST_HIGHLIGHTS }),
      sendMessage<Note[]>({ type: MessageType.NOTE_LIST }),
      sendMessage<AITimelineEvent[]>({ type: MessageType.TIMELINE_LIST, limit: 40 }),
      sendMessage<PersonalizationProfile>({ type: MessageType.PERSONALIZATION_GET }),
    ]);
    startTransition(() => {
      setPrefsState(p);
      setAuth(a);
      setHighlights(h);
      setNotes(n);
      setTimeline(t);
      setProfile(prof);
    });
  }

  useEffect(() => {
    void refresh().catch((e) =>
      setStatus(e instanceof Error ? e.message : "Failed to load")
    );
  }, []);

  async function onSearch(q: string) {
    setSearch(q);
    if (!q.trim()) {
      const [h, n] = await Promise.all([
        sendMessage<Highlight[]>({ type: MessageType.LIST_HIGHLIGHTS }),
        sendMessage<Note[]>({ type: MessageType.NOTE_LIST }),
      ]);
      setHighlights(h);
      setNotes(n);
      return;
    }
    if (tab === "notes") {
      setNotes(
        await sendMessage<Note[]>({ type: MessageType.NOTE_SEARCH, query: q })
      );
    } else {
      setHighlights(
        await sendMessage<Highlight[]>({
          type: MessageType.SEARCH_HIGHLIGHTS,
          query: q,
        })
      );
    }
  }

  async function updatePrefs(partial: Partial<UserPrefs>) {
    const next = await sendMessage<UserPrefs>({
      type: MessageType.PREFS_SET,
      prefs: partial,
    });
    setPrefsState(next);
  }

  async function setWorkspace(workspaceId: WorkspaceId) {
    await sendMessage({ type: MessageType.SET_WORKSPACE, workspaceId });
    await refresh();
  }

  async function summarizeAll() {
    if (!highlights.length) {
      setStatus("No highlights to summarize");
      return;
    }
    setAiBusy(true);
    setStatus("Summarizing highlights…");
    try {
      const text = highlights
        .slice(0, 40)
        .map((h) => `- (${h.title}) ${h.text}`)
        .join("\n");
      const envelope = await sendMessage<AIResponseEnvelope>({
        type: MessageType.AI_GENERATE,
        action: "highlights_summary",
        text,
      });
      setStatus(
        `${envelope.provider} · ${envelope.latencyMs}ms\n\n${envelope.text}`
      );
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "AI failed");
    } finally {
      setAiBusy(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "highlights", label: "Highlights" },
    { id: "notes", label: "Notes" },
    { id: "timeline", label: "Timeline" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="flex h-full flex-col animate-fade-up">
      <header className="glass mx-3 mt-3 rounded-2xl px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl font-bold tracking-tight">
              AI Knowledge Assistant
            </p>
            <p className="text-sm text-[var(--aka-muted)]">
              Local-first highlights, notes, and AI
            </p>
          </div>
          <select
            className="rounded-lg border border-slate-300/60 bg-white/70 px-2 py-1 text-sm dark:bg-slate-800"
            value={prefs.workspaceId}
            onChange={(e) => void setWorkspace(e.target.value as WorkspaceId)}
            aria-label="Workspace"
          >
            {WORKSPACES.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
        <nav className="mt-3 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                tab === t.id
                  ? "bg-sky-accent text-white"
                  : "bg-white/50 text-ink hover:bg-white/80 dark:bg-slate-800/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {!auth.authenticated && tab === "settings" ? null : null}

        {tab === "highlights" && (
          <HighlightsView
            highlights={highlights}
            search={search}
            onSearch={(q) => void onSearch(q)}
            onDelete={async (id) => {
              await sendMessage({ type: MessageType.DELETE_HIGHLIGHT, id });
              await refresh();
            }}
            onSummarizeAll={() => void summarizeAll()}
            aiBusy={aiBusy}
          />
        )}

        {tab === "notes" && (
          <NotesView
            notes={notes}
            search={search}
            onSearch={(q) => void onSearch(q)}
            onRefresh={() => void refresh()}
            setStatus={setStatus}
          />
        )}

        {tab === "timeline" && (
          <TimelineView timeline={timeline} profile={profile} />
        )}

        {tab === "settings" && (
          <div className="space-y-3">
            <AuthPanel
              auth={auth}
              onAuthChange={() => void refresh()}
              setStatus={setStatus}
            />
            <SettingsView
              prefs={prefs}
              onUpdate={(p) => void updatePrefs(p)}
              onSync={async () => {
                const result = await sendMessage<{
                  pushed: number;
                  pulled: boolean;
                  errors: string[];
                }>({ type: MessageType.SYNC_NOW });
                setStatus(
                  `Synced · pushed ${result.pushed}` +
                    (result.errors.length
                      ? ` · ${result.errors[0]}`
                      : "")
                );
                await refresh();
              }}
            />
          </div>
        )}

        {status && (
          <pre className="glass mt-3 whitespace-pre-wrap rounded-xl p-3 text-xs leading-relaxed">
            {status}
          </pre>
        )}
      </main>
    </div>
  );
}
