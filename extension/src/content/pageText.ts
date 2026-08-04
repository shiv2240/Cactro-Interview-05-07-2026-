/**
 * Extract readable article text for AI / keyword extraction.
 * Strips nav, chrome, Wikipedia UI, and extension hosts so models
 * don't treat "Search / Talk / Edit / Watch" as content.
 */

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "canvas",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='search']",
  "[role='complementary']",
  "[aria-hidden='true']",
  ".mw-jump-link",
  ".mw-jump-links",
  "#mw-navigation",
  "#mw-panel",
  "#mw-head",
  "#mw-page-base",
  "#mw-head-base",
  "#siteNotice",
  "#contentSub",
  "#jump-to-nav",
  "#vector-toc",
  "#vector-main-menu",
  "#vector-page-tools",
  "#vector-sticky-header",
  "#p-lang-btn",
  "#p-personal",
  "#p-views",
  "#p-namespaces",
  "#p-cactions",
  "#p-search",
  ".vector-header",
  ".vector-header-container",
  ".vector-sticky-header",
  ".vector-toc",
  ".vector-toc-landmark",
  ".vector-page-toolbar",
  ".vector-page-toolbar-container",
  ".vector-menu",
  ".vector-dropdown",
  ".vector-column-start",
  ".vector-column-end",
  ".mw-portlet",
  ".mw-indicators",
  ".mw-editsection",
  ".mw-cite-backlink",
  ".noprint",
  ".navbox",
  ".vertical-navbox",
  ".sidebar",
  ".sistersitebox",
  "#toc",
  ".toc",
  ".mw-table-of-contents",
  ".toccolours",
  ".site-nav",
  ".site-header",
  ".site-footer",
  "#aka-root",
  "#aka-keyword-tile-root",
  "#aka-keyword-popup-root",
  "#hs-ai-modal-root",
  "#hs-keyword-tile-root",
  "#hs-keyword-popup-root",
].join(",");

/** Common Wikipedia / site chrome tokens — never treat as keywords. */
export const UI_CHROME_TERMS = new Set(
  (
    "search user menu article talk language watch edit contents jump " +
    "wikipedia wikimedia commons portal help login log sign create account " +
    "donate tools appearance hide show more less read view history " +
    "main page random page about disclaimers contact download print " +
    "share cite references notes external links see also " +
    "navigation sidebar toolbar footer header cookie cookies privacy " +
    "subscribe newsletter follow toggle subsection"
  ).split(/\s+/)
);

/**
 * Aggressive line / blob filter for Wikipedia Vector + common site chrome.
 * Matches the Maryland repro: "Jump to content Main menu Search Donate…"
 */
export const CHROME_LINE_RE =
  /jump to content|jump to navigation|jump to search|main menu|create account|log[\s-]?in|contents\s*hide|toggle\s+\w+\s+subsection|user menu|donate\b|from wikipedia,? the free encyclopedia|languages?\s*$|add languages|appearance\b|vector-toc|edit links|view history|\(\s*top\s*\)/i;

function pickContentRoot(): Element {
  return (
    document.querySelector("#mw-content-text .mw-parser-output") ||
    document.querySelector("#mw-content-text") ||
    document.querySelector("#bodyContent") ||
    document.querySelector("#content") ||
    document.querySelector("article") ||
    document.querySelector("[role='main']") ||
    document.querySelector("main") ||
    document.body
  );
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** True if a line/sentence is website chrome, not article prose. */
export function isChromeText(text: string): boolean {
  const s = text.trim();
  if (!s) return true;
  if (CHROME_LINE_RE.test(s)) return true;

  const lower = s.toLowerCase();
  if (
    /^(search|user menu|article|talk|language|watch|edit|contents|donate|log in|create account)\b/.test(
      lower
    )
  ) {
    return true;
  }

  // TOC-style heading lists: "History Toggle History subsection Campus Academics"
  if (
    /\btoggle\b/i.test(s) &&
    /\bsubsection\b/i.test(s)
  ) {
    return true;
  }

  const tokens = lower.match(/[a-z][a-z0-9-]{2,}/g) || [];
  if (tokens.length === 0) return true;

  let hits = 0;
  for (const t of tokens) {
    if (UI_CHROME_TERMS.has(t)) hits++;
  }
  // Dense UI chrome soup (Wikipedia vector menus / collapsed TOC)
  if (hits >= 3 && tokens.length <= 40) return true;
  if (hits >= 5) return true;
  if (tokens.length >= 8 && hits / tokens.length >= 0.45) return true;

  return false;
}

/** Drop chrome lines before collapsing into a single blob. */
export function scrubChromeLines(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (isChromeText(t)) continue;
    // Drop ultra-short UI crumbs
    if (t.length < 3) continue;
    kept.push(t);
  }
  let text = kept.join("\n");
  // Also scrub chrome phrases if they were collapsed onto prose lines
  text = text
    .replace(/Jump to (content|search|navigation)[.\s]*/gi, "")
    .replace(/\bFrom Wikipedia,? the free encyclopedia\b/gi, "")
    .replace(/\bContents\s*hide\b/gi, "")
    .replace(/\bToggle \w+ subsection\b/gi, "")
    .replace(/\bCreate account\b/gi, "")
    .replace(/\bLog in\b/gi, "")
    .replace(/\bMain menu\b/gi, "")
    .replace(/\bDonate\b/gi, "");
  return normalizeWhitespace(text);
}

/**
 * Clone the main content region, strip chrome nodes, return plain text.
 */
export function extractPageContent(maxLen = 40_000): string {
  const root = pickContentRoot();
  if (!root) return "";

  let raw = "";
  try {
    const clone = root.cloneNode(true) as HTMLElement;
    try {
      clone.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove());
    } catch {
      /* some host pages reject certain selectors — ignore */
    }
    raw = clone.innerText || clone.textContent || "";
  } catch {
    raw = document.body?.innerText || "";
  }

  let text = scrubChromeLines(raw);
  // Last resort: if scrub wiped everything, try parser-output alone more carefully
  if (text.length < 40) {
    const po = document.querySelector("#mw-content-text .mw-parser-output");
    if (po && po !== root) {
      try {
        const c = po.cloneNode(true) as HTMLElement;
        c.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove());
        text = scrubChromeLines(c.innerText || c.textContent || "");
      } catch {
        /* ignore */
      }
    }
  }

  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}…`;
  }
  return text;
}

/**
 * Find a cleaned prose sentence mentioning `term`.
 * Never returns chrome soup — empty string if nothing clean found.
 */
export function findCleanSnippetForTerm(
  term: string,
  pageText?: string,
  maxLen = 220
): string {
  const page = pageText ?? extractPageContent(12_000);
  if (!page || !term.trim()) return "";

  const re = new RegExp(
    `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i"
  );

  // Prefer real sentence boundaries (page text keeps some newlines from scrub)
  const candidates = page
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24 && s.length <= 420)
    .filter((s) => re.test(s))
    .filter((s) => !isChromeText(s));

  const best = candidates[0];
  if (!best) return "";
  return best.slice(0, maxLen);
}

/** Shorter cleaned snippet for AI context around a focus term. */
export function extractPageContextForTerm(
  term: string,
  maxLen = 2_500
): string {
  const page = extractPageContent(12_000);
  if (!page) return "";
  const needle = term.trim();
  if (!needle) return page.slice(0, maxLen);

  // Prefer a window around a clean sentence hit, not the first raw index
  // (raw index can sit inside residual chrome if scrub missed something).
  const cleanHit = findCleanSnippetForTerm(needle, page, 400);
  if (cleanHit) {
    const idx = page.toLowerCase().indexOf(cleanHit.toLowerCase().slice(0, 40));
    if (idx >= 0) {
      const pad = Math.floor((maxLen - cleanHit.length) / 2);
      const start = Math.max(0, idx - Math.max(pad, 200));
      const end = Math.min(page.length, start + maxLen);
      let slice = page.slice(start, end);
      if (isChromeText(slice)) {
        return cleanHit;
      }
      if (start > 0) slice = `…${slice}`;
      if (end < page.length) slice = `${slice}…`;
      return scrubChromeLines(slice) || cleanHit;
    }
    return cleanHit;
  }

  const lower = page.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) {
    // No term hit — give a short clean lead of the article, not chrome
    const lead = page.slice(0, maxLen);
    return isChromeText(lead) ? "" : lead;
  }

  const pad = Math.floor((maxLen - needle.length) / 2);
  const start = Math.max(0, idx - pad);
  const end = Math.min(page.length, idx + needle.length + pad);
  let slice = page.slice(start, end);
  slice = scrubChromeLines(slice);
  if (!slice || isChromeText(slice)) return "";
  if (start > 0) slice = `…${slice}`;
  if (end < page.length) slice = `${slice}…`;
  return slice;
}

export function truncateLabel(text: string, max = 48): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/** Safe offline placeholder — never dumps page chrome. */
export function offlineKeywordSummary(term: string, pageTitle?: string): string {
  const title = (pageTitle || document.title || "this page").trim();
  return `Key term “${term}” on “${title}”. Open again for a full Meaning / On this page / Why it matters summary.`;
}
