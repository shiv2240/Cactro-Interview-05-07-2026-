import { useEffect, useMemo, useState, useTransition } from "react";
import { aiMetaLine } from "../shared/ai/providerLabel";
import {
  MessageType,
  sendMessage,
  streamAIRequest,
} from "../shared/messaging/protocol";
import type {
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
  const [pendingBatchAI, setPendingBatchAI] = useState<{
    text: string;
    meta?: string;
    voted: boolean;
  } | null>(null);
  const [, startTransition] = useTransition();

  const theme = useMemo(() => resolveTheme(prefs.theme), [prefs.theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (prefs.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = mq.matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [prefs.theme]);

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
    // Warm Groq TLS/connection — non-blocking.
    void sendMessage({ type: MessageType.AI_WARMUP }).catch(() => undefined);
  }, []);

  // Live refresh when SW/content mutates IDB (save/delete/sync) while panel is open.
  useEffect(() => {
    const onMessage = (msg: unknown) => {
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;
      const type = (msg as { type: string }).type;
      if (
        type === MessageType.HIGHLIGHTS_CHANGED ||
        type === MessageType.NOTES_CHANGED
      ) {
        void refresh().catch(() => undefined);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
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
    setPendingBatchAI({ text: "", meta: "Streaming…", voted: false });
    const text = highlights
      .slice(0, 40)
      .map((h) => `- (${h.title}) ${h.text}`)
      .join("\n");
    streamAIRequest(
      { action: "highlights_summary", text },
      {
        onChunk: (chunk) => {
          setPendingBatchAI((prev) => ({
            text: (prev?.text ?? "") + chunk,
            meta: "Streaming…",
            voted: false,
          }));
        },
        onDone: (envelope) => {
          const meta = envelope
            ? aiMetaLine(envelope.latencyMs, { cached: envelope.cached })
            : undefined;
          setPendingBatchAI((prev) => ({
            text: envelope?.text ?? prev?.text ?? "",
            meta: meta || undefined,
            voted: false,
          }));
          setStatus("");
          setAiBusy(false);
          void refresh();
        },
        onError: (error) => {
          setStatus(error);
          setAiBusy(false);
        },
      }
    );
  }

  async function voteBatchAI(accepted: boolean) {
    if (!pendingBatchAI || pendingBatchAI.voted) return;
    try {
      await sendMessage({
        type: MessageType.PERSONALIZATION_FEEDBACK,
        accepted,
        action: "highlights_summary",
        textPreview: pendingBatchAI.text.slice(0, 200),
      });
      setPendingBatchAI({ ...pendingBatchAI, voted: true });
      setStatus(
        accepted ? "Accepted — personalization updated" : "Rejected — preference noted"
      );
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Feedback failed");
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
            <p className="text-sm aka-muted">
              Local-first highlights, notes, and AI
            </p>
          </div>
          <select
            className="aka-input rounded-lg px-2 py-1 text-sm"
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
                  : "aka-chip hover:opacity-95"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {!auth.authenticated && (
          <div className="mb-3 space-y-2">
            <p className="px-1 text-xs aka-muted">
              Sign in to sync highlights &amp; notes to Convex (Sync / Cloud AI
              modes). Local saves always work offline.
            </p>
            <AuthPanel
              auth={auth}
              onAuthChange={() => void refresh()}
              setStatus={setStatus}
            />
          </div>
        )}

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
            setStatus={setStatus}
            onRefresh={() => void refresh()}
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
            {auth.authenticated && (
              <AuthPanel
                auth={auth}
                onAuthChange={() => void refresh()}
                setStatus={setStatus}
              />
            )}
            <SettingsView
              prefs={prefs}
              auth={auth}
              onUpdate={(p) => void updatePrefs(p)}
              onSync={async () => {
                const result = await sendMessage<{
                  pushed: number;
                  pulled: boolean;
                  errors: string[];
                }>({ type: MessageType.SYNC_NOW });
                setStatus(
                  `Synced · pushed ${result.pushed}` +
                    (result.pulled ? " · pulled" : "") +
                    (result.errors.length
                      ? ` · ${result.errors[0]}`
                      : "")
                );
                await refresh();
              }}
            />
          </div>
        )}

        {pendingBatchAI && (
          <div className="glass mt-3 rounded-xl p-3 text-xs leading-relaxed">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-accent">
                AI Summary · all highlights
              </p>
              {pendingBatchAI.meta ? (
                <span className="text-[10px] aka-muted">
                  {pendingBatchAI.meta}
                </span>
              ) : null}
            </div>
            <pre className="whitespace-pre-wrap font-sans">{pendingBatchAI.text}</pre>
            <div className="mt-2 flex flex-wrap gap-2">
              {pendingBatchAI.voted ? (
                <span className="text-[11px] aka-muted">
                  Feedback saved
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white"
                    onClick={() => void voteBatchAI(true)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-slate-500/90 px-2 py-1 text-xs font-semibold text-white"
                    onClick={() => void voteBatchAI(false)}
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
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
