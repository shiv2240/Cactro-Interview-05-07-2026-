import { useState } from "react";
import { providerBadge } from "../../shared/ai/providerLabel";
import { MessageType, sendMessage } from "../../shared/messaging/protocol";
import type { AIResponseEnvelope, Note } from "../../shared/types";

export function NotesView(props: {
  notes: Note[];
  search: string;
  onSearch: (q: string) => void;
  onRefresh: () => void;
  setStatus: (s: string) => void;
}) {
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [pinned, setPinned] = useState(false);
  const [favorite, setFavorite] = useState(false);

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

  async function runAI(action: "summarize" | "rewrite" | "flashcards") {
    if (!body.trim()) {
      props.setStatus("Write a note first");
      return;
    }
    props.setStatus("Running AI…");
    try {
      const envelope = await sendMessage<AIResponseEnvelope>({
        type: MessageType.AI_GENERATE,
        action,
        text: body,
      });
      if (action === "rewrite") {
        setBody(envelope.text);
      }
      props.setStatus(
        `${providerBadge(envelope.provider, { cached: envelope.cached })} · ${envelope.latencyMs}ms\n\n${envelope.text}`
      );
      await sendMessage({
        type: MessageType.PERSONALIZATION_FEEDBACK,
        accepted: true,
        action,
        textPreview: envelope.text.slice(0, 200),
      });
    } catch (e) {
      props.setStatus(e instanceof Error ? e.message : "AI failed");
    }
  }

  return (
    <section className="space-y-3">
      <input
        className="glass w-full rounded-xl px-3 py-2 text-sm outline-none"
        placeholder="Search notes…"
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
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
      </div>

      <ul className="space-y-2">
        {props.notes.map((n) => (
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
    </section>
  );
}
