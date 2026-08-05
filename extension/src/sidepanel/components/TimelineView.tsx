import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import type { AITimelineEvent, PersonalizationProfile } from "../../shared/types";

const PAGE_SIZE = 10;

export function TimelineView(props: {
  timeline: AITimelineEvent[];
  profile: PersonalizationProfile | null;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!search.trim()) return props.timeline;
    const q = search.toLowerCase().trim();
    return props.timeline.filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        e.preview.toLowerCase().includes(q)
    );
  }, [props.timeline, search]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  return (
    <section className="space-y-3">
      {props.profile && (
        <div className="glass rounded-xl p-3 text-sm">
          <h3 className="font-display font-semibold">Personalization</h3>
          <p className="mt-1 text-xs aka-muted">
            Tone {props.profile.tone} · Style {props.profile.summaryStyle} ·
            Accepted {props.profile.acceptedActions} · Rejected{" "}
            {props.profile.rejectedActions}
          </p>
          <p className="mt-1 text-[11px] aka-muted">
            Settings → AI style sets tone/format. Accept/Reject on summaries
            updates interest counts without overriding your style choice.
          </p>
          {props.profile.interests.length > 0 && (
            <p className="mt-2 text-xs">
              Interests: {props.profile.interests.slice(0, 12).join(", ")}
            </p>
          )}
        </div>
      )}

      <input
        className="glass aka-input w-full rounded-xl px-3 py-2 text-sm outline-none"
        placeholder="Search timeline events…"
        value={search}
        onChange={(e) => {
          setPage(0);
          setSearch(e.target.value);
        }}
      />

      {slice.length === 0 ? (
        <p className="glass rounded-xl p-4 text-sm aka-muted">
          {search.trim()
            ? "No timeline events match your search."
            : "AI timeline is empty. Run a summary to start learning history."}
        </p>
      ) : (
        <ul className="space-y-2">
          {slice.map((e) => (
            <li key={e.id} className="glass rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between gap-2 text-xs aka-muted">
                <span className="font-semibold uppercase tracking-wide aka-link">
                  {e.action}
                </span>
                <span>
                  {e.latencyMs}ms · {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <Streamdown parseIncompleteMarkdown={true} className="mt-2 text-xs leading-relaxed line-clamp-4">
                {e.preview}
              </Streamdown>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="aka-chip rounded-lg px-3 py-1 disabled:opacity-40"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <span>
            {safePage + 1} / {pages}
            <span className="ml-1 aka-muted">
              ({filtered.length})
            </span>
          </span>
          <button
            type="button"
            className="aka-chip rounded-lg px-3 py-1 disabled:opacity-40"
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
