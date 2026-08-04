import { useMemo, useState } from "react";
import { providerBadge } from "../../shared/ai/providerLabel";
import { MessageType, sendMessage } from "../../shared/messaging/protocol";
import type { AIResponseEnvelope, Highlight } from "../../shared/types";

const PAGE_SIZE = 10;

function formatSavedAt(timestamp: number): string {
  const d = new Date(timestamp);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} · ${time}`;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function faviconSrc(url: string): string | null {
  const host = domainFromUrl(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`;
}

function Favicon({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconSrc(url);
  const label = (domainFromUrl(url) || title || "?").charAt(0).toUpperCase();

  if (!src || failed) {
    return (
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-slate-300/80 text-[9px] font-bold text-slate-600 dark:bg-slate-600 dark:text-slate-200"
        aria-hidden
      >
        {label}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 shrink-0 rounded-sm"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function HighlightsView(props: {
  highlights: Highlight[];
  search: string;
  onSearch: (q: string) => void;
  onDelete: (id: string) => Promise<void>;
  onSummarizeAll: () => void;
  aiBusy: boolean;
  setStatus: (s: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [cardSummaries, setCardSummaries] = useState<
    Record<string, { text: string; badge: string }>
  >({});
  const pages = Math.max(1, Math.ceil(props.highlights.length / PAGE_SIZE));
  const slice = useMemo(() => {
    const start = page * PAGE_SIZE;
    return props.highlights.slice(start, start + PAGE_SIZE);
  }, [props.highlights, page]);

  async function summarizeOne(h: Highlight) {
    setSummarizingId(h.id);
    props.setStatus("Summarizing highlight…");
    try {
      const envelope = await sendMessage<AIResponseEnvelope>({
        type: MessageType.AI_GENERATE,
        action: "summarize",
        text: h.text,
        pageTitle: h.title,
        url: h.url,
      });
      const badge = `${providerBadge(envelope.provider, {
        cached: envelope.cached,
      })} · ${envelope.latencyMs}ms`;
      setCardSummaries((prev) => ({
        ...prev,
        [h.id]: { text: envelope.text, badge },
      }));
      props.setStatus(`${badge}\n\n${envelope.text}`);
    } catch (e) {
      props.setStatus(e instanceof Error ? e.message : "AI failed");
    } finally {
      setSummarizingId(null);
    }
  }

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
          No highlights yet. Select text on any page and tap Save Highlight.
        </p>
      ) : (
        <ul className="space-y-2">
          {slice.map((h) => {
            const summary = cardSummaries[h.id];
            const busy = summarizingId === h.id;
            return (
              <li key={h.id} className="glass rounded-xl p-3">
                <p className="text-sm leading-relaxed">{h.text}</p>

                <div className="mt-2 flex items-start gap-2 text-xs text-[var(--aka-muted)]">
                  <Favicon url={h.url} title={h.title} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sky-accent hover:underline"
                      title={h.url}
                    >
                      {h.title || domainFromUrl(h.url) || h.url}
                    </a>
                    <p className="mt-0.5 tabular-nums">
                      {formatSavedAt(h.timestamp)}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy || props.aiBusy}
                    className="rounded-md bg-sky-accent/90 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    onClick={() => void summarizeOne(h)}
                  >
                    {busy ? "Summarizing…" : "AI Summary"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-rose-500/90 px-2 py-1 text-xs font-semibold text-white"
                    onClick={() => void props.onDelete(h.id)}
                  >
                    Delete
                  </button>
                </div>

                {summary && (
                  <div className="mt-2 rounded-lg border border-slate-300/40 bg-white/50 p-2.5 dark:bg-slate-900/40">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-accent">
                        AI Summary
                      </p>
                      <button
                        type="button"
                        className="text-[10px] text-[var(--aka-muted)] underline"
                        onClick={() =>
                          setCardSummaries((prev) => {
                            const next = { ...prev };
                            delete next[h.id];
                            return next;
                          })
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="mb-1 text-[10px] text-[var(--aka-muted)]">
                      {summary.badge}
                    </p>
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
                      {summary.text}
                    </pre>
                  </div>
                )}
              </li>
            );
          })}
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
