import { marked } from "marked";
import { MessageType, sendMessage } from "../shared/messaging/protocol";
import { escapeHtml } from "../shared/sanitize";
import type { AIAction, FeaturePrefs, UserPrefs } from "../shared/types";
import { DEFAULT_FEATURE_PREFS } from "../shared/types";
import {
  isKeywordUiTarget,
  onKeywordEscape,
  refreshKeywords,
  setKeywordHooks,
  teardownKeywords,
} from "./keywords";
import {
  extractPageContent,
  extractPageContextForTerm,
  isChromeText,
  truncateLabel,
} from "./pageText";

const HOST_ID = "aka-root";

function isContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

let prefs: UserPrefs | null = null;
let tooltipHost: HTMLElement | null = null;
let tooltipShadow: ShadowRoot | null = null;
let modalHost: HTMLElement | null = null;

async function loadPrefs(): Promise<UserPrefs> {
  prefs = await sendMessage<UserPrefs>({ type: MessageType.PREFS_GET });
  return prefs;
}

function feature(): FeaturePrefs {
  return prefs?.featurePrefs ?? DEFAULT_FEATURE_PREFS;
}

setKeywordHooks({
  isContextValid,
  onSaveHighlight: async (text) => {
    await sendMessage({
      type: MessageType.SAVE_HIGHLIGHT,
      text,
      url: location.href,
      title: document.title,
    });
    toast("Highlight saved");
  },
  onFeaturePatch: async (patch) => {
    const next = { ...feature(), ...patch };
    prefs = await sendMessage<UserPrefs>({
      type: MessageType.PREFS_SET,
      prefs: { featurePrefs: next },
    });
    refreshPageFeatures();
  },
});

function ensureTooltip() {
  if (tooltipHost) return;
  tooltipHost = document.createElement("div");
  tooltipHost.id = HOST_ID;
  tooltipHost.style.all = "initial";
  tooltipHost.style.position = "fixed";
  tooltipHost.style.zIndex = "2147483646";
  tooltipHost.style.top = "0";
  tooltipHost.style.left = "0";
  document.documentElement.appendChild(tooltipHost);
  tooltipShadow = tooltipHost.attachShadow({ mode: "open" });
}

function hideTooltip() {
  if (tooltipShadow) tooltipShadow.innerHTML = "";
  try {
    window.getSelection()?.removeAllRanges();
  } catch {
    /* ignore */
  }
}

function showTooltip(x: number, y: number, text: string) {
  ensureTooltip();
  if (!tooltipShadow) return;
  const f = feature();
  const buttons: string[] = [];
  if (f.saveHighlight) {
    buttons.push(
      `<button data-action="save" class="btn primary">Save Highlight</button>`
    );
  }
  if (f.aiSummary) {
    buttons.push(
      `<button data-action="summarize" class="btn">AI Summary</button>`
    );
  }
  if (f.summarizePage) {
    buttons.push(
      `<button data-action="page" class="btn">Summarize Page</button>`
    );
  }
  if (!buttons.length) return;

  tooltipShadow.innerHTML = `
    <style>
      :host { all: initial; }
      .tip {
        position: fixed;
        left: ${Math.min(x, window.innerWidth - 340)}px;
        top: ${Math.min(y, window.innerHeight - 56)}px;
        display: flex; gap: 6px; flex-wrap: wrap;
        padding: 8px; border-radius: 12px;
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(10px);
        box-shadow: 0 10px 30px rgba(15,23,42,0.18);
        border: 1px solid rgba(148,163,184,0.35);
        font-family: "Source Sans 3", Segoe UI, sans-serif;
      }
      .tip.dark {
        background: rgba(30,41,59,0.94);
        border-color: rgba(71,85,105,0.6);
      }
      .btn {
        border: 0; border-radius: 8px; padding: 6px 10px;
        font-size: 12px; font-weight: 600; cursor: pointer;
        background: #e2e8f0; color: #0f172a;
      }
      .btn.primary { background: #3b82f6; color: white; }
      .btn:hover { filter: brightness(0.96); }
      .tip.dark .btn { background: #475569; color: #f8fafc; }
      .tip.dark .btn.primary { background: #3b82f6; }
    </style>
    <div class="tip ${document.documentElement.dataset.akaTheme === "dark" ? "dark" : ""}">
      ${buttons.join("")}
    </div>
  `;

  tooltipShadow.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      void onAction(action ?? "", text);
    });
  });
}

async function onAction(action: string, text: string) {
  hideTooltip();
  if (!isContextValid()) return;

  if (action === "save") {
    try {
      await sendMessage({
        type: MessageType.SAVE_HIGHLIGHT,
        text,
        url: location.href,
        title: document.title,
      });
      toast("Highlight saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Save failed");
    }
    return;
  }

  if (action === "summarize") {
    // Short selections → explain (Meaning / On this page / Why it matters).
    // Longer passages → summarize, still centered on the exact selection.
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const aiAction: AIAction = wordCount <= 12 ? "explain" : "summarize";
    let pageContext = extractPageContextForTerm(text, 2_500);
    if (pageContext && isChromeText(pageContext)) pageContext = "";
    openModal({
      title: truncateLabel(text, 56),
      focusLabel: text,
      text,
      selectedText: text,
      pageContext: pageContext || undefined,
      action: aiAction,
    });
    return;
  }

  if (action === "page") {
    const pageText = extractPageContent(40_000) || text;
    openModal({
      title: "Page Summary",
      focusLabel: document.title || "This page",
      text: pageText,
      action: "page_summary",
    });
  }
}

function openModal(opts: {
  title: string;
  focusLabel: string;
  text: string;
  selectedText?: string;
  pageContext?: string;
  action: "summarize" | "explain" | "page_summary";
}) {
  const { title, focusLabel, text, selectedText, pageContext, action } = opts;
  closeModal();
  modalHost = document.createElement("div");
  modalHost.style.all = "initial";
  modalHost.style.position = "fixed";
  modalHost.style.inset = "0";
  modalHost.style.zIndex = "2147483647";
  const shadow = modalHost.attachShadow({ mode: "open" });
  document.documentElement.appendChild(modalHost);

  const requestId = crypto.randomUUID();
  const showFocus =
    action === "summarize" || action === "explain" || action === "page_summary";
  shadow.innerHTML = `
    <style>
      .backdrop {
        position: fixed; inset: 0; background: rgba(15,23,42,0.45);
        display: grid; place-items: center; padding: 24px;
        font-family: "Source Sans 3", Segoe UI, sans-serif;
      }
      .card {
        width: min(560px, 100%); max-height: min(70vh, 640px);
        overflow: auto; border-radius: 16px; padding: 20px;
        background: #f8fafc; color: #0f172a;
        box-shadow: 0 20px 50px rgba(15,23,42,0.25);
      }
      .card.dark { background: #1e293b; color: #e2e8f0; }
      .header {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px; margin-bottom: 6px;
      }
      h2 { margin: 0; flex: 1; font-size: 18px; line-height: 1.3; word-break: break-word; }
      .focus {
        display: ${showFocus ? "block" : "none"};
        margin: 0 0 10px; padding: 8px 10px; border-radius: 8px;
        background: #e2e8f0; color: #0f172a; font-size: 13px; font-weight: 600;
        line-height: 1.4; white-space: pre-wrap; word-break: break-word;
      }
      .card.dark .focus { background: #334155; color: #e2e8f0; }
      .meta { font-size: 12px; opacity: 0.7; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .body { line-height: 1.6; font-size: 14px; word-break: break-word; }
      .body h1, .body h2, .body h3, .body h4 {
        margin: 12px 0 6px 0; font-size: 15px; font-weight: 700; color: inherit;
      }
      .body h1 { font-size: 17px; }
      .body h2 { font-size: 16px; }
      .body p { margin: 0 0 10px 0; }
      .body p:last-child { margin-bottom: 0; }
      .body ul, .body ol { margin: 6px 0 10px 0; padding-left: 22px; }
      .body li { margin-bottom: 4px; }
      .body code {
        background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px;
      }
      .card.dark .body code { background: rgba(255,255,255,0.12); color: #f1f5f9; }
      .body pre {
        background: rgba(0,0,0,0.05); padding: 12px; border-radius: 8px;
        overflow-x: auto; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; margin: 10px 0;
      }
      .card.dark .body pre { background: rgba(0,0,0,0.35); color: #f1f5f9; }
      .body strong { font-weight: 700; color: inherit; }
      .body blockquote {
        border-left: 3px solid #3b82f6; padding-left: 12px; margin: 10px 0; opacity: 0.9;
      }
      .actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
      button {
        border: 0; border-radius: 8px; padding: 8px 12px;
        font-weight: 600; cursor: pointer; background: #e2e8f0; color: #0f172a;
      }
      button.primary { background: #3b82f6; color: white; }
      button.save { background: #fbbf24; color: #0f172a; }
      button.accept { background: #059669; color: white; }
      button.reject { background: #64748b; color: white; }
      button.close-x {
        flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; padding: 0;
        border: 1px solid #cbd5e1; background: #f1f5f9; color: #64748b;
        font-size: 18px; line-height: 1; font-weight: 500;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      button.close-x:hover {
        background: rgba(244,63,94,0.12); border-color: rgba(244,63,94,0.35); color: #e11d48;
      }
      .card.dark button.close-x {
        background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1);
        color: rgba(148,163,184,0.85);
      }
      .card.dark button.close-x:hover {
        background: rgba(244,63,94,0.15); border-color: rgba(244,63,94,0.3); color: #f43f5e;
      }
      button:disabled { opacity: 0.5; cursor: default; }
      .feedback { display: none; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
      .feedback.visible { display: flex; }
      .feedback-note { font-size: 12px; opacity: 0.7; display: none; }
      .feedback-note.visible { display: inline; }
    </style>
    <div class="backdrop">
      <div class="card ${document.documentElement.dataset.akaTheme === "dark" ? "dark" : ""}">
        <div class="header">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" class="close-x" id="close" aria-label="Close" title="Close">&times;</button>
        </div>
        <div class="focus" id="focus">${escapeHtml(focusLabel)}</div>
        <div class="meta" id="meta">Generating…</div>
        <div class="body" id="body"></div>
        <div class="feedback" id="feedback">
          <button class="accept" id="accept">Accept</button>
          <button class="reject" id="reject">Reject</button>
          <span class="feedback-note" id="feedback-note">Feedback saved</span>
        </div>
        <div class="actions">
          <button class="save" id="save">Save</button>
          <button class="primary" id="copy">Copy</button>
        </div>
      </div>
    </div>
  `;

  const bodyEl = shadow.getElementById("body")!;
  const metaEl = shadow.getElementById("meta")!;
  const feedbackEl = shadow.getElementById("feedback")!;
  const feedbackNote = shadow.getElementById("feedback-note")!;
  const acceptBtn = shadow.getElementById("accept") as HTMLButtonElement;
  const rejectBtn = shadow.getElementById("reject") as HTMLButtonElement;
  const saveBtn = shadow.getElementById("save") as HTMLButtonElement;
  let rawMarkdown = "";
  let voted = false;
  let saved = false;

  const copyPayload = () => {
    const body = (rawMarkdown || bodyEl.textContent || "").trim();
    const head = (selectedText || focusLabel || "").trim();
    if (head && body) return `${head}\n\n${body}`;
    return body || head;
  };

  shadow.getElementById("close")?.addEventListener("click", closeModal);
  shadow.querySelector(".backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  shadow.getElementById("copy")?.addEventListener("click", () => {
    void navigator.clipboard.writeText(copyPayload());
    toast("Copied");
  });

  saveBtn.addEventListener("click", () => {
    if (saved) return;
    const payload = copyPayload().trim();
    if (!payload) {
      toast("Nothing to save yet");
      return;
    }
    void (async () => {
      saveBtn.disabled = true;
      try {
        await sendMessage({
          type: MessageType.SAVE_HIGHLIGHT,
          text: payload,
          url: location.href,
          title: document.title,
        });
        saved = true;
        saveBtn.textContent = "Saved!";
        toast("Highlight saved");
      } catch (e) {
        saveBtn.disabled = false;
        toast(e instanceof Error ? e.message : "Save failed");
      }
    })();
  });

  async function vote(accepted: boolean) {
    if (voted) return;
    const preview = (rawMarkdown || bodyEl.textContent || "").slice(0, 200);
    if (!preview.trim()) return;
    voted = true;
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      await sendMessage({
        type: MessageType.PERSONALIZATION_FEEDBACK,
        accepted,
        action,
        textPreview: preview,
      });
      feedbackNote.classList.add("visible");
      toast(accepted ? "Accepted" : "Rejected");
    } catch (e) {
      voted = false;
      acceptBtn.disabled = false;
      rejectBtn.disabled = false;
      toast(e instanceof Error ? e.message : "Feedback failed");
    }
  }

  acceptBtn.addEventListener("click", () => void vote(true));
  rejectBtn.addEventListener("click", () => void vote(false));

  const onChunk = (msg: {
    type?: string;
    requestId?: string;
    chunk?: string;
    envelope?: { provider?: string; latencyMs?: number; cached?: boolean };
    error?: string;
  }) => {
    if (msg.requestId !== requestId) return;
    if (msg.type === MessageType.AI_STREAM_CHUNK && msg.chunk) {
      if (!rawMarkdown.length) {
        metaEl.textContent = "Streaming…";
      }
      rawMarkdown += msg.chunk;
      // Drop Wikipedia chrome dumps if the model echoes nav soup
      if (isChromeText(rawMarkdown) && rawMarkdown.length > 120) {
        rawMarkdown =
          "Could not produce a clean summary for this selection. Try again.";
        bodyEl.innerHTML = `<p>${escapeHtml(rawMarkdown)}</p>`;
        metaEl.textContent = "Filtered page chrome";
        return;
      }
      try {
        bodyEl.innerHTML = marked.parse(rawMarkdown, { async: false }) as string;
      } catch {
        bodyEl.textContent = rawMarkdown;
      }
    }
    if (msg.type === MessageType.AI_STREAM_DONE) {
      if (msg.error) {
        metaEl.textContent = msg.error;
      } else if (msg.envelope) {
        metaEl.textContent = `${msg.envelope.latencyMs ?? 0}ms`;
        feedbackEl.classList.add("visible");
      } else {
        metaEl.textContent = "Done";
        feedbackEl.classList.add("visible");
      }
      chrome.runtime.onMessage.removeListener(onChunk as never);
    }
  };
  chrome.runtime.onMessage.addListener(onChunk as never);

  void sendMessage({
    type: MessageType.AI_STREAM,
    requestId,
    action,
    text,
    selectedText,
    pageContext,
    pageTitle: document.title,
    url: location.href,
  }).catch((e) => {
    metaEl.textContent = e instanceof Error ? e.message : "AI failed";
  });
}

function closeModal() {
  modalHost?.remove();
  modalHost = null;
}

function toast(message: string) {
  const el = document.createElement("div");
  el.textContent = message;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "2147483647",
    background: "#0f172a",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: "10px",
    fontFamily: "Segoe UI, sans-serif",
    fontSize: "13px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  } as CSSStyleDeclaration);
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function onMouseUp(e: MouseEvent) {
  if (!isContextValid()) return;
  const path = e.composedPath();
  if (isKeywordUiTarget(path as EventTarget[])) return;
  if (path.some((n) => n === tooltipHost || n === modalHost)) return;

  const sel = window.getSelection();
  const text = sel?.toString().trim() ?? "";
  if (!text || text.length < 2) {
    hideTooltip();
    return;
  }
  showTooltip(e.clientX + 8, e.clientY + 8, text);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    hideTooltip();
    closeModal();
    onKeywordEscape();
  }
}

function applyTheme() {
  const pref = prefs?.theme ?? "light";
  let resolved = pref;
  if (pref === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  document.documentElement.dataset.akaTheme = resolved;
}

function refreshPageFeatures() {
  applyTheme();
  refreshKeywords(feature());
}

async function boot() {
  if (!isContextValid()) return;
  // Drop legacy keyword caches that may store Wikipedia chrome snippets.
  try {
    chrome.storage.local.remove(
      ["hs_keyword_cache_v1", "aka_keyword_cache_v1"],
      () => {
        try {
          void chrome.runtime?.lastError;
        } catch {
          /* ignore */
        }
      }
    );
  } catch {
    /* ignore */
  }
  try {
    await loadPrefs();
  } catch {
    prefs = null;
  }
  refreshPageFeatures();
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("keydown", onKeyDown);

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      try {
        if (area !== "local") return;
        if (changes.theme || changes.hs_feature_prefs) {
          void loadPrefs().then(() => refreshPageFeatures());
        }
      } catch {
        /* outer try/catch does not catch callback exceptions */
      }
    });
  } catch {
    /* ignore */
  }
}

void boot();

let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    teardownKeywords();
    refreshKeywords(feature());
  }
}, 1500);
