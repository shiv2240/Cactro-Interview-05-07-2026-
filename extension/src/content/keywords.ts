import { escapeHtml } from "../shared/sanitize";
import type { FeaturePrefs } from "../shared/types";

/** Classic sticky-note pastels — flat/matte paper */
const KW_COLORS = [
  { bg: "#fff59d", border: "#f0e68c" },
  { bg: "#f8bbd0", border: "#f0a8c0" },
  { bg: "#bbdefb", border: "#a8d0f0" },
  { bg: "#c8e6c9", border: "#b5d8b8" },
  { bg: "#ffe0b2", border: "#f0d0a0" },
  { bg: "#e1bee7", border: "#d0aee0" },
  { bg: "#b2dfdb", border: "#a0d0cc" },
  { bg: "#ffccbc", border: "#f0b8a8" },
] as const;

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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractKeywordsOffline(pageText: string, limit = 8): KeywordMeta[] {
  const freq = new Map<string, number>();
  const words = String(pageText || "").match(/[A-Za-z][A-Za-z0-9+.#-]{2,}/g) || [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOP.has(lower) || lower.length < 4 || lower.length > 40) continue;
    freq.set(lower, (freq.get(lower) ?? 0) + 1);
  }
  for (const t of String(document.title || "")
    .toLowerCase()
    .split(/[^a-z0-9+.#-]+/)
    .filter(Boolean)) {
    if (t.length >= 4 && !STOP.has(t)) freq.set(t, (freq.get(t) ?? 0) + 3);
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit * 2);

  const items: KeywordMeta[] = [];
  const seen = new Set<string>();
  const sentences = String(pageText || "").split(/(?<=[.!?])\s+/);

  for (let idx = 0; idx < ranked.length; idx++) {
    const term = ranked[idx]![0];
    if (items.length >= limit) break;
    if (seen.has(term)) continue;
    const re = new RegExp(`\\b(${escapeRegExp(term)})\\b`, "i");
    const m = String(pageText || "").match(re);
    const display = m?.[1] ?? term;
    seen.add(term);
    const sentence = sentences.find((s) => re.test(s)) || "";
    const snippet =
      sentence.trim().slice(0, 180) ||
      `Appears on “${document.title || "this page"}”.`;
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
  if ((node as HTMLElement).isContentEditable) return true;
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
      mark.title = "Click for context · Esc to close";
      mark.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showKeywordPopup(meta, mark);
      });
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
  popupHost?.remove();
  popupHost = null;
}

function showKeywordPopup(meta: KeywordMeta, anchor: HTMLElement): void {
  closeKeywordPopup();
  popupHost = document.createElement("div");
  popupHost.id = POPUP_ID;
  popupHost.style.all = "initial";
  popupHost.style.position = "absolute";
  popupHost.style.zIndex = "2147483647";
  const rect = anchor.getBoundingClientRect();
  popupHost.style.left = `${rect.left + window.scrollX}px`;
  popupHost.style.top = `${rect.bottom + window.scrollY + 6}px`;
  const shadow = popupHost.attachShadow({ mode: "open" });
  const color = KW_COLORS[meta.colorIndex % KW_COLORS.length]!;
  shadow.innerHTML = `
    <style>
      .card {
        width: min(280px, 90vw); padding: 12px 14px; border-radius: 12px;
        background: ${color.bg}; border: 1px solid ${color.border};
        font-family: "Source Sans 3", Segoe UI, sans-serif;
        color: #1e293b; box-shadow: 0 12px 28px rgba(15,23,42,0.18);
      }
      .term { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
      .body { font-size: 12px; line-height: 1.45; opacity: 0.9; }
      button {
        margin-top: 10px; border: 0; border-radius: 8px; padding: 5px 10px;
        font-size: 11px; font-weight: 600; cursor: pointer; background: #0f172a; color: #fff;
      }
    </style>
    <div class="card">
      <div class="term">${escapeHtml(meta.term)}</div>
      <div class="body">${escapeHtml(meta.summary)}</div>
      <button type="button" id="close">Close</button>
    </div>
  `;
  shadow.getElementById("close")?.addEventListener("click", closeKeywordPopup);
  document.documentElement.appendChild(popupHost);
}

function removeTile(): void {
  tileHost?.remove();
  tileHost = null;
  document.getElementById(TILE_ID)?.remove();
}

function renderTile(items: KeywordMeta[]): void {
  removeTile();
  if (!items.length) return;
  tileHost = document.createElement("div");
  tileHost.id = TILE_ID;
  tileHost.style.all = "initial";
  tileHost.style.position = "fixed";
  tileHost.style.top = "16px";
  tileHost.style.right = "16px";
  tileHost.style.zIndex = "2147483645";
  const shadow = tileHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .tile {
        width: 200px; max-height: 280px; overflow: auto;
        padding: 10px 12px; border-radius: 14px;
        background: rgba(248,250,252,0.94); backdrop-filter: blur(10px);
        border: 1px solid rgba(148,163,184,0.4);
        font-family: Segoe UI, sans-serif; color: #334155;
        box-shadow: 0 10px 28px rgba(15,23,42,0.14);
      }
      .title { font-weight: 700; font-size: 12px; margin-bottom: 4px; }
      .status { font-size: 10px; opacity: 0.7; margin-bottom: 8px; }
      .chip {
        display: block; width: 100%; text-align: left; border: 0; cursor: pointer;
        margin: 0 0 4px; padding: 5px 8px; border-radius: 8px; font-size: 11px;
        font-weight: 600; background: #e2e8f0; color: #0f172a;
      }
      .chip:hover { filter: brightness(0.97); }
    </style>
    <div class="tile">
      <div class="title">Keyword insights</div>
      <div class="status" id="status">${items.length} words · click to jump</div>
      <div id="list"></div>
    </div>
  `;
  const list = shadow.getElementById("list")!;
  for (const item of items) {
    const color = KW_COLORS[item.colorIndex % KW_COLORS.length]!;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = item.term;
    btn.style.background = color.bg;
    btn.style.border = `1px solid ${color.border}`;
    btn.addEventListener("click", () => {
      const key = item.term.toLowerCase();
      const mark = document.querySelector(
        `mark.${MARK_CLASS}[data-aka-key="${CSS.escape(key)}"]`
      ) as HTMLElement | null;
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
        showKeywordPopup(item, mark);
      } else {
        showKeywordPopup(item, tileHost!);
      }
    });
    list.appendChild(btn);
  }
  document.documentElement.appendChild(tileHost);
}

/** Refresh keyword tile + optional pastel sticky-note marks from page text. */
export function refreshKeywords(feature: FeaturePrefs): void {
  closeKeywordPopup();
  clearKeywordHighlights();
  keywordStore.clear();
  removeTile();

  if (!feature.keywordsTile && !feature.stickyNotes) return;

  const pageText = (document.body?.innerText ?? "").slice(0, 40_000);
  const items = extractKeywordsOffline(pageText, 8);
  items.forEach((item) => {
    keywordStore.set(item.term.toLowerCase(), item);
  });

  if (feature.keywordsTile) renderTile(items);
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
