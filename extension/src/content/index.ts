import { MessageType, sendMessage } from "../shared/messaging/protocol";
import { escapeHtml } from "../shared/sanitize";
import type { FeaturePrefs, UserPrefs } from "../shared/types";
import { DEFAULT_FEATURE_PREFS } from "../shared/types";
import {
  isKeywordUiTarget,
  onKeywordEscape,
  refreshKeywords,
  teardownKeywords,
} from "./keywords";

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
    openModal("AI Summary", text, "summarize");
    return;
  }

  if (action === "page") {
    const pageText = document.body?.innerText?.slice(0, 40_000) ?? text;
    openModal("Page Summary", pageText, "page_summary");
  }
}

function openModal(
  title: string,
  text: string,
  action: "summarize" | "page_summary"
) {
  closeModal();
  modalHost = document.createElement("div");
  modalHost.style.all = "initial";
  modalHost.style.position = "fixed";
  modalHost.style.inset = "0";
  modalHost.style.zIndex = "2147483647";
  const shadow = modalHost.attachShadow({ mode: "open" });
  document.documentElement.appendChild(modalHost);

  const requestId = crypto.randomUUID();
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
      h2 { margin: 0 0 8px; font-size: 18px; }
      .meta { font-size: 12px; opacity: 0.7; margin-bottom: 12px; }
      .body { white-space: pre-wrap; line-height: 1.5; font-size: 14px; }
      .actions { display: flex; gap: 8px; margin-top: 16px; }
      button {
        border: 0; border-radius: 8px; padding: 8px 12px;
        font-weight: 600; cursor: pointer; background: #e2e8f0; color: #0f172a;
      }
      button.primary { background: #3b82f6; color: white; }
    </style>
    <div class="backdrop">
      <div class="card ${document.documentElement.dataset.akaTheme === "dark" ? "dark" : ""}">
        <h2>${escapeHtml(title)}</h2>
        <div class="meta" id="meta">Generating…</div>
        <div class="body" id="body"></div>
        <div class="actions">
          <button class="primary" id="copy">Copy</button>
          <button id="close">Close</button>
        </div>
      </div>
    </div>
  `;

  const bodyEl = shadow.getElementById("body")!;
  const metaEl = shadow.getElementById("meta")!;
  shadow.getElementById("close")?.addEventListener("click", closeModal);
  shadow.querySelector(".backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  shadow.getElementById("copy")?.addEventListener("click", () => {
    void navigator.clipboard.writeText(bodyEl.textContent ?? "");
    toast("Copied");
  });

  const onChunk = (msg: {
    type?: string;
    requestId?: string;
    chunk?: string;
    envelope?: { provider?: string; latencyMs?: number };
    error?: string;
  }) => {
    if (msg.requestId !== requestId) return;
    if (msg.type === MessageType.AI_STREAM_CHUNK && msg.chunk) {
      bodyEl.textContent = (bodyEl.textContent ?? "") + msg.chunk;
    }
    if (msg.type === MessageType.AI_STREAM_DONE) {
      if (msg.error) {
        metaEl.textContent = msg.error;
      } else if (msg.envelope) {
        metaEl.textContent = `${msg.envelope.provider ?? "ai"} · ${msg.envelope.latencyMs ?? 0}ms`;
      } else {
        metaEl.textContent = "Done";
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
