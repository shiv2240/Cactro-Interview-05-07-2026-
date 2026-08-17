import { MessageType, sendMessage } from "../shared/messaging/protocol";
import React from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { escapeHtml } from "../shared/sanitize";
import type { FeaturePrefs } from "../shared/types";
import {
  extractPageContent,
  extractPageContextForTerm,
  findCleanSnippetForTerm,
  isChromeText,
  offlineKeywordSummary,
  UI_CHROME_TERMS,
} from "./pageText";

/** Classic sticky-note pastels — flat/matte paper */
const KW_COLORS = [
  { bg: "#fff59d", border: "#f0e68c", text: "#3d3420" },
  { bg: "#f8bbd0", border: "#f0a8c0", text: "#4a2030" },
  { bg: "#bbdefb", border: "#a8d0f0", text: "#1e3048" },
  { bg: "#c8e6c9", border: "#b5d8b8", text: "#1e3a28" },
  { bg: "#ffe0b2", border: "#f0d0a0", text: "#4a3020" },
  { bg: "#e1bee7", border: "#d0aee0", text: "#3a2048" },
  { bg: "#b2dfdb", border: "#a0d0cc", text: "#1e3a38" },
  { bg: "#ffccbc", border: "#f0b8a8", text: "#4a2820" },
] as const;

const TILE_POS_KEY = "hs_tile_position";

const STOP = new Set(
  (
    "a an the and or but if in on at to for of as is was are were be been being " +
    "this that these those it its with from by into over after before about between " +
    "not no yes you your we they he she his her their our my me him them us " +
    "will would can could should may might must shall do does did done having have has had " +
    "what when where which who how why all any each few more most other some such than too very " +
    "just also only then there here using use used via per etc http https www com"
  ).split(/\s+/)
);

const TILE_ID = "aka-keyword-tile-root";
const POPUP_ID = "aka-keyword-popup-root";
const MARK_CLASS = "aka-kw-mark";
const MAX_MARKS = 120;

type KeywordMeta = {
  term: string;
  summary: string;
  colorIndex: number;
};

const keywordStore = new Map<string, KeywordMeta>();
let tileHost: HTMLElement | null = null;
let popupHost: HTMLElement | null = null;
let popupCleanup: (() => void) | null = null;
let tileResizeHandler: (() => void) | null = null;
let currentFeature: FeaturePrefs | null = null;

export type KeywordTileHooks = {
  onSaveHighlight: (text: string) => Promise<void>;
  onFeaturePatch: (patch: Partial<FeaturePrefs>) => Promise<void>;
  isContextValid: () => boolean;
};

let hooks: KeywordTileHooks = {
  onSaveHighlight: async () => undefined,
  onFeaturePatch: async () => undefined,
  isContextValid: () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  },
};

export function setKeywordHooks(next: KeywordTileHooks): void {
  hooks = next;
}

function isContextValid(): boolean {
  return hooks.isContextValid();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractKeywordsOffline(pageText: string, limit = 8): KeywordMeta[] {
  const freq = new Map<string, number>();
  const words = String(pageText || "").match(/[A-Za-z][A-Za-z0-9+.#-]{2,}/g) || [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOP.has(lower) || UI_CHROME_TERMS.has(lower)) continue;
    if (lower.length < 4 || lower.length > 40) continue;
    freq.set(lower, (freq.get(lower) ?? 0) + 1);
  }
  for (const t of String(document.title || "")
    .toLowerCase()
    .split(/[^a-z0-9+.#-]+/)
    .filter(Boolean)) {
    if (t.length >= 4 && !STOP.has(t) && !UI_CHROME_TERMS.has(t)) {
      freq.set(t, (freq.get(t) ?? 0) + 3);
    }
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit * 3);

  const items: KeywordMeta[] = [];
  const seen = new Set<string>();

  for (let idx = 0; idx < ranked.length; idx++) {
    const term = ranked[idx]![0];
    if (items.length >= limit) break;
    if (seen.has(term) || UI_CHROME_TERMS.has(term)) continue;
    const re = new RegExp(`\\b(${escapeRegExp(term)})\\b`, "i");
    const m = String(pageText || "").match(re);
    const display = m?.[1] ?? term;
    if (UI_CHROME_TERMS.has(display.toLowerCase())) continue;
    seen.add(term);

    // NEVER dump nearby page chrome as the summary body.
    const clean = findCleanSnippetForTerm(display, pageText, 180);
    const snippet =
      clean && !isChromeText(clean)
        ? clean
        : offlineKeywordSummary(display);

    items.push({
      term: display,
      summary: snippet,
      colorIndex: idx % KW_COLORS.length,
    });
  }
  return items;
}

export function clearKeywordHighlights(): void {
  document.querySelectorAll(`mark.${MARK_CLASS}`).forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(el.textContent || ""), el);
    parent.normalize();
  });
}

function isSkippable(node: Element | null): boolean {
  if (!node || node.nodeType !== 1) return true;
  const tag = node.tagName;
  if (
    /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|CANVAS|IFRAME|CODE|PRE|KBD|SAMP)$/i.test(
      tag
    )
  ) {
    return true;
  }
  // Rich-text editors commonly nest spans/divs under their editable host.
  // Mutating any of those text nodes destroys the editor's caret and state.
  if (
    (node as HTMLElement).isContentEditable ||
    node.closest?.(
      "[contenteditable], [role='textbox'], [role='searchbox'], [role='combobox'], [aria-multiline='true']"
    )
  ) {
    return true;
  }
  if (node.id === TILE_ID || node.id === POPUP_ID || node.id === "aka-root") return true;
  if (node.closest?.(`#${TILE_ID}, #${POPUP_ID}, #aka-root, mark.${MARK_CLASS}`)) {
    return true;
  }
  return false;
}

export function applyKeywordHighlights(
  stickyNotesEnabled: boolean
): number {
  clearKeywordHighlights();
  if (!stickyNotesEnabled || keywordStore.size === 0) return 0;

  const terms = [...keywordStore.values()]
    .map((v) => v.term)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return 0;

  const pattern = new RegExp(
    `(${terms
      .map((t) => {
        const escaped = escapeRegExp(t);
        if (!/\s/.test(t) && t.length <= 12) return `\\b${escaped}\\b`;
        return escaped;
      })
      .join("|")})`,
    "gi"
  );

  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;
  if (!root || isSkippable(root)) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent || isSkippable(parent)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`mark.${MARK_CLASS}`)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  let markCount = 0;
  for (const textNode of textNodes) {
    if (markCount >= MAX_MARKS) break;
    const text = textNode.nodeValue ?? "";
    pattern.lastIndex = 0;
    if (!pattern.test(text)) {
      pattern.lastIndex = 0;
      continue;
    }
    pattern.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let madeMark = false;
    while ((match = pattern.exec(text)) !== null) {
      if (markCount >= MAX_MARKS) break;
      const matched = match[0];
      const key = matched.toLowerCase();
      const meta = keywordStore.get(key);
      if (match.index > lastIndex) {
        frag.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }
      if (!meta) {
        frag.appendChild(document.createTextNode(matched));
        lastIndex = match.index + matched.length;
        continue;
      }
      const color = KW_COLORS[meta.colorIndex % KW_COLORS.length]!;
      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.dataset.akaKey = key;
      mark.textContent = matched;
      mark.style.cssText = `
        background: ${color.bg};
        color: inherit;
        border: 1px solid ${color.border};
        border-radius: 2px;
        padding: 0 3px;
        margin: 0 1px;
        cursor: pointer;
        box-shadow: none;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      `;
      const parentAnchor = textNode.parentElement?.closest("a") as HTMLAnchorElement | null;
      if (parentAnchor && parentAnchor.href) {
        mark.title = "Click for AI context · Double-click to open link";
      } else {
        mark.title = "Click for context · Esc to close";
      }

      let markClickTimer: ReturnType<typeof setTimeout> | null = null;
      let markClickCount = 0;

      const navigateAnchor = (anchor: HTMLAnchorElement, e: MouseEvent) => {
        if (anchor.target === "_blank" || e.ctrlKey || e.metaKey) {
          window.open(anchor.href, "_blank", "noopener,noreferrer");
        } else if (
          anchor.href &&
          !anchor.href.startsWith("javascript:") &&
          anchor.getAttribute("href") !== "#"
        ) {
          window.location.href = anchor.href;
        } else {
          anchor.click();
        }
      };

      const handleMarkClick = (ev: MouseEvent) => {
        const anchor = (mark.closest("a") || mark.querySelector("a")) as HTMLAnchorElement | null;
        if (anchor && anchor.href) {
          ev.preventDefault();
          ev.stopPropagation();
          markClickCount++;
          if (markClickCount === 1) {
            markClickTimer = setTimeout(() => {
              markClickCount = 0;
              markClickTimer = null;
              showKeywordPopup(meta, mark);
            }, 250);
          } else if (markClickCount >= 2) {
            if (markClickTimer) {
              clearTimeout(markClickTimer);
              markClickTimer = null;
            }
            markClickCount = 0;
            closeKeywordPopup();
            navigateAnchor(anchor, ev);
          }
        } else {
          ev.preventDefault();
          ev.stopPropagation();
          showKeywordPopup(meta, mark);
        }
      };

      const handleMarkDblClick = (ev: MouseEvent) => {
        const anchor = (mark.closest("a") || mark.querySelector("a")) as HTMLAnchorElement | null;
        if (anchor && anchor.href) {
          ev.preventDefault();
          ev.stopPropagation();
          if (markClickTimer) {
            clearTimeout(markClickTimer);
            markClickTimer = null;
          }
          markClickCount = 0;
          closeKeywordPopup();
          navigateAnchor(anchor, ev);
        }
      };

      mark.addEventListener("click", handleMarkClick);
      mark.addEventListener("dblclick", handleMarkDblClick);
      frag.appendChild(mark);
      madeMark = true;
      markCount++;
      lastIndex = match.index + matched.length;
    }
    if (!madeMark && lastIndex === 0) continue;
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return markCount;
}

function closeKeywordPopup(): void {
  if (popupCleanup) {
    popupCleanup();
    popupCleanup = null;
  }
  popupHost?.remove();
  popupHost = null;
  document.getElementById(POPUP_ID)?.remove();
}

function buildKeywordPlainText(term: string, summary: string): string {
  return `${term}\n\n${summary}`.trim();
}

function positionKeywordPopupAbsolute(
  host: HTMLElement,
  anchorEl: HTMLElement | null
): void {
  if (!host.isConnected) return;
  const gap = 10;
  const pad = 12;
  const popupW = Math.min(
    360,
    Math.max(240, document.documentElement.clientWidth - 24)
  );
  const card = host.shadowRoot?.querySelector(".card") as HTMLElement | null;
  const popupH = card?.offsetHeight || 220;
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || 0;

  let rect: DOMRect | { top: number; bottom: number; left: number; width: number; height: number };
  if (anchorEl && document.contains(anchorEl)) {
    rect = anchorEl.getBoundingClientRect();
  } else {
    const tile = document.getElementById(TILE_ID);
    const t = tile?.getBoundingClientRect();
    rect =
      t ||
      ({
        top: 80,
        bottom: 110,
        left: window.innerWidth - 380,
        width: 0,
        height: 0,
      } as const);
  }

  const spaceBelow = window.innerHeight - rect.bottom;
  let topViewport: number;
  if (spaceBelow >= Math.min(popupH + gap, 140)) {
    topViewport = rect.bottom + gap;
  } else {
    topViewport = rect.top - popupH - gap;
  }

  let leftViewport = rect.left + (rect.width || 0) / 2 - popupW / 2;
  const docW = Math.max(
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth
  );
  let leftDoc = leftViewport + scrollX;
  leftDoc = Math.max(pad, Math.min(leftDoc, docW - popupW - pad));
  const topDoc = Math.max(pad, topViewport + scrollY);

  host.style.top = `${topDoc}px`;
  host.style.left = `${leftDoc}px`;
  host.style.width = `${popupW}px`;
}

function showKeywordPopup(meta: KeywordMeta, anchor: HTMLElement | null): void {
  closeKeywordPopup();
  popupHost = document.createElement("div");
  popupHost.id = POPUP_ID;
  popupHost.style.cssText =
    "position:absolute;z-index:2147483647;opacity:0;transform:translateY(6px) scale(0.97);";
  const shadow = popupHost.attachShadow({ mode: "open" });
  const color = KW_COLORS[meta.colorIndex % KW_COLORS.length]!;
  const safeOffline =
    meta.summary && !isChromeText(meta.summary)
      ? meta.summary
      : offlineKeywordSummary(meta.term);
  let liveSummary = safeOffline;
  const getPlainText = () => buildKeywordPlainText(meta.term, liveSummary);
  const key = meta.term.toLowerCase();
  let liveAnchor =
    anchor && document.contains(anchor) ? anchor : null;
  if (!liveAnchor && key) {
    liveAnchor = document.querySelector(
      `mark.${MARK_CLASS}[data-aka-key="${CSS.escape(key)}"]`
    ) as HTMLElement | null;
  }

  const requestId = crypto.randomUUID();
  shadow.innerHTML = `
    <style>
      .card {
        font-family: "Segoe UI", system-ui, sans-serif;
        width: 100%; background: #fffef8; border: 1px solid #e8e4d8;
        border-radius: 10px; box-shadow: 0 4px 16px rgba(60,50,30,0.12);
        overflow: hidden; color: #3d3420;
      }
      .accent { height: 6px; background: ${color.bg}; border-bottom: 1px solid ${color.border}; }
      .head {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 10px; padding: 12px 14px 8px;
      }
      .head-actions { display: flex; align-items: center; gap: 7px; }
      .term {
        font-size: 16px; font-weight: 780; letter-spacing: -0.02em; color: #2c2416;
        line-height: 1.25; word-break: break-word;
      }
      .badge {
        display: inline-block; margin-top: 6px; font-size: 10px; font-weight: 650;
        letter-spacing: 0.03em; text-transform: uppercase; padding: 3px 8px;
        border-radius: 4px; background: ${color.bg}; border: 1px solid ${color.border};
        color: ${color.text};
      }
      .status {
        margin: 0 14px 6px; font-size: 11px; color: #8a8272;
      }
      .close {
        border: 1px solid #e0dccf; background: #f7f5ee; color: #5c5548;
        width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px;
      }
      .close:hover { background: #efece3; color: #9a3412; }
      .copy-top {
        border: 1px solid #e0dccf; background: #fff; color: #5c5548;
        border-radius: 6px; width: 28px; height: 28px; padding: 0; cursor: pointer;
        display: inline-grid; place-items: center;
      }
      .copy-top:hover { background: #f3f0e6; }
      .copy-top svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.8; }
      .body {
        padding: 2px 14px 10px; max-height: min(360px, 58vh); overflow: auto;
        font-size: 13px; line-height: 1.55; color: #4a4336; word-break: break-word;
      }
      .body p { margin: 0 0 8px; }
      .body p:last-child { margin-bottom: 0; }
      .body h1, .body h2, .body h3 { margin: 10px 0 5px; font-size: 14px; line-height: 1.3; }
      .body ul, .body ol { margin: 5px 0 9px; padding-left: 20px; }
      .body li { margin: 3px 0; }
      .body code { padding: 1px 4px; border-radius: 3px; background: #f1eee4; font-family: ui-monospace, Menlo, Consolas, monospace; }
      .actions {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px 12px; border-top: 1px solid #ebe6da; background: #faf8f1;
      }
      .abtn {
        display: inline-flex; align-items: center; gap: 5px;
        border: 1px solid #e0dccf; background: #fff; color: #3d3420;
        border-radius: 6px; padding: 7px 11px; font-size: 12px; font-weight: 650; cursor: pointer;
      }
      .abtn:hover { background: #f3f0e6; }
      .abtn-save { background: #fff59d; border-color: #f0e68c; }
      .abtn-save:hover { background: #fff176; }
      .abtn-save:disabled {
        background: #e8f5e9; border-color: #c8e6c9; color: #2e7d32; cursor: default;
      }
      .hint { margin-left: auto; font-size: 10.5px; color: #8a8272; }
      .kbd {
        font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10px;
        padding: 2px 6px; border-radius: 4px; border: 1px solid #e0dccf; background: #fff;
      }
    </style>
    <div class="card">
      <div class="accent"></div>
      <div class="head">
        <div>
          <div class="term" id="term">${escapeHtml(meta.term)}</div>
          <span class="badge">Keyword summary</span>
        </div>
        <div class="head-actions">
          <button class="copy-top" type="button" id="copy" aria-label="Copy response" title="Copy">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"></path></svg>
          </button>
          <button class="close" type="button" aria-label="Close" title="Close (Esc)" id="close">&times;</button>
        </div>
      </div>
      <div class="status" id="status">Generating insight…</div>
      <div class="body" id="body">Explaining “${escapeHtml(meta.term)}”…</div>
      <div class="actions">
        <button class="abtn abtn-save" type="button" id="save">Save</button>
        <span class="hint"><span class="kbd">Esc</span> close</span>
      </div>
    </div>
  `;

  const bodyEl = shadow.getElementById("body")!;
  const markdownRoot = createRoot(bodyEl);
  const statusEl = shadow.getElementById("status")!;
  const renderMarkdown = (markdown: string) => {
    markdownRoot.render(React.createElement(ReactMarkdown, null, markdown));
  };
  renderMarkdown(`Explaining “${meta.term}”…`);

  shadow.getElementById("close")?.addEventListener("click", closeKeywordPopup);

  const saveBtn = shadow.getElementById("save") as HTMLButtonElement | null;
  const copyBtn = shadow.getElementById("copy") as HTMLButtonElement | null;

  copyBtn?.addEventListener("click", () => {
    const flash = () => {
      if (!copyBtn) return;
      const orig = copyBtn.innerHTML;
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.innerHTML = orig;
      }, 1400);
    };
    const payload = getPlainText();
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = payload;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        flash();
      } catch {
        /* ignore */
      }
      ta.remove();
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(payload).then(flash).catch(fallback);
    } else {
      fallback();
    }
  });

  saveBtn?.addEventListener("click", () => {
    if (!isContextValid()) {
      window.location.reload();
      return;
    }
    void (async () => {
      try {
        await hooks.onSaveHighlight(getPlainText());
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saved!";
        }
      } catch {
        if (saveBtn) saveBtn.textContent = "Failed";
      }
    })();
  });

  document.documentElement.appendChild(popupHost);

  const place = () => {
    if (!liveAnchor || !document.contains(liveAnchor)) {
      if (key) {
        liveAnchor = document.querySelector(
          `mark.${MARK_CLASS}[data-aka-key="${CSS.escape(key)}"]`
        ) as HTMLElement | null;
      }
    }
    if (popupHost) positionKeywordPopupAbsolute(popupHost, liveAnchor);
  };

  place();
  requestAnimationFrame(() => {
    if (!popupHost) return;
    popupHost.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    popupHost.style.opacity = "1";
    popupHost.style.transform = "translateY(0) scale(1)";
    place();
  });

  const onResize = () => place();
  window.addEventListener("resize", onResize);
  const onDocDown = (e: MouseEvent) => {
    const path = e.composedPath();
    if (
      !path.includes(popupHost!) &&
      !path.some(
        (n) => n instanceof Element && n.classList?.contains(MARK_CLASS)
      ) &&
      !path.some((n) => n instanceof Element && n.id === TILE_ID)
    ) {
      closeKeywordPopup();
    }
  };
  setTimeout(() => document.addEventListener("mousedown", onDocDown, true), 0);

  // Stream AI insight centered on this keyword term (cleaned page context only).
  let streamed = "";
  const applySafeFallback = (reason: string) => {
    liveSummary = safeOffline;
    renderMarkdown(safeOffline);
    statusEl.textContent = reason;
  };
  const onChunk = (msg: {
    type?: string;
    requestId?: string;
    chunk?: string;
    envelope?: { latencyMs?: number };
    error?: string;
  }) => {
    if (msg.requestId !== requestId) return;
    if (msg.type === MessageType.AI_STREAM_CHUNK && msg.chunk) {
      streamed += msg.chunk;
      // Reject chrome dumps mid-stream / at end
      if (isChromeText(streamed) && streamed.length > 80) {
        applySafeFallback("Filtered page chrome — retry");
        return;
      }
      liveSummary = streamed;
      renderMarkdown(streamed);
      statusEl.textContent = "Streaming…";
      place();
    }
    if (msg.type === MessageType.AI_STREAM_DONE) {
      chrome.runtime.onMessage.removeListener(onChunk as never);
      if (msg.error) {
        applySafeFallback(msg.error);
      } else if (!streamed.trim() || isChromeText(streamed)) {
        applySafeFallback("Done");
      } else {
        liveSummary = streamed;
        renderMarkdown(streamed);
        statusEl.textContent = msg.envelope?.latencyMs
          ? `${msg.envelope.latencyMs}ms`
          : "Done";
      }
      place();
    }
  };
  chrome.runtime.onMessage.addListener(onChunk as never);

  // Prefer cleaned context; omit entirely if scrub leaves chrome.
  let pageContext = extractPageContextForTerm(meta.term, 2_500);
  if (pageContext && isChromeText(pageContext)) pageContext = "";

  void sendMessage({
    type: MessageType.AI_STREAM,
    requestId,
    action: "explain",
    text: meta.term,
    selectedText: meta.term,
    pageContext: pageContext || undefined,
    pageTitle: document.title,
    url: location.href,
  }).catch((e) => {
    applySafeFallback(e instanceof Error ? e.message : "AI failed");
    chrome.runtime.onMessage.removeListener(onChunk as never);
  });

  popupCleanup = () => {
    window.removeEventListener("resize", onResize);
    document.removeEventListener("mousedown", onDocDown, true);
    chrome.runtime.onMessage.removeListener(onChunk as never);
  };
}

function clampTilePosition(
  left: number,
  top: number,
  width: number,
  height: number
): { left: number; top: number } {
  const pad = 8;
  const maxL = Math.max(pad, window.innerWidth - width - pad);
  const maxT = Math.max(pad, window.innerHeight - height - pad);
  return {
    left: Math.min(Math.max(pad, left), maxL),
    top: Math.min(Math.max(pad, top), maxT),
  };
}

function applyTilePosition(
  host: HTMLElement,
  left: number,
  top: number
): { left: number; top: number } {
  const w = host.offsetWidth || 210;
  const h = host.offsetHeight || 56;
  const pos = clampTilePosition(left, top, w, h);
  host.style.left = `${pos.left}px`;
  host.style.top = `${pos.top}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
  return pos;
}

function saveTilePosition(left: number, top: number): void {
  if (!isContextValid()) return;
  try {
    chrome.storage.local.set({ [TILE_POS_KEY]: { left, top } }, () => {
      try {
        void chrome.runtime?.lastError;
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

function loadTilePosition(
  cb: (pos: { left: number; top: number } | null) => void
): void {
  if (!isContextValid()) {
    cb(null);
    return;
  }
  try {
    chrome.storage.local.get([TILE_POS_KEY], (result) => {
      try {
        if (chrome.runtime?.lastError) {
          cb(null);
          return;
        }
        const p = result?.[TILE_POS_KEY] as
          | { left?: unknown; top?: unknown }
          | undefined;
        if (
          p &&
          typeof p.left === "number" &&
          typeof p.top === "number"
        ) {
          cb({ left: p.left, top: p.top });
        } else {
          cb(null);
        }
      } catch {
        cb(null);
      }
    });
  } catch {
    cb(null);
  }
}

function enableKeywordTileDrag(
  host: HTMLElement,
  headerEl: HTMLElement
): void {
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  const DRAG_THRESHOLD = 5;

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (
      !moved &&
      (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)
    ) {
      moved = true;
      host.classList.add("aka-dragging");
      host.shadowRoot?.querySelector(".tile")?.classList.add("dragging");
      headerEl.style.cursor = "grabbing";
    }
    if (!moved) return;
    e.preventDefault();
    applyTilePosition(host, origLeft + dx, origTop + dy);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    host.classList.remove("aka-dragging");
    host.shadowRoot?.querySelector(".tile")?.classList.remove("dragging");
    headerEl.style.cursor = "grab";
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    try {
      headerEl.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }

    if (moved) {
      const left = parseFloat(host.style.left) || 0;
      const top = parseFloat(host.style.top) || 0;
      const pos = applyTilePosition(host, left, top);
      saveTilePosition(pos.left, pos.top);
      (host as HTMLElement & { _akaSkipNextHeaderClick?: boolean })._akaSkipNextHeaderClick =
        true;
      setTimeout(() => {
        (host as HTMLElement & { _akaSkipNextHeaderClick?: boolean })._akaSkipNextHeaderClick =
          false;
      }, 0);
    }
  };

  headerEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const t = e.target as Element | null;
    if (
      t?.closest?.(
        ".gear-btn, .clear-btn, .prefs-panel, button, input, label, .chip, #list"
      )
    ) {
      return;
    }
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = host.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    applyTilePosition(host, origLeft, origTop);
    headerEl.setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
  });

  if (tileResizeHandler) {
    window.removeEventListener("resize", tileResizeHandler);
  }
  tileResizeHandler = () => {
    const left = parseFloat(host.style.left);
    const top = parseFloat(host.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      applyTilePosition(host, left, top);
    }
  };
  window.addEventListener("resize", tileResizeHandler);
}

function removeTile(): void {
  if (tileResizeHandler) {
    window.removeEventListener("resize", tileResizeHandler);
    tileResizeHandler = null;
  }
  tileHost?.remove();
  tileHost = null;
  document.getElementById(TILE_ID)?.remove();
}

function renderTile(items: KeywordMeta[], feature: FeaturePrefs): void {
  removeTile();
  if (!items.length) return;

  let listOpen = false;
  let prefsOpen = false;

  tileHost = document.createElement("div");
  tileHost.id = TILE_ID;
  tileHost.style.cssText =
    "all:initial;position:fixed;top:16px;right:16px;z-index:2147483645;";
  const shadow = tileHost.attachShadow({ mode: "open" });
  const theme =
    document.documentElement.dataset.akaTheme === "dark" ? "dark" : "light";

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .tile {
        font-family: "Segoe UI", system-ui, sans-serif;
        display: flex; flex-direction: column; width: 210px;
        border-radius: 10px; background: #fffef8; border: 1px solid #e8e4d8;
        box-shadow: 0 2px 8px rgba(60,50,30,0.08); color: #3d3420;
        user-select: none; overflow: hidden; touch-action: none;
      }
      :host(.aka-dragging) .tile, .tile.dragging {
        box-shadow: 0 6px 18px rgba(60,50,30,0.16); opacity: 0.96;
      }
      .header {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 11px 12px; cursor: grab;
      }
      .header:hover { background: #faf7ef; }
      .header:active { cursor: grabbing; }
      .drag-hint {
        font-size: 9px; color: #a89f8c; letter-spacing: 0.08em; margin-bottom: 2px;
      }
      .meta { flex: 1; min-width: 0; }
      .title-row { display: flex; align-items: center; gap: 6px; }
      .title { font-size: 12px; font-weight: 650; color: #2c2416; }
      .chevron { font-size: 10px; color: #8a8272; margin-left: auto; transition: transform 0.18s; }
      .tile.open .chevron { transform: rotate(180deg); }
      .status { font-size: 11px; color: #6b6354; margin-top: 3px; line-height: 1.35; }
      .header-actions {
        display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;
      }
      .gear-btn, .clear-btn {
        border: 1px solid #e0dccf; background: #f7f5ee; color: #5c5548;
        border-radius: 6px; cursor: pointer; outline: none; touch-action: auto;
      }
      .gear-btn { width: 26px; height: 26px; padding: 0; font-size: 13px; }
      .gear-btn.active { background: #ebe6da; border-color: #cfc8b6; }
      .clear-btn { padding: 3px 8px; font-size: 10.5px; font-weight: 600; }
      .clear-btn:disabled { opacity: 0.4; cursor: default; }
      .prefs-panel {
        display: none; flex-direction: column; gap: 8px;
        padding: 8px 10px 10px; border-top: 1px solid #ebe6da; touch-action: auto;
      }
      .tile.prefs-open .prefs-panel { display: flex; }
      .tile.prefs-open .word-panel { display: none !important; }
      .prefs-heading {
        font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
        text-transform: uppercase; color: #8a8272; margin: 2px 0 0;
      }
      .pref-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; font-size: 11.5px; font-weight: 550; color: #3d3420;
      }
      .switch { position: relative; width: 34px; height: 18px; flex-shrink: 0; }
      .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
      .switch-slider {
        position: absolute; inset: 0; background: #d5cfbf; border-radius: 999px; cursor: pointer;
      }
      .switch-slider::before {
        content: ''; position: absolute; width: 14px; height: 14px; left: 2px; top: 2px;
        background: #fff; border-radius: 50%; transition: transform 0.15s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.15);
      }
      .switch input:checked + .switch-slider { background: #5b8f3a; }
      .switch input:checked + .switch-slider::before { transform: translateX(16px); }
      .word-panel {
        display: none; flex-direction: column; gap: 6px;
        padding: 0 10px 10px; max-height: min(340px, 55vh); overflow: auto;
        border-top: 1px solid #ebe6da; padding-top: 8px; touch-action: auto;
      }
      .tile.open .word-panel { display: flex; }
      .hint { font-size: 10px; color: #8a8272; padding: 0 2px 2px; }
      .chip {
        display: block; width: 100%; text-align: left; font-size: 12px; font-weight: 600;
        padding: 7px 9px; border-radius: 6px; border: 1px solid transparent;
        cursor: pointer; outline: none; touch-action: auto;
      }
      .chip:hover { opacity: 0.9; }
      .tile[data-theme="dark"] {
        background: rgba(18,28,48,0.92); border-color: rgba(160,190,230,0.16);
        box-shadow: 0 8px 24px rgba(0,0,0,0.4); color: #e6eef8;
      }
      .tile[data-theme="dark"] .title { color: #e6eef8; }
      .tile[data-theme="dark"] .status, .tile[data-theme="dark"] .hint { color: #9db0c8; }
      .tile[data-theme="dark"] .drag-hint, .tile[data-theme="dark"] .prefs-heading { color: #7a8fa8; }
      .tile[data-theme="dark"] .gear-btn, .tile[data-theme="dark"] .clear-btn {
        border-color: rgba(160,190,230,0.18); background: rgba(30,42,68,0.9); color: #c5d4ef;
      }
      .tile[data-theme="dark"] .pref-row { color: #e6eef8; }
      .tile[data-theme="dark"] .header:hover { background: rgba(30,42,68,0.55); }
      .tile[data-theme="dark"] .switch-slider { background: #3a4a62; }
      .tile[data-theme="dark"] .switch input:checked + .switch-slider { background: #4ade80; }
    </style>
    <div class="tile" data-theme="${theme}" id="tile">
      <div class="header" id="header" title="Drag to move · Click to show keywords">
        <div class="meta">
          <div class="drag-hint">⠿ DRAG</div>
          <div class="title-row">
            <div class="title">Keywords</div>
            <span class="chevron" aria-hidden="true">▾</span>
          </div>
          <div class="status" id="status">${items.length} words · click tile</div>
        </div>
        <div class="header-actions">
          <button class="gear-btn" id="gear" title="Feature settings" type="button">⚙</button>
          <button class="clear-btn" id="clear" title="Clear highlights" type="button">Clear</button>
        </div>
      </div>
      <div class="prefs-panel" id="prefs">
        <div class="prefs-heading">Page highlights</div>
        <label class="pref-row">
          <span>Sticky notes</span>
          <span class="switch">
            <input type="checkbox" id="pref-sticky" />
            <span class="switch-slider"></span>
          </span>
        </label>
        <div class="prefs-heading">Selection tooltip</div>
        <label class="pref-row">
          <span>Save Highlight</span>
          <span class="switch">
            <input type="checkbox" id="pref-save" />
            <span class="switch-slider"></span>
          </span>
        </label>
        <label class="pref-row">
          <span>AI Summary</span>
          <span class="switch">
            <input type="checkbox" id="pref-ai" />
            <span class="switch-slider"></span>
          </span>
        </label>
        <label class="pref-row">
          <span>Summarize Page</span>
          <span class="switch">
            <input type="checkbox" id="pref-page" />
            <span class="switch-slider"></span>
          </span>
        </label>
      </div>
      <div class="word-panel" id="words">
        <div class="hint">Click a word for summary</div>
      </div>
    </div>
  `;

  const tile = shadow.getElementById("tile")!;
  const headerEl = shadow.getElementById("header")!;
  const gearBtn = shadow.getElementById("gear")!;
  const clearBtn = shadow.getElementById("clear") as HTMLButtonElement;
  const wordsEl = shadow.getElementById("words")!;
  const prefSticky = shadow.getElementById("pref-sticky") as HTMLInputElement;
  const prefSave = shadow.getElementById("pref-save") as HTMLInputElement;
  const prefAi = shadow.getElementById("pref-ai") as HTMLInputElement;
  const prefPage = shadow.getElementById("pref-page") as HTMLInputElement;

  const syncPrefsUi = () => {
    const f = currentFeature ?? feature;
    prefSticky.checked = !!f.stickyNotes;
    prefSave.checked = !!f.saveHighlight;
    prefAi.checked = !!f.aiSummary;
    prefPage.checked = !!f.summarizePage;
    gearBtn.classList.toggle("active", prefsOpen);
    tile.classList.toggle("prefs-open", prefsOpen);
  };

  const setListOpen = (open: boolean) => {
    listOpen = !!open && items.length > 0;
    if (listOpen) {
      prefsOpen = false;
      syncPrefsUi();
    }
    tile.classList.toggle("open", listOpen);
  };

  syncPrefsUi();
  enableKeywordTileDrag(tileHost, headerEl);

  loadTilePosition((saved) => {
    if (saved && tileHost) applyTilePosition(tileHost, saved.left, saved.top);
  });

  gearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    prefsOpen = !prefsOpen;
    if (prefsOpen) setListOpen(false);
    syncPrefsUi();
  });

  const bindPref = (
    el: HTMLInputElement,
    key: keyof FeaturePrefs
  ) => {
    el.addEventListener("change", (e) => {
      e.stopPropagation();
      void hooks.onFeaturePatch({ [key]: el.checked });
    });
    el.addEventListener("click", (e) => e.stopPropagation());
  };
  bindPref(prefSticky, "stickyNotes");
  bindPref(prefSave, "saveHighlight");
  bindPref(prefAi, "aiSummary");
  bindPref(prefPage, "summarizePage");

  for (const item of items) {
    const color = KW_COLORS[item.colorIndex % KW_COLORS.length]!;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = item.term;
    btn.style.background = color.bg;
    btn.style.borderColor = color.border;
    btn.style.color = color.text;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = item.term.toLowerCase();
      const mark = document.querySelector(
        `mark.${MARK_CLASS}[data-aka-key="${CSS.escape(key)}"]`
      ) as HTMLElement | null;
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
        showKeywordPopup(item, mark);
      } else {
        showKeywordPopup(item, tileHost);
      }
    });
    wordsEl.appendChild(btn);
  }

  headerEl.addEventListener("click", (e) => {
    const hostExt = tileHost as HTMLElement & {
      _akaSkipNextHeaderClick?: boolean;
    };
    if (hostExt._akaSkipNextHeaderClick) return;
    const t = e.target as Element;
    if (t === clearBtn || clearBtn.contains(t)) return;
    if (t === gearBtn || gearBtn.contains(t)) return;
    if (shadow.getElementById("prefs")?.contains(t)) return;
    if (!items.length) return;
    prefsOpen = false;
    syncPrefsUi();
    setListOpen(!listOpen);
  });

  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearKeywordHighlights();
    const status = shadow.getElementById("status");
    if (status) status.textContent = "Cleared";
    setListOpen(false);
    closeKeywordPopup();
  });

  document.documentElement.appendChild(tileHost);
}

/** Refresh keyword tile + optional pastel sticky-note marks from page text. */
export function refreshKeywords(feature: FeaturePrefs): void {
  closeKeywordPopup();
  clearKeywordHighlights();
  keywordStore.clear();
  removeTile();
  currentFeature = feature;

  if (!feature.keywordsTile && !feature.stickyNotes) return;

  const pageText = extractPageContent(40_000);
  const items = extractKeywordsOffline(pageText, 8);
  items.forEach((item) => {
    keywordStore.set(item.term.toLowerCase(), item);
  });

  if (feature.keywordsTile) renderTile(items, feature);
  if (feature.stickyNotes) applyKeywordHighlights(true);
}

export function teardownKeywords(): void {
  closeKeywordPopup();
  clearKeywordHighlights();
  keywordStore.clear();
  removeTile();
}

export function onKeywordEscape(): void {
  closeKeywordPopup();
}

export function isKeywordUiTarget(path: EventTarget[]): boolean {
  return path.some(
    (n) =>
      n === tileHost ||
      n === popupHost ||
      (n instanceof Element &&
        (n.classList?.contains(MARK_CLASS) ||
          n.id === TILE_ID ||
          n.id === POPUP_ID))
  );
}
