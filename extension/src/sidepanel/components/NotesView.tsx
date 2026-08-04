import { useMemo, useState } from "react";
import { aiMetaLine } from "../../shared/ai/providerLabel";
import {
  MessageType,
  sendMessage,
  streamAIRequest,
} from "../../shared/messaging/protocol";
import type { AIAction, Note } from "../../shared/types";

const PAGE_SIZE = 10;

type PendingAI = {
  action: Extract<AIAction, "summarize" | "rewrite" | "flashcards">;
  text: string;
  meta?: string;
  voted: boolean;
};

export function NotesView(props: {
  notes: Note[];
  search: string;
  onSearch: (q: string) => void;
  onRefresh: () => void;
  setStatus: (s: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [pinned, setPinned] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [pendingAI, setPendingAI] = useState<PendingAI | null>(null);

  // Search in App filters the full list; paginate that filtered result set.
  const pages = Math.max(1, Math.ceil(props.notes.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return props.notes.slice(start, start + PAGE_SIZE);
  }, [props.notes, safePage]);

  function startNew() {
    setEditing(null);
    setTitle("");
    setBody("");
    setTags("");
    setPinned(false);
    setFavorite(false);
  }

  function startEdit(n: Note) {
    setEditing(n);
    setTitle(n.title);
    setBody(n.body);
    setTags(n.tags.join(", "));
    setPinned(n.pinned);
    setFavorite(n.favorite);
  }

  async function save() {
    await sendMessage({
      type: MessageType.NOTE_UPSERT,
      note: {
        id: editing?.id,
        title,
        body,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        pinned,
        favorite,
      },
    });
    startNew();
    props.onRefresh();
  }

  function runAI(action: "summarize" | "rewrite" | "flashcards") {
    if (!body.trim()) {
      props.setStatus("Write a note first");
      return;
    }
    props.setStatus("Running AI…");
    setPendingAI({ action, text: "", meta: "Streaming…", voted: false });
    streamAIRequest(
      { action, text: body },
      {
        onChunk: (chunk) => {
          setPendingAI((prev) => ({
            action,
            text: (prev?.text ?? "") + chunk,
            meta: "Streaming…",
            voted: false,
          }));
        },
        onDone: (envelope) => {
          const meta = envelope
            ? aiMetaLine(envelope.latencyMs, { cached: envelope.cached })
            : undefined;
          setPendingAI((prev) => {
            const text = envelope?.text || prev?.text || "";
            return {
              action,
              text,
              meta: meta || undefined,
              voted: false,
            };
          });
          if (action === "rewrite") {
            const text = envelope?.text;
            if (text) setBody(text);
          }
          props.setStatus("");
        },
        onError: (error) => {
          props.setStatus(error);
        },
      }
    );
  }

  async function vote(accepted: boolean) {
    if (!pendingAI || pendingAI.voted) return;
    try {
      await sendMessage({
        type: MessageType.PERSONALIZATION_FEEDBACK,
        accepted,
        action: pendingAI.action,
        textPreview: pendingAI.text.slice(0, 200),
      });
      setPendingAI({ ...pendingAI, voted: true });
      props.setStatus(
        accepted ? "Accepted — personalization updated" : "Rejected — preference noted"
      );
      props.onRefresh();
    } catch (e) {
      props.setStatus(e instanceof Error ? e.message : "Feedback failed");
    }
  }

  return (
    <section className="space-y-3">
      <input
        className="glass w-full rounded-xl px-3 py-2 text-sm outline-none"
        placeholder="Search notes…"
        value={props.search}
        onChange={(e) => {
          setPage(0);
          props.onSearch(e.target.value);
        }}
      />

      <div className="glass space-y-2 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">
            {editing ? "Edit note" : "New note"}
          </h3>
          {editing && (
            <button type="button" className="text-xs underline" onClick={startNew}>
              Clear
            </button>
          )}
        </div>
        <input
          className="w-full rounded-lg border border-slate-300/50 bg-white/50 px-2 py-1.5 text-sm dark:bg-slate-900/40"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="min-h-[140px] w-full rounded-lg border border-slate-300/50 bg-white/50 px-2 py-1.5 font-mono text-xs leading-relaxed dark:bg-slate-900/40"
          placeholder="Markdown body…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-slate-300/50 bg-white/50 px-2 py-1.5 text-sm dark:bg-slate-900/40"
          placeholder="Tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            Pin
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            Favorite
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-lg bg-sky-accent px-3 py-1.5 text-sm font-semibold text-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void runAI("summarize")}
            className="rounded-lg bg-white/70 px-3 py-1.5 text-sm font-semibold"
          >
            Summarize
          </button>
          <button
            type="button"
            onClick={() => void runAI("rewrite")}
            className="rounded-lg bg-white/70 px-3 py-1.5 text-sm font-semibold"
          >
            Rewrite
          </button>
          <button
            type="button"
            onClick={() => void runAI("flashcards")}
            className="rounded-lg bg-white/70 px-3 py-1.5 text-sm font-semibold"
          >
            Flashcards
          </button>
        </div>

        {pendingAI && (
          <div className="mt-2 rounded-lg border border-slate-300/40 bg-white/50 p-2.5 dark:bg-slate-900/40">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-accent">
                AI · {pendingAI.action}
              </p>
              {pendingAI.meta ? (
                <span className="text-[10px] text-[var(--aka-muted)]">
                  {pendingAI.meta}
                </span>
              ) : null}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
              {pendingAI.text}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              {pendingAI.voted ? (
                <span className="text-[11px] text-[var(--aka-muted)]">
                  Feedback saved
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white"
                    onClick={() => void vote(true)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-slate-500/90 px-2 py-1 text-xs font-semibold text-white"
                    onClick={() => void vote(false)}
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {slice.length === 0 ? (
        <p className="glass rounded-xl p-4 text-sm text-[var(--aka-muted)]">
          {props.search.trim()
            ? "No notes match your search."
            : "No notes yet. Create one above."}
        </p>
      ) : (
        <ul className="space-y-2">
          {slice.map((n) => (
            <li key={n.id} className="glass rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {n.pinned ? "📌 " : ""}
                    {n.favorite ? "★ " : ""}
                    {n.title}
                  </p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-[var(--aka-muted)]">
                    {n.body}
                  </p>
                  {n.tags.length > 0 && (
                    <p className="mt-1 text-[11px] text-sky-accent">
                      {n.tags.join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold dark:bg-slate-700"
                    onClick={() => startEdit(n)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-rose-500/90 px-2 py-1 text-xs font-semibold text-white"
                    onClick={async () => {
                      await sendMessage({ type: MessageType.NOTE_DELETE, id: n.id });
                      props.onRefresh();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="rounded-lg bg-white/60 px-3 py-1 disabled:opacity-40"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <span>
            {safePage + 1} / {pages}
            <span className="ml-1 text-[var(--aka-muted)]">
              ({props.notes.length})
            </span>
          </span>
          <button
            type="button"
            className="rounded-lg bg-white/60 px-3 py-1 disabled:opacity-40"
            disabled={safePage >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
