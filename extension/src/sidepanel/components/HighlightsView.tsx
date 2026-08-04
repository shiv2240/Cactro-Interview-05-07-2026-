import { useMemo, useState } from "react";
import { aiMetaLine } from "../../shared/ai/providerLabel";
import {
  MessageType,
  sendMessage,
  streamAIRequest,
} from "../../shared/messaging/protocol";
import type { Highlight } from "../../shared/types";

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
        className="aka-chip flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold"
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
  onRefresh?: () => void;
}) {
  const [page, setPage] = useState(0);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [cardSummaries, setCardSummaries] = useState<
    Record<string, { text: string; meta?: string; voted: boolean }>
  >({});
  // Search in App filters the full list; paginate that filtered result set.
  const pages = Math.max(1, Math.ceil(props.highlights.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return props.highlights.slice(start, start + PAGE_SIZE);
  }, [props.highlights, safePage]);

  function summarizeOne(h: Highlight) {
    setSummarizingId(h.id);
    props.setStatus("Summarizing highlight…");
    setCardSummaries((prev) => ({
      ...prev,
      [h.id]: { text: "", meta: "Streaming…", voted: false },
    }));
    streamAIRequest(
      {
        action: "summarize",
        text: h.text,
        pageTitle: h.title,
        url: h.url,
      },
      {
        onChunk: (chunk) => {
          setCardSummaries((prev) => {
            const cur = prev[h.id];
            return {
              ...prev,
              [h.id]: {
                text: (cur?.text ?? "") + chunk,
                meta: "Streaming…",
                voted: false,
              },
            };
          });
        },
        onDone: (envelope) => {
          const meta = envelope
            ? aiMetaLine(envelope.latencyMs, { cached: envelope.cached })
            : undefined;
          setCardSummaries((prev) => {
            const cur = prev[h.id];
            return {
              ...prev,
              [h.id]: {
                text: envelope?.text ?? cur?.text ?? "",
                meta,
                voted: false,
              },
            };
          });
          props.setStatus("");
          setSummarizingId(null);
        },
        onError: (error) => {
          props.setStatus(error);
          setSummarizingId(null);
        },
      }
    );
  }

  async function voteSummary(h: Highlight, accepted: boolean) {
    const summary = cardSummaries[h.id];
    if (!summary || summary.voted) return;
    try {
      await sendMessage({
        type: MessageType.PERSONALIZATION_FEEDBACK,
        accepted,
        action: "summarize",
        textPreview: summary.text.slice(0, 200),
      });
      setCardSummaries((prev) => ({
        ...prev,
        [h.id]: { ...summary, voted: true },
      }));
      props.setStatus(
        accepted ? "Accepted — personalization updated" : "Rejected — preference noted"
      );
      props.onRefresh?.();
    } catch (e) {
      props.setStatus(e instanceof Error ? e.message : "Feedback failed");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        <input
          className="glass aka-input w-full rounded-xl px-3 py-2 text-sm outline-none"
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
        <p className="glass rounded-xl p-4 text-sm aka-muted">
          {props.search.trim()
            ? "No highlights match your search."
            : "No highlights yet. Select text on any page and tap Save Highlight."}
        </p>
      ) : (
        <ul className="space-y-2">
          {slice.map((h) => {
            const summary = cardSummaries[h.id];
            const busy = summarizingId === h.id;
            return (
              <li key={h.id} className="glass rounded-xl p-3">
                <p className="text-sm leading-relaxed">{h.text}</p>

                <div className="mt-2 flex items-start gap-2 text-xs aka-muted">
                  <Favicon url={h.url} title={h.title} />
                  <div className="min-w-0 flex-1">
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="aka-link block truncate hover:underline"
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
                  <div className="aka-input mt-2 rounded-lg p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide aka-link">
                        AI Summary
                      </p>
                      <button
                        type="button"
                        className="aka-close-x"
                        aria-label="Close"
                        title="Close"
                        onClick={() =>
                          setCardSummaries((prev) => {
                            const next = { ...prev };
                            delete next[h.id];
                            return next;
                          })
                        }
                      >
                        &times;
                      </button>
                    </div>
                    {summary.meta ? (
                      <p className="mb-1 text-[10px] aka-muted">
                        {summary.meta}
                      </p>
                    ) : null}
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
                      {summary.text}
                    </pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {summary.voted ? (
                        <span className="text-[11px] aka-muted">
                          Feedback saved
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white"
                            onClick={() => void voteSummary(h, true)}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-slate-500/90 px-2 py-1 text-xs font-semibold text-white"
                            onClick={() => void voteSummary(h, false)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
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
            className="aka-chip rounded-lg px-3 py-1 disabled:opacity-40"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <span>
            {safePage + 1} / {pages}
            <span className="ml-1 aka-muted">
              ({props.highlights.length})
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
