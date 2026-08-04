import { useMemo, useState } from "react";
import type { Highlight } from "../../shared/types";

const PAGE_SIZE = 10;

export function HighlightsView(props: {
  highlights: Highlight[];
  search: string;
  onSearch: (q: string) => void;
  onDelete: (id: string) => Promise<void>;
  onSummarizeAll: () => void;
  aiBusy: boolean;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(props.highlights.length / PAGE_SIZE));
  const slice = useMemo(() => {
    const start = page * PAGE_SIZE;
    return props.highlights.slice(start, start + PAGE_SIZE);
  }, [props.highlights, page]);

  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        <input
          className="glass w-full rounded-xl px-3 py-2 text-sm outline-none"
          placeholder="Search highlights…"
          value={props.search}
          onChange={(e) => {
            setPage(0);
            props.onSearch(e.target.value);
          }}
        />
        <button
          type="button"
          disabled={props.aiBusy}
          onClick={props.onSummarizeAll}
          className="shrink-0 rounded-xl bg-sky-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {props.aiBusy ? "…" : "AI Summary"}
        </button>
      </div>

      {slice.length === 0 ? (
        <p className="glass rounded-xl p-4 text-sm text-[var(--aka-muted)]">
          No highlights yet. Select text on any page and tap Save.
        </p>
      ) : (
        <ul className="space-y-2">
          {slice.map((h) => (
            <li key={h.id} className="glass rounded-xl p-3">
              <p className="text-sm leading-relaxed">{h.text}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--aka-muted)]">
                <a
                  href={h.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sky-accent hover:underline"
                >
                  {h.title || h.url}
                </a>
                <button
                  type="button"
                  className="rounded-md bg-rose-500/90 px-2 py-1 font-semibold text-white"
                  onClick={() => void props.onDelete(h.id)}
                >
                  Delete
                </button>
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
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            className="rounded-lg bg-white/60 px-3 py-1 disabled:opacity-40"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
