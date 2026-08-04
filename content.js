// content.js - Website Highlight Saver Content Script
// Storage: Convex cloud + chrome.storage.local (fallback)
const CONVEX_HTTP_URL = 'https://ardent-partridge-610.convex.site';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Groq API key is stored in chrome.storage.local as 'groq_api_key' (set by the popup).
// Set it once via the extension popup settings or chrome.storage.local.set({ groq_api_key: 'gsk_...' })


// ── Keyword highlight state ─────────────────────────────────────────────────
const HS_OWN_IDS = new Set([
  'highlight-saver-tooltip-root',
  'hs-ai-modal-root',
  'hs-keyword-tile-root',
  'hs-keyword-popup-root'
]);
/* Classic sticky-note pastels — flat/matte paper, readable text */
const KW_COLORS = [
  { bg: '#fff59d', border: '#f0e68c', text: '#3d3420' }, /* pale yellow */
  { bg: '#f8bbd0', border: '#f0a8c0', text: '#4a2030' }, /* pale pink */
  { bg: '#bbdefb', border: '#a8d0f0', text: '#1e3048' }, /* pale blue */
  { bg: '#c8e6c9', border: '#b5d8b8', text: '#1e3a28' }, /* pale green */
  { bg: '#ffe0b2', border: '#f0d0a0', text: '#4a3020' }, /* pale orange */
  { bg: '#e1bee7', border: '#d0aee0', text: '#3a2048' }, /* pale lavender */
  { bg: '#b2dfdb', border: '#a0d0cc', text: '#1e3a38' }, /* pale mint */
  { bg: '#ffccbc', border: '#f0b8a8', text: '#4a2820' }  /* pale peach */
];
/** @type {Map<string, { term: string, summary: string, sections: Array<{title: string, body: string}>, colorIndex: number }>} */
const keywordStore = new Map();
let keywordMarksActive = false;

function isHsUiTarget(path) {
  return path.some((n) => n && n.id && HS_OWN_IDS.has(n.id));
}

// ── Dismiss tooltip on outside click ────────────────────────────────────────
document.addEventListener('mousedown', (e) => {
  const existing = document.getElementById('highlight-saver-tooltip-root');
  if (existing) {
    const path = e.composedPath();
    if (!path.includes(existing)) {
      existing.remove();
      window.getSelection()?.removeAllRanges();
    }
  }
});

// ── Show tooltip on text selection ──────────────────────────────────────────
document.addEventListener('mouseup', (e) => {
  // Capture composedPath SYNCHRONOUSLY — Chrome returns [] if called inside setTimeout
  const eventPath = e.composedPath();

  // Don't trigger inside our injected UI or keyword marks
  if (isHsUiTarget(eventPath)) return;
  if (eventPath.some((n) => n?.classList?.contains?.('hs-kw-mark'))) return;

  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString().trim();
    if (!text) return;

    const existing = document.getElementById('highlight-saver-tooltip-root');
    if (existing && eventPath.includes(existing)) return;
    if (existing) existing.remove();

    if (!hsPrefs.tooltipSave && !hsPrefs.tooltipAiSummary && !hsPrefs.tooltipSummarizePage) return;

    const contextValid = isContextValid();
    showTooltip(selection, text, contextValid);
  }, 10);
});

// ── ESC closes explanation popup / AI modal / tooltip ───────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const kwPopup = document.getElementById('hs-keyword-popup-root');
  if (kwPopup) {
    e.preventDefault();
    closeKeywordPopup();
    return;
  }
  const modal = document.getElementById('hs-ai-modal-root');
  if (modal) {
    e.preventDefault();
    if (typeof modal._hsClose === 'function') modal._hsClose();
    else modal.remove();
    return;
  }
  const tip = document.getElementById('highlight-saver-tooltip-root');
  if (tip) {
    tip.remove();
    window.getSelection()?.removeAllRanges();
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function isContextValid() {
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdownInline(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Headings (##)
  html = html.replace(/^#{1,3}\s+(.+)$/gm, '<strong style="font-size:14px;display:block;margin:10px 0 4px">$1</strong>');
  // Bullet lines
  const lines = html.split('\n');
  let inList = false;
  const processed = lines.map(line => {
    const t = line.trim();
    if (t.startsWith('- ') || t.startsWith('* ') || t.startsWith('• ')) {
      const content = t.substring(2).trim();
      if (!inList) { inList = true; return '<ul><li>' + content + '</li>'; }
      return '<li>' + content + '</li>';
    } else {
      let r = '';
      if (inList) { inList = false; r += '</ul>'; }
      if (t) r += '<p>' + t + '</p>';
      return r;
    }
  });
  if (inList) processed.push('</ul>');
  return processed.join('');
}

// ── Shared UI theme (matches popup cloudy day / night / system) ──────────────
let hsThemePref = 'light'; // light | dark | system
let hsResolvedTheme = 'light'; // light | dark after resolving system

function getSystemTheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch (_) {
    return 'light';
  }
}

function resolveHsTheme(pref) {
  const p = pref === 'dark' || pref === 'system' ? pref : 'light';
  return p === 'system' ? getSystemTheme() : p;
}

function getHsTheme() {
  return hsResolvedTheme === 'dark' ? 'dark' : 'light';
}

function setHsThemePref(pref, { silent } = {}) {
  hsThemePref = pref === 'dark' || pref === 'system' ? pref : 'light';
  hsResolvedTheme = resolveHsTheme(hsThemePref);
  if (!silent) applyHsThemeToInjectedUi();
}

function applyHsThemeToInjectedUi() {
  const resolved = getHsTheme();
  const tipHost = document.getElementById('highlight-saver-tooltip-root');
  if (tipHost?.shadowRoot) {
    const tip = tipHost.shadowRoot.querySelector('.tooltip-container');
    if (tip) tip.setAttribute('data-theme', resolved);
  }
  const tileHost = document.getElementById('hs-keyword-tile-root');
  if (tileHost?.shadowRoot) {
    const tile = tileHost.shadowRoot.querySelector('.tile');
    if (tile) tile.setAttribute('data-theme', resolved);
  }
  const kwPopup = document.getElementById('hs-keyword-popup-root');
  if (kwPopup?.shadowRoot) {
    const card = kwPopup.shadowRoot.querySelector('.card');
    if (card) card.setAttribute('data-theme', resolved);
  }
}

function loadHsTheme(cb) {
  if (!isContextValid()) {
    setHsThemePref('light', { silent: true });
    applyHsThemeToInjectedUi();
    if (cb) cb(getHsTheme());
    return;
  }
  try {
    chrome.storage.local.get({ theme: 'light' }, (result) => {
      try {
        if (chrome.runtime?.lastError) setHsThemePref('light', { silent: true });
        else setHsThemePref(result?.theme || 'light', { silent: true });
      } catch (_) {
        setHsThemePref('light', { silent: true });
      }
      applyHsThemeToInjectedUi();
      if (cb) cb(getHsTheme());
    });
  } catch (_) {
    setHsThemePref('light', { silent: true });
    applyHsThemeToInjectedUi();
    if (cb) cb(getHsTheme());
  }
}

loadHsTheme();
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes.theme) return;
    setHsThemePref(changes.theme.newValue || 'light');
  });
} catch (_) { /* ignore */ }

try {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    if (hsThemePref !== 'system') return;
    hsResolvedTheme = getSystemTheme();
    applyHsThemeToInjectedUi();
  };
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onSystemChange);
  else if (typeof mql.addListener === 'function') mql.addListener(onSystemChange);
} catch (_) { /* ignore */ }

// ── Feature preferences (tile, sticky notes, tooltip actions) ────────────────
const HS_PREFS_KEY = 'hs_feature_prefs';
const HS_PREFS_DEFAULTS = {
  tileEnabled: true,
  stickyNotesEnabled: true,
  tooltipSave: true,
  tooltipAiSummary: true,
  tooltipSummarizePage: true
};

/** @type {typeof HS_PREFS_DEFAULTS} */
let hsPrefs = { ...HS_PREFS_DEFAULTS };

function normalizeHsPrefs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    tileEnabled: src.tileEnabled !== false,
    stickyNotesEnabled: src.stickyNotesEnabled !== false,
    tooltipSave: src.tooltipSave !== false,
    tooltipAiSummary: src.tooltipAiSummary !== false,
    tooltipSummarizePage: src.tooltipSummarizePage !== false
  };
}

function saveHsPrefs(partial, cb) {
  hsPrefs = normalizeHsPrefs({ ...hsPrefs, ...partial });
  if (!isContextValid()) {
    if (cb) cb(hsPrefs);
    return;
  }
  try {
    chrome.storage.local.set({ [HS_PREFS_KEY]: hsPrefs }, () => {
      try { void chrome.runtime?.lastError; } catch (_) { /* ignore */ }
      if (cb) cb(hsPrefs);
    });
  } catch (_) {
    if (cb) cb(hsPrefs);
  }
}

function loadHsPrefs(cb) {
  if (!isContextValid()) {
    hsPrefs = { ...HS_PREFS_DEFAULTS };
    if (cb) cb(hsPrefs);
    return;
  }
  try {
    chrome.storage.local.get({ [HS_PREFS_KEY]: HS_PREFS_DEFAULTS }, (result) => {
      try {
        if (chrome.runtime?.lastError) hsPrefs = { ...HS_PREFS_DEFAULTS };
        else hsPrefs = normalizeHsPrefs(result?.[HS_PREFS_KEY]);
      } catch (_) {
        hsPrefs = { ...HS_PREFS_DEFAULTS };
      }
      if (cb) cb(hsPrefs);
    });
  } catch (_) {
    hsPrefs = { ...HS_PREFS_DEFAULTS };
    if (cb) cb(hsPrefs);
  }
}

function clearKeywordMarksOnly() {
  document.querySelectorAll('mark.hs-kw-mark').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(el.textContent || ''), el);
    parent.normalize();
  });
  keywordMarksActive = false;
}

function applyFeaturePrefsToPage() {
  // Tile visibility
  const tileHost = document.getElementById('hs-keyword-tile-root');
  if (hsPrefs.tileEnabled) {
    if (!tileHost) ensureKeywordTile();
    else {
      tileHost.style.display = '';
      if (typeof tileHost._hsSyncPrefsUi === 'function') tileHost._hsSyncPrefsUi();
    }
  } else if (tileHost) {
    tileHost.style.display = 'none';
    closeKeywordPopup();
  }

  // Sticky note marks
  if (!hsPrefs.stickyNotesEnabled) {
    clearKeywordMarksOnly();
  } else if (keywordStore.size > 0 && !document.querySelector('mark.hs-kw-mark')) {
    const applied = applyKeywordHighlights();
    keywordMarksActive = applied > 0;
  }
}

loadHsPrefs(() => applyFeaturePrefsToPage());
try {
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[HS_PREFS_KEY]) return;
    hsPrefs = normalizeHsPrefs(changes[HS_PREFS_KEY].newValue);
    applyFeaturePrefsToPage();
  });
} catch (_) { /* ignore */ }

function getTooltipStyles() {
  return `
    :host { all: initial; }
    .tooltip-container {
      --tip-bg: rgba(255, 255, 255, 0.84);
      --tip-border: rgba(120, 150, 180, 0.35);
      --tip-shadow: 0 12px 32px rgba(70, 110, 150, 0.18), 0 2px 8px rgba(70, 110, 150, 0.08);
      --tip-divider: rgba(90, 120, 150, 0.22);
      --tip-close: #7a92a8;
      --tip-close-hover: #e11d48;
      --save-bg: linear-gradient(135deg, #6aa3c7, #4f86ad);
      --save-shadow: 0 4px 12px rgba(79, 134, 173, 0.35);
      --ai-bg: linear-gradient(135deg, #7eb8d8, #5b93b8);
      --ai-shadow: 0 4px 12px rgba(91, 147, 184, 0.32);
      --page-bg: linear-gradient(135deg, #6bb8a0, #4a9a82);
      --page-shadow: 0 4px 12px rgba(74, 154, 130, 0.32);
      pointer-events: auto;
      font-family: "Outfit", "Segoe UI", system-ui, -apple-system, sans-serif;
      animation: tooltip-fade-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      align-items: center;
      gap: 5px;
      background: var(--tip-bg);
      backdrop-filter: blur(18px) saturate(1.15);
      -webkit-backdrop-filter: blur(18px) saturate(1.15);
      border: 1px solid var(--tip-border);
      padding: 5px 6px 5px 5px;
      border-radius: 18px;
      box-shadow: var(--tip-shadow);
      user-select: none;
    }
    .tooltip-container[data-theme="dark"] {
      --tip-bg: rgba(14, 22, 40, 0.9);
      --tip-border: rgba(160, 190, 230, 0.16);
      --tip-shadow: 0 14px 36px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.25);
      --tip-divider: rgba(160, 190, 230, 0.16);
      --tip-close: #9db0c8;
      --tip-close-hover: #fb7185;
      --save-bg: linear-gradient(135deg, #6b93b8, #4d7094);
      --save-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      --ai-bg: linear-gradient(135deg, #7ea8cc, #5a7fa3);
      --ai-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      --page-bg: linear-gradient(135deg, #5a9e8a, #3f7d6c);
      --page-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
    @keyframes tooltip-fade-in {
      from { opacity: 0; transform: translateY(8px) scale(0.94); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .btn {
      border: none;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.01em;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
      outline: none;
      white-space: nowrap;
      color: #fff;
    }
    .btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
    .btn:active { transform: translateY(0); filter: none; }
    .btn-save { background: var(--save-bg); box-shadow: var(--save-shadow); }
    .btn-save.warning {
      background: rgba(244, 63, 94, 0.12);
      color: #e11d48;
      border: 1px solid rgba(244, 63, 94, 0.28);
      box-shadow: none;
    }
    .btn-save.warning:hover {
      background: rgba(244, 63, 94, 0.2);
      border-color: rgba(244, 63, 94, 0.45);
    }
    .btn-ai { background: var(--ai-bg); box-shadow: var(--ai-shadow); }
    .btn-page { background: var(--page-bg); box-shadow: var(--page-shadow); }
    .divider {
      width: 1px; height: 18px; background: var(--tip-divider);
      flex-shrink: 0; margin: 0 1px;
    }
    .close-btn {
      background: transparent; border: none; color: var(--tip-close);
      cursor: pointer; width: 28px; height: 28px; border-radius: 10px;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
      transition: color 0.15s, background 0.15s; outline: none; line-height: 1;
    }
    .close-btn:hover { color: var(--tip-close-hover); background: rgba(225, 29, 72, 0.1); }
    .icon { display:inline-block; width:13px; height:13px; fill:currentColor; flex-shrink:0; }
  `;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
function showTooltip(selection, text, contextValid) {
  try {
    if (selection.rangeCount === 0) return;
    const showSave = hsPrefs.tooltipSave;
    const showAi = hsPrefs.tooltipAiSummary;
    const showPage = hsPrefs.tooltipSummarizePage;
    if (!showSave && !showAi && !showPage) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const existingTip = document.getElementById('highlight-saver-tooltip-root');
    if (existingTip) existingTip.remove();

    const container = document.createElement('div');
    container.id = 'highlight-saver-tooltip-root';
    container.style.cssText = 'position:absolute;z-index:2147483647;';

    const shadow = container.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = getTooltipStyles();
    shadow.appendChild(style);

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip-container';
    tooltip.setAttribute('data-theme', getHsTheme());

    const appendDivider = () => {
      if (!tooltip.children.length) return;
      const d = document.createElement('div');
      d.className = 'divider';
      tooltip.appendChild(d);
    };

    let saveBtn = null;
    if (showSave) {
      saveBtn = document.createElement('button');
      if (contextValid) {
        saveBtn.className = 'btn btn-save';
        saveBtn.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          Save
        `;
      } else {
        saveBtn.className = 'btn btn-save warning';
        saveBtn.title = 'Click to refresh and re-enable';
        saveBtn.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24" style="fill:#e11d48"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          Refresh
        `;
      }
      appendDivider();
      tooltip.appendChild(saveBtn);
    }

    let aiBtn = null;
    if (showAi) {
      aiBtn = document.createElement('button');
      aiBtn.className = 'btn btn-ai';
      aiBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>
        AI Summary
      `;
      appendDivider();
      tooltip.appendChild(aiBtn);
    }

    let pageBtn = null;
    if (showPage) {
      pageBtn = document.createElement('button');
      pageBtn.className = 'btn btn-page';
      pageBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        Summarize Page
      `;
      appendDivider();
      tooltip.appendChild(pageBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.title = 'Close';
    tooltip.appendChild(closeBtn);
    shadow.appendChild(tooltip);
    document.body.appendChild(container);

    loadHsTheme((theme) => {
      tooltip.setAttribute('data-theme', theme);
    });

    const tooltipWidth = tooltip.offsetWidth || 320;
    const tooltipHeight = tooltip.offsetHeight || 40;
    let top = rect.top + window.scrollY - tooltipHeight - 10;
    let left = rect.left + window.scrollX + (rect.width - tooltipWidth) / 2;
    if (top < window.scrollY) top = rect.bottom + window.scrollY + 10;
    if (left < 10) left = 10;
    else if (left + tooltipWidth > document.documentElement.clientWidth + window.scrollX - 10)
      left = document.documentElement.clientWidth + window.scrollX - tooltipWidth - 10;
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (!contextValid) { window.location.reload(); return; }
        doSaveHighlight(text, saveBtn, () => {
          setTimeout(() => {
            container.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            container.style.opacity = '0';
            container.style.transform = 'translateY(-4px) scale(0.95)';
            window.getSelection()?.removeAllRanges();
            setTimeout(() => container.remove(), 250);
          }, 900);
        });
      });
    }

    if (aiBtn) {
      aiBtn.addEventListener('click', () => {
        container.remove();
        window.getSelection()?.removeAllRanges();
        showAiSummaryModal(text, contextValid, false);
      });
    }

    if (pageBtn) {
      pageBtn.addEventListener('click', () => {
        container.remove();
        window.getSelection()?.removeAllRanges();
        const pageText = extractPageContent();
        showAiSummaryModal(pageText, contextValid, true);
      });
    }

    closeBtn.addEventListener('click', () => {
      window.getSelection()?.removeAllRanges();
      container.remove();
    });
  } catch (err) {
    console.error('[Highlight Saver] showTooltip error:', err);
  }
}

// ── Extract main webpage content ────────────────────────────────────────────
function extractPageContent() {
  const article = document.querySelector('article') || document.querySelector('main') || document.body;
  if (!article) return document.body.innerText || '';
  
  const clone = article.cloneNode(true);
  clone.querySelectorAll('script, style, nav, footer, header, svg, iframe, noscript').forEach(el => el.remove());
  
  let text = clone.innerText || clone.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 4000) {
    text = text.substring(0, 4000) + '... [truncated]';
  }
  return text;
}

// ── Listen for messages from popup ──────────────────────────────────────────
chrome.runtime?.onMessage?.addListener((request) => {
  if (request?.action === 'SUMMARIZE_PAGE') {
    const pageText = extractPageContent();
    showAiSummaryModal(pageText, isContextValid(), true);
  }
});


// ── Save highlight logic (reusable) ─────────────────────────────────────────
function doSaveHighlight(text, feedbackEl, onSaved) {
  if (!isContextValid()) { window.location.reload(); return; }

  const newHighlight = {
    id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    text: text,
    url: window.location.href,
    title: document.title || window.location.hostname,
    timestamp: Date.now()
  };

  try {
    chrome.storage.local.get({ highlights: [] }, (result) => {
      try {
        if (chrome.runtime?.lastError) {
          console.error('[Highlight Saver] get error:', chrome.runtime.lastError.message);
          return;
        }
        const highlights = (result && result.highlights) ? result.highlights : [];
        highlights.unshift(newHighlight);

        chrome.storage.local.set({ highlights }, () => {
          try {
            if (chrome.runtime?.lastError) {
              console.error('[Highlight Saver] set error:', chrome.runtime.lastError.message);
              return;
            }

            console.log('[Highlight Saver] Saved locally:', newHighlight);

            // Sync to Convex cloud (fire-and-forget)
            (async function syncToConvex() {
              try {
                const stored = await new Promise(r => chrome.storage.local.get(['session_token'], r));
                const token = stored.session_token;
                if (!token) { console.warn('[Highlight Saver] No session token — Convex sync skipped.'); return; }
                const r = await fetch(`${CONVEX_HTTP_URL}/highlights`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify(newHighlight)
                });
                if (r.ok) console.log('[Highlight Saver] Synced to Convex.');
                else console.warn('[Highlight Saver] Convex sync failed:', r.status);
              } catch (err) {
                console.warn('[Highlight Saver] Convex sync error:', err.message);
              }
            })();

            // Visual feedback
            if (feedbackEl) {
              feedbackEl.innerHTML = `
                <svg style="display:inline-block;width:13px;height:13px;fill:#10b981" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                Saved!
              `;
              feedbackEl.style.cssText += 'background:rgba(16,185,129,0.14);color:#10b981;border:1px solid rgba(16,185,129,0.3);box-shadow:none;';
              feedbackEl.disabled = true;
            }

            if (onSaved) onSaved();
          } catch (e) { console.error('[Highlight Saver] set callback error:', e); }
        });
      } catch (e) { console.error('[Highlight Saver] get callback error:', e); }
    });
  } catch (err) {
    console.error('[Highlight Saver] doSaveHighlight error:', err);
  }
}

// ── Prompt Builder ───────────────────────────────────────────────────────────
function buildPrompt(text, isPageSummary = false) {
  if (isPageSummary) {
    return {
      title: `📄 Page Summary: "${document.title || 'Webpage'}"`,
      prompt: `You are an expert reading assistant. Please provide a structured summary of this entire webpage.
Structure your output into 3 clear sections:
1. **Overview**: Executive summary of what this webpage is about (2-3 clear sentences).
2. **Agenda & Main Topics**: Core sections, topics, or agenda points covered on this page.
3. **Key Takeaways**: Crucial conclusions and actionable insights.

Format your response cleanly using bold headings and bullet points.

Webpage Content:
"${text}"`
    };
  }

  const trimmed = (text || '').trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount <= 2) {
    return {
      title: `✦ Word Lookup: "${trimmed}"`,
      prompt: `The user highlighted the word/phrase: "${trimmed}"
Please provide:
1. **Definition** – What does it mean?
2. **Part of Speech** – (noun, verb, adjective, etc.)
3. **Etymology** – Brief origin
4. **Example Sentences** – 2 example sentences
5. **Synonyms** – 3-5 synonyms
Format using bold headings and bullet points.`
    };
  } else if (wordCount <= 10) {
    return {
      title: `✦ Phrase Explained`,
      prompt: `The user highlighted this phrase: "${trimmed}"
Please explain:
1. **Meaning** – What does it mean?
2. **Context** – Where is it used?
3. **Example** – Example sentence
Format using bold headings and bullet points.`
    };
  } else {
    return {
      title: `AI Highlight Summary`,
      prompt: `Summarize this text highlighting the key points:\n\n"${trimmed}"`
    };
  }
}

// ── AI Summary In-Page Modal ─────────────────────────────────────────────────
function showAiSummaryModal(text, contextValid, isPageSummary = false) {

  // Remove any existing modal
  const existing = document.getElementById('hs-ai-modal-root');
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = 'hs-ai-modal-root';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';

  const shadow = host.attachShadow({ mode: 'open' });

  // ── Modal styles ─────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; }

    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      pointer-events: auto;
      animation: fade-in 0.2s ease;
    }
    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .modal {
      background: linear-gradient(145deg, rgba(15,23,42,0.98), rgba(20,28,50,0.98));
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 20px;
      box-shadow:
        0 25px 60px rgba(0,0,0,0.6),
        0 0 0 1px rgba(255,255,255,0.05),
        inset 0 1px 0 rgba(255,255,255,0.07);
      width: 100%;
      max-width: 560px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: modal-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      pointer-events: auto;
    }
    @keyframes modal-in {
      from { opacity: 0; transform: translateY(20px) scale(0.95); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ── Header ── */
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #0ea5e9, #6366f1);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .header-icon svg {
      width: 18px;
      height: 18px;
      fill: #fff;
    }
    .header-title {
      color: #f1f5f9;
      font-size: 14.5px;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.2;
    }
    .header-subtitle {
      color: rgba(148,163,184,0.8);
      font-size: 11px;
      font-weight: 400;
      margin-top: 1px;
    }
    .close-modal-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: rgba(148,163,184,0.8);
      cursor: pointer;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1;
      transition: all 0.15s;
      outline: none;
      flex-shrink: 0;
    }
    .close-modal-btn:hover {
      background: rgba(244,63,94,0.15);
      border-color: rgba(244,63,94,0.3);
      color: #f43f5e;
    }

    /* ── Selected text preview ── */
    .selected-preview {
      margin: 14px 20px 0;
      padding: 10px 14px;
      background: rgba(99,102,241,0.08);
      border: 1px solid rgba(99,102,241,0.18);
      border-radius: 10px;
      color: rgba(203,213,225,0.9);
      font-size: 12px;
      line-height: 1.5;
      max-height: 72px;
      overflow: hidden;
      position: relative;
      flex-shrink: 0;
    }
    .selected-preview::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 24px;
      background: linear-gradient(transparent, rgba(15,23,42,0.9));
      border-radius: 0 0 10px 10px;
    }
    .preview-label {
      font-size: 10px;
      font-weight: 600;
      color: rgba(99,102,241,0.9);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
    }

    /* ── Body ── */
    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      min-height: 120px;
      scrollbar-width: thin;
      scrollbar-color: rgba(99,102,241,0.3) transparent;
    }
    .modal-body::-webkit-scrollbar { width: 4px; }
    .modal-body::-webkit-scrollbar-track { background: transparent; }
    .modal-body::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 4px; }

    /* Loading skeleton */
    .skeleton-wrap { display: flex; flex-direction: column; gap: 10px; }
    .skeleton-line {
      background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 6px;
      height: 13px;
    }
    .skeleton-line.w-full  { width: 100%; }
    .skeleton-line.w-90    { width: 90%; }
    .skeleton-line.w-75    { width: 75%; }
    .skeleton-line.w-50    { width: 50%; }
    .skeleton-line.h-big   { height: 15px; }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .loading-label {
      color: rgba(99,102,241,0.7);
      font-size: 11.5px;
      font-weight: 500;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dot-pulse { display: inline-flex; gap: 3px; }
    .dot-pulse span {
      width: 4px; height: 4px;
      background: #6366f1;
      border-radius: 50%;
      animation: dot-anim 1.2s infinite;
    }
    .dot-pulse span:nth-child(2) { animation-delay: 0.2s; }
    .dot-pulse span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dot-anim {
      0%,80%,100% { transform: scale(0.7); opacity: 0.5; }
      40%          { transform: scale(1);   opacity: 1; }
    }

    /* AI result */
    .ai-result {
      color: #cbd5e1;
      font-size: 13.5px;
      line-height: 1.75;
    }
    .ai-result p  { margin: 0 0 10px; }
    .ai-result ul { margin: 0 0 10px; padding-left: 18px; }
    .ai-result li { margin-bottom: 5px; }
    .ai-result strong { color: #e2e8f0; font-weight: 600; }

    /* Auth required */
    .auth-required {
      text-align: center;
      padding: 20px 0;
    }
    .auth-required .auth-icon {
      width: 44px; height: 44px;
      background: rgba(245,158,11,0.12);
      border: 1px solid rgba(245,158,11,0.25);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 12px;
    }
    .auth-required .auth-icon svg { width: 22px; height: 22px; fill: #f59e0b; }
    .auth-required h3 {
      color: #f1f5f9;
      font-size: 15px;
      font-weight: 700;
      margin: 0 0 6px;
    }
    .auth-required p {
      color: rgba(148,163,184,0.85);
      font-size: 12.5px;
      line-height: 1.6;
      margin: 0;
    }
    .auth-required .hint {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 14px;
      background: rgba(99,102,241,0.1);
      border: 1px solid rgba(99,102,241,0.2);
      border-radius: 8px;
      padding: 8px 14px;
      color: rgba(165,180,252,0.9);
      font-size: 12px;
      font-weight: 500;
    }

    /* Error */
    .error-box {
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.2);
      border-radius: 10px;
      padding: 12px 14px;
      color: #fca5a5;
      font-size: 12.5px;
      line-height: 1.6;
    }
    .error-box strong { color: #f87171; }

    /* ── Footer ── */
    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 14px 20px 18px;
      border-top: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .footer-left { display: flex; gap: 8px; }
    .footer-right { display: flex; gap: 8px; }
    .fbtn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s ease;
      outline: none;
      border: none;
      white-space: nowrap;
    }
    .fbtn svg { width: 14px; height: 14px; fill: currentColor; }
    .fbtn-save {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      box-shadow: 0 3px 10px rgba(99,102,241,0.3);
    }
    .fbtn-save:hover {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      box-shadow: 0 5px 14px rgba(99,102,241,0.45);
      transform: translateY(-1px);
    }
    .fbtn-save:disabled {
      background: rgba(16,185,129,0.14);
      color: #10b981;
      box-shadow: none;
      cursor: default;
      transform: none;
    }
    .fbtn-copy {
      background: rgba(255,255,255,0.07);
      color: rgba(203,213,225,0.9);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .fbtn-copy:hover {
      background: rgba(255,255,255,0.12);
      color: #f1f5f9;
    }
    .fbtn-copy:disabled { opacity: 0.4; cursor: default; }

    .badge-powered {
      font-size: 10px;
      color: rgba(99,102,241,0.6);
      font-weight: 500;
      letter-spacing: 0.03em;
      align-self: center;
      margin-left: auto;
    }
  `;
  shadow.appendChild(style);

  // ── Build DOM ─────────────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const { title: modalTitle, prompt: groqPrompt } = buildPrompt(text, isPageSummary);

  // Header
  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `
    <div class="header-left">
      <div class="header-icon">
        <svg viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>
      </div>
      <div>
        <div class="header-title">${escapeHtml(modalTitle)}</div>
        <div class="header-subtitle">Powered by Shiv Sahni</div>
      </div>
    </div>
    <button class="close-modal-btn" id="hs-close-modal" type="button" aria-label="Close" title="Close">&times;</button>
  `;

  // Preview of selected text / page title
  const preview = document.createElement('div');
  preview.className = 'selected-preview';
  preview.innerHTML = `<div class="preview-label">${isPageSummary ? 'Webpage Title' : 'Selected Text'}</div>${escapeHtml(isPageSummary ? (document.title || 'Webpage') : text)}`;

  // Body
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.id = 'hs-modal-body';

  // Footer
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  footer.innerHTML = `
    <div class="footer-left">
      <button class="fbtn fbtn-save" id="hs-save-btn">
        <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        Save Highlight
      </button>
      <button class="fbtn fbtn-copy" id="hs-copy-btn" disabled>
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        Copy
      </button>
    </div>
    <span class="badge-powered">Highlight Saver ✦</span>
  `;

  modal.appendChild(header);
  modal.appendChild(preview);
  modal.appendChild(body);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  shadow.appendChild(backdrop);
  document.body.appendChild(host);

  // ── Wire up close ─────────────────────────────────────────────────────────
  const closeModalBtn = shadow.getElementById('hs-close-modal');
  const closeModal = () => {
    modal.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    backdrop.style.transition = 'opacity 0.2s ease';
    modal.style.opacity = '0';
    modal.style.transform = 'scale(0.95)';
    backdrop.style.opacity = '0';
    setTimeout(() => host.remove(), 220);
  };
  closeModalBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  host._hsClose = closeModal;

  // ── Wire up Save ─────────────────────────────────────────────────────────
  const saveBtn = shadow.getElementById('hs-save-btn');
  const copyBtn = shadow.getElementById('hs-copy-btn');

  if (!contextValid) {
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.4';
    saveBtn.title = 'Refresh the page to enable saving';
  } else {
    saveBtn.addEventListener('click', () => {
      doSaveHighlight(text, saveBtn, null);
    });
  }

  // ── Check auth & call Groq ────────────────────────────────────────────────
  if (!isContextValid()) {
    showAuthRequired(body);
    return;
  }

  chrome.storage.local.get(['session_token', 'groq_api_key'], async (result) => {
    const token = result.session_token;

    // Priority: window.HS_CONFIG -> chrome.storage.local
    let apiKey = (typeof window !== 'undefined' && window.HS_CONFIG?.GROQ_API_KEY) || result.groq_api_key || '';
    if (apiKey === 'REPLACE_WITH_YOUR_GROQ_API_KEY' || apiKey === 'YOUR_GROQ_API_KEY_HERE') {
      const storedKey = result.groq_api_key;
      if (storedKey && storedKey !== 'REPLACE_WITH_YOUR_GROQ_API_KEY' && storedKey !== 'YOUR_GROQ_API_KEY_HERE') {
        apiKey = storedKey;
      } else {
        apiKey = '';
      }
    }

    if (!token) {
      showAuthRequired(body);
      copyBtn.disabled = true;
      return;
    }

    if (!apiKey) {
      showError(body, 'AI service is currently unavailable. Please try again later.');
      copyBtn.disabled = false;
      return;
    }


    // Show loading skeleton
    showLoading(body);

    // Call Groq (shared helper: cooldown, lighter model, friendly rate-limit handling)
    try {
      const content = await callGroq([
        {
          role: 'system',
          content: 'You are a professional reading assistant. Provide concise, clear, and structured explanations using bold headings and bullet points. Do not include introductory filler phrases.'
        },
        { role: 'user', content: groqPrompt }
      ], { temperature: 0.4, max_tokens: 600 });

      const text = content || '(No response)';
      showResult(body, text);
      copyBtn.disabled = false;

      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          const orig = copyBtn.innerHTML;
          copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#10b981"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            Copied!
          `;
          copyBtn.style.color = '#10b981';
          setTimeout(() => {
            copyBtn.innerHTML = orig;
            copyBtn.style.color = '';
          }, 1500);
        });
      });

    } catch (err) {
      showError(body, friendlyAiMessage(err?.message || String(err), err?.status));
      copyBtn.disabled = false;
    }
  });
}

// ── Modal body state renderers ────────────────────────────────────────────────
function showLoading(body) {
  body.innerHTML = `
    <div class="loading-label">
      Generating AI summary
      <span class="dot-pulse"><span></span><span></span><span></span></span>
    </div>
    <div class="skeleton-wrap">
      <div class="skeleton-line w-full h-big"></div>
      <div class="skeleton-line w-90"></div>
      <div class="skeleton-line w-75"></div>
      <div class="skeleton-line w-full"></div>
      <div class="skeleton-line w-90"></div>
      <div class="skeleton-line w-50"></div>
    </div>
  `;
}

function showResult(body, text) {
  body.innerHTML = `<div class="ai-result">${formatMarkdownInline(text)}</div>`;
}

function showError(body, msg) {
  body.innerHTML = `
    <div class="error-box">
      <strong>Error:</strong><br>${escapeHtml(msg)}
    </div>
  `;
}

function showAuthRequired(body) {
  body.innerHTML = `
    <div class="auth-required">
      <div class="auth-icon">
        <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
      </div>
      <h3>Login Required</h3>
      <p>Sign in via the extension popup to use AI features.<br>Your highlights and AI features are tied to your account.</p>
      <div class="hint">
        <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        Click the extension icon in the toolbar to sign in
      </div>
    </div>
  `;
}

// ── Groq helpers ─────────────────────────────────────────────────────────────
function resolveGroqApiKey(stored) {
  let apiKey = (typeof window !== 'undefined' && window.HS_CONFIG?.GROQ_API_KEY) || stored?.groq_api_key || '';
  if (apiKey === 'REPLACE_WITH_YOUR_GROQ_API_KEY' || apiKey === 'YOUR_GROQ_API_KEY_HERE') {
    const storedKey = stored?.groq_api_key;
    if (storedKey && storedKey !== 'REPLACE_WITH_YOUR_GROQ_API_KEY' && storedKey !== 'YOUR_GROQ_API_KEY_HERE') {
      apiKey = storedKey;
    } else {
      apiKey = '';
    }
  }
  return apiKey;
}

function getStorageAsync(keys) {
  return new Promise((resolve) => {
    try {
      if (!isContextValid()) { resolve({}); return; }
      chrome.storage.local.get(keys, (result) => {
        try {
          if (chrome.runtime?.lastError) resolve({});
          else resolve(result || {});
        } catch (_) { resolve({}); }
      });
    } catch (_) { resolve({}); }
  });
}

const GROQ_MODEL = 'llama-3.1-8b-instant'; // lighter + higher free-tier throughput than 70B
const GROQ_COOLDOWN_KEY = 'hs_groq_cooldown_until';
const KW_CACHE_KEY = 'hs_keyword_cache_v1';
const KW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h per URL
const KW_CACHE_MAX_ENTRIES = 40;

function isRateLimitError(msg, status) {
  if (status === 429) return true;
  return /rate limit|too many requests|quota|tpm|rpm|429/i.test(String(msg || ''));
}

function friendlyAiMessage(msg, status) {
  if (isRateLimitError(msg, status)) {
    return 'AI is busy right now. Try again in a minute.';
  }
  const m = String(msg || '');
  if (m === 'LOGIN_REQUIRED') return 'Sign in via the extension popup';
  if (m === 'NO_API_KEY') return 'Add Groq key in popup settings';
  if (m === 'COOLDOWN') return 'AI is cooling down. Using offline keywords.';
  if (/unavailable|network|failed to fetch|HTTP 5/i.test(m)) {
    return 'AI is temporarily unavailable. Try again shortly.';
  }
  // Never surface raw provider rate-limit text
  if (/rate|limit|quota/i.test(m)) {
    return 'AI is busy right now. Try again in a minute.';
  }
  return m.slice(0, 90) || 'Something went wrong. Try again.';
}

async function getGroqCooldownUntil() {
  const stored = await getStorageAsync([GROQ_COOLDOWN_KEY]);
  const until = Number(stored?.[GROQ_COOLDOWN_KEY] || 0);
  return Number.isFinite(until) ? until : 0;
}

async function setGroqCooldown(ms = 90000) {
  const until = Date.now() + ms;
  try {
    chrome.storage.local.set({ [GROQ_COOLDOWN_KEY]: until });
  } catch (_) { /* ignore */ }
  return until;
}

function cacheUrlKey(url) {
  try {
    const u = new URL(url || location.href);
    // Ignore hash; keep path for article identity
    return `${u.origin}${u.pathname}`.replace(/\/$/, '') || u.href;
  } catch (_) {
    return String(url || location.href).split('#')[0];
  }
}

/** Full navigation identity including query (SPA routes often use search). */
function navUrlKey(url) {
  try {
    const u = new URL(url || location.href);
    return `${u.origin}${u.pathname}${u.search}`.replace(/\/$/, '') || u.href;
  } catch (_) {
    return String(url || location.href).split('#')[0];
  }
}

async function readKeywordCache(url) {
  const stored = await getStorageAsync([KW_CACHE_KEY]);
  const cache = stored?.[KW_CACHE_KEY] || {};
  const key = cacheUrlKey(url);
  const entry = cache[key];
  if (!entry || !Array.isArray(entry.items) || !entry.ts) return null;
  if (Date.now() - entry.ts > KW_CACHE_TTL_MS) return null;
  return entry.items;
}

async function writeKeywordCache(url, items) {
  if (!isContextValid() || !items?.length) return;
  try {
    const stored = await getStorageAsync([KW_CACHE_KEY]);
    const cache = { ...(stored?.[KW_CACHE_KEY] || {}) };
    const key = cacheUrlKey(url);
    cache[key] = { ts: Date.now(), items };
    // Prune oldest
    const entries = Object.entries(cache).sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
    const pruned = Object.fromEntries(entries.slice(0, KW_CACHE_MAX_ENTRIES));
    chrome.storage.local.set({ [KW_CACHE_KEY]: pruned });
  } catch (_) { /* ignore */ }
}

function extractPageContentForAi(maxLen = 3500) {
  let text = extractPageContent();
  if (text.length > maxLen) text = text.substring(0, maxLen) + '…';
  return text;
}

/** Offline keyword extraction when API is unavailable / cooling down */
function extractKeywordsOffline(pageText, limit = 8) {
  const STOP = new Set(('a an the and or but if in on at to for of as is was are were be been being '
    + 'this that these those it its with from by into over after before about between '
    + 'not no yes you your we they he she his her their our my me him them us '
    + 'will would can could should may might must shall do does did done having have has had '
    + 'what when where which who how why all any each few more most other some such than too very '
    + 'just also only then there here also using use used via per etc http https www com').split(/\s+/));

  const freq = new Map();
  const words = String(pageText || '').match(/[A-Za-z][A-Za-z0-9+.#-]{2,}/g) || [];
  words.forEach((w) => {
    const lower = w.toLowerCase();
    if (STOP.has(lower) || lower.length < 4 || lower.length > 40) return;
    freq.set(lower, (freq.get(lower) || 0) + 1);
  });

  // Prefer repeated + title words
  const titleBits = String(document.title || '').toLowerCase().split(/[^a-z0-9+.#-]+/).filter(Boolean);
  titleBits.forEach((t) => {
    if (t.length >= 4 && !STOP.has(t)) freq.set(t, (freq.get(t) || 0) + 3);
  });

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit * 2);

  const items = [];
  const seen = new Set();
  const sentences = String(pageText || '').split(/(?<=[.!?])\s+/);

  for (const [term] of ranked) {
    if (items.length >= limit) break;
    if (seen.has(term)) continue;
    // Find original casing occurrence
    const re = new RegExp('\\b(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\b', 'i');
    const m = String(pageText || '').match(re);
    const display = m ? m[1] : term;
    seen.add(term);

    const sentence = sentences.find((s) => re.test(s)) || '';
    const snippet = sentence.trim().slice(0, 180) || `Appears on “${document.title || 'this page'}”.`;

    items.push({
      term: display,
      sections: [
        { title: 'Meaning', body: `Important term on this page related to “${display}”.` },
        { title: 'On this page', body: snippet },
        { title: 'Why it matters', body: 'Highlighted offline while AI is resting — open again later for a richer summary.' },
        { title: 'Quick tip', body: 'Saved offline keywords still work for browsing; AI summaries resume after a short wait.' }
      ]
    });
  }
  return items;
}

function applyKeywordItems(items, tileHost, sourceLabel) {
  clearKeywordHighlights();
  keywordStore.clear();

  items.forEach((item, idx) => {
    const term = String(item.term || '').trim();
    if (!term || term.length < 2 || term.length > 80) return;
    const key = term.toLowerCase();
    if (keywordStore.has(key)) return;
    const sections = normalizeKeywordSections(item);
    keywordStore.set(key, {
      term,
      sections,
      summary: sectionsToPlainSummary(sections),
      colorIndex: idx % KW_COLORS.length
    });
  });

  const applied = hsPrefs.stickyNotesEnabled ? applyKeywordHighlights() : 0;
  keywordMarksActive = applied > 0;
  tileHost._hsRefreshLegend();
  const found = keywordStore.size > 0;
  let statusText;
  if (!found) {
    statusText = 'None matched page text';
  } else if (!hsPrefs.stickyNotesEnabled) {
    statusText = `${keywordStore.size} words${sourceLabel ? ' · ' + sourceLabel : ''} · sticky notes off`;
  } else if (applied > 0) {
    statusText = `${keywordStore.size} words${sourceLabel ? ' · ' + sourceLabel : ''} — click tile`;
  } else {
    statusText = 'None matched page text';
  }
  tileHost._hsSetStatus(statusText, found ? 'ok' : 'error');
  if (found && typeof tileHost._hsSetListOpen === 'function') {
    tileHost._hsSetListOpen(false);
  }
  return applied;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGroq(messages, { temperature = 0.3, max_tokens = 800, retries = 2 } = {}) {
  const until = await getGroqCooldownUntil();
  if (Date.now() < until) {
    const err = new Error('COOLDOWN');
    err.code = 'COOLDOWN';
    throw err;
  }

  const stored = await getStorageAsync(['session_token', 'groq_api_key']);
  const token = stored.session_token;
  const apiKey = resolveGroqApiKey(stored);
  if (!token) throw new Error('LOGIN_REQUIRED');
  if (!apiKey) throw new Error('NO_API_KEY');

  try {
    chrome.storage.local.set({ groq_api_key: apiKey });
  } catch (_) { /* ignore */ }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          temperature,
          max_tokens
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const apiMsg = errData.error?.message || `HTTP ${response.status}`;
        if (isRateLimitError(apiMsg, response.status)) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(Math.max(retryAfter * 1000, 30000), 120000)
            : 60000;
          await setGroqCooldown(waitMs);
          const err = new Error('RATE_LIMITED');
          err.code = 'RATE_LIMITED';
          err.status = response.status;
          throw err;
        }
        // Retry transient server / overload errors
        if (attempt < retries && (response.status >= 500 || response.status === 408 || response.status === 502 || response.status === 503)) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        throw new Error(apiMsg);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    } catch (err) {
      lastErr = err;
      if (err?.code === 'RATE_LIMITED' || err?.code === 'COOLDOWN') throw err;
      if (err?.message === 'LOGIN_REQUIRED' || err?.message === 'NO_API_KEY') throw err;
      const transient = /failed to fetch|network|HTTP 5|timeout|abort/i.test(String(err?.message || ''));
      if (attempt < retries && transient) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('AI request failed');
}

// ── Top-right keyword tile ───────────────────────────────────────────────────
const TILE_POS_KEY = 'hs_tile_position';

function clampTilePosition(left, top, width, height) {
  const pad = 8;
  const maxL = Math.max(pad, window.innerWidth - width - pad);
  const maxT = Math.max(pad, window.innerHeight - height - pad);
  return {
    left: Math.min(Math.max(pad, left), maxL),
    top: Math.min(Math.max(pad, top), maxT)
  };
}

function applyTilePosition(host, left, top) {
  const w = host.offsetWidth || 210;
  const h = host.offsetHeight || 56;
  const pos = clampTilePosition(left, top, w, h);
  host.style.left = `${pos.left}px`;
  host.style.top = `${pos.top}px`;
  host.style.right = 'auto';
  host.style.bottom = 'auto';
  return pos;
}

function saveTilePosition(left, top) {
  if (!isContextValid()) return;
  try {
    chrome.storage.local.set({ [TILE_POS_KEY]: { left, top } }, () => {
      try { void chrome.runtime?.lastError; } catch (_) { /* ignore */ }
    });
  } catch (_) { /* ignore */ }
}

function loadTilePosition(cb) {
  if (!isContextValid()) { cb(null); return; }
  try {
    chrome.storage.local.get([TILE_POS_KEY], (result) => {
      try {
        if (chrome.runtime?.lastError) { cb(null); return; }
        const p = result?.[TILE_POS_KEY];
        if (p && typeof p.left === 'number' && typeof p.top === 'number') cb(p);
        else cb(null);
      } catch (_) { cb(null); }
    });
  } catch (_) { cb(null); }
}

function enableKeywordTileDrag(host, headerEl, clearBtn) {
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  const DRAG_THRESHOLD = 5;

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      moved = true;
      host.classList.add('hs-dragging');
      host.shadowRoot?.querySelector('.tile')?.classList.add('dragging');
      headerEl.style.cursor = 'grabbing';
    }
    if (!moved) return;
    e.preventDefault();
    applyTilePosition(host, origLeft + dx, origTop + dy);
  };

  const onPointerUp = (e) => {
    if (!dragging) return;
    dragging = false;
    host.classList.remove('hs-dragging');
    host.shadowRoot?.querySelector('.tile')?.classList.remove('dragging');
    headerEl.style.cursor = 'grab';
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    try { headerEl.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }

    if (moved) {
      const left = parseFloat(host.style.left) || 0;
      const top = parseFloat(host.style.top) || 0;
      const pos = applyTilePosition(host, left, top);
      saveTilePosition(pos.left, pos.top);
      // Suppress the click that would toggle the word list after a drag
      host._hsSkipNextHeaderClick = true;
      setTimeout(() => { host._hsSkipNextHeaderClick = false; }, 0);
    }
  };

  headerEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target === clearBtn || clearBtn.contains(e.target)) return;
    if (e.target.closest && (
      e.target.closest('.gear-btn') ||
      e.target.closest('.clear-btn') ||
      e.target.closest('.prefs-panel') ||
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('label')
    )) return;
    // Allow chips/buttons in panel — only drag from header
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = host.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    // Switch from right-anchored default to left/top
    applyTilePosition(host, origLeft, origTop);
    headerEl.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
  });

  window.addEventListener('resize', () => {
    const left = parseFloat(host.style.left);
    const top = parseFloat(host.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      applyTilePosition(host, left, top);
    }
  });
}

function ensureKeywordTile() {
  if (document.getElementById('hs-keyword-tile-root')) return;
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', ensureKeywordTile, { once: true });
    return;
  }

  let listOpen = false;

  const host = document.createElement('div');
  host.id = 'hs-keyword-tile-root';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483645;';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .tile {
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      gap: 0;
      width: 210px;
      border-radius: 10px;
      background: #fffef8;
      border: 1px solid #e8e4d8;
      box-shadow: 0 2px 8px rgba(60, 50, 30, 0.08);
      color: #3d3420;
      animation: tile-in 0.28s ease;
      user-select: none;
      overflow: hidden;
      touch-action: none;
    }
    :host(.hs-dragging) .tile,
    .tile.dragging {
      box-shadow: 0 6px 18px rgba(60, 50, 30, 0.16);
      opacity: 0.96;
    }
    @keyframes tile-in {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .header {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 11px 12px;
      cursor: grab;
      transition: background 0.15s ease;
    }
    .header:hover { background: #faf7ef; }
    .header:active { cursor: grabbing; }
    .drag-hint {
      font-size: 9px;
      color: #a89f8c;
      letter-spacing: 0.08em;
      margin-bottom: 2px;
    }
    .meta { flex: 1; min-width: 0; }
    .title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .title {
      font-size: 12px;
      font-weight: 650;
      letter-spacing: -0.01em;
      color: #2c2416;
    }
    .chevron {
      font-size: 10px;
      color: #8a8272;
      transition: transform 0.18s ease;
      margin-left: auto;
    }
    .tile.open .chevron { transform: rotate(180deg); }
    .status {
      font-size: 11px;
      color: #6b6354;
      margin-top: 3px;
      line-height: 1.35;
    }
    .status.error { color: #9a3412; }
    .status.ok { color: #3f6212; }
    .status.busy { color: #6b6354; }
    .clear-btn {
      border: 1px solid #e0dccf;
      background: #f7f5ee;
      color: #5c5548;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
      outline: none;
      touch-action: auto;
    }
    .clear-btn:hover:not(:disabled) { background: #efece3; }
    .clear-btn:disabled { opacity: 0.4; cursor: default; }
    .header-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      flex-shrink: 0;
    }
    .gear-btn {
      border: 1px solid #e0dccf;
      background: #f7f5ee;
      color: #5c5548;
      border-radius: 6px;
      width: 26px;
      height: 26px;
      padding: 0;
      font-size: 13px;
      cursor: pointer;
      outline: none;
      touch-action: auto;
      line-height: 1;
    }
    .gear-btn:hover { background: #efece3; }
    .gear-btn.active {
      background: #ebe6da;
      border-color: #cfc8b6;
    }
    .prefs-panel {
      display: none;
      flex-direction: column;
      gap: 8px;
      padding: 8px 10px 10px;
      border-top: 1px solid #ebe6da;
      touch-action: auto;
    }
    .tile.prefs-open .prefs-panel { display: flex; }
    .tile.prefs-open .word-panel { display: none !important; }
    .prefs-heading {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #8a8272;
      margin: 2px 0 0;
    }
    .pref-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11.5px;
      font-weight: 550;
      color: #3d3420;
    }
    .pref-row span { line-height: 1.3; }
    .switch {
      position: relative;
      width: 34px;
      height: 18px;
      flex-shrink: 0;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .switch-slider {
      position: absolute;
      inset: 0;
      background: #d5cfbf;
      border-radius: 999px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .switch-slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      left: 2px;
      top: 2px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.15s ease;
      box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    }
    .switch input:checked + .switch-slider {
      background: #5b8f3a;
    }
    .switch input:checked + .switch-slider::before {
      transform: translateX(16px);
    }
    .spin {
      width: 10px; height: 10px; border-radius: 50%;
      border: 2px solid #ddd6c6;
      border-top-color: #8a7f68;
      display: inline-block;
      animation: spin 0.7s linear infinite;
      vertical-align: -1px;
      margin-right: 5px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .word-panel {
      display: none;
      flex-direction: column;
      gap: 6px;
      padding: 0 10px 10px;
      max-height: min(340px, 55vh);
      overflow: auto;
      scrollbar-width: thin;
      border-top: 1px solid #ebe6da;
      padding-top: 8px;
      touch-action: auto;
    }
    .tile.open .word-panel { display: flex; }
    .hint {
      font-size: 10px;
      color: #8a8272;
      padding: 0 2px 2px;
    }
    .chip {
      display: block;
      width: 100%;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 9px;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      outline: none;
      line-height: 1.3;
      transition: opacity 0.12s ease, transform 0.12s ease;
      touch-action: auto;
    }
    .chip:hover { opacity: 0.9; transform: translateX(1px); }

    /* Night theme for keyword tile */
    .tile[data-theme="dark"] {
      background: rgba(18, 28, 48, 0.92);
      border-color: rgba(160, 190, 230, 0.16);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      color: #e6eef8;
    }
    .tile[data-theme="dark"] .title { color: #e6eef8; }
    .tile[data-theme="dark"] .status { color: #9db0c8; }
    .tile[data-theme="dark"] .status.error { color: #fca5a5; }
    .tile[data-theme="dark"] .status.ok { color: #86efac; }
    .tile[data-theme="dark"] .status.busy { color: #9db0c8; }
    .tile[data-theme="dark"] .drag-hint { color: #7a8fa8; }
    .tile[data-theme="dark"] .chevron { color: #9db0c8; }
    .tile[data-theme="dark"] .clear-btn,
    .tile[data-theme="dark"] .gear-btn {
      border-color: rgba(160, 190, 230, 0.18);
      background: rgba(30, 42, 68, 0.9);
      color: #c5d4ef;
    }
    .tile[data-theme="dark"] .clear-btn:hover:not(:disabled),
    .tile[data-theme="dark"] .gear-btn:hover { background: rgba(40, 56, 86, 0.95); }
    .tile[data-theme="dark"] .gear-btn.active {
      background: rgba(50, 70, 105, 0.95);
      border-color: rgba(160, 190, 230, 0.3);
    }
    .tile[data-theme="dark"] .prefs-panel { border-top-color: rgba(160, 190, 230, 0.14); }
    .tile[data-theme="dark"] .prefs-heading { color: #7a8fa8; }
    .tile[data-theme="dark"] .pref-row { color: #e6eef8; }
    .tile[data-theme="dark"] .switch-slider { background: #3a4a62; }
    .tile[data-theme="dark"] .switch input:checked + .switch-slider { background: #4ade80; }
    .tile[data-theme="dark"] .word-panel { border-top-color: rgba(160, 190, 230, 0.14); }
    .tile[data-theme="dark"] .hint { color: #9db0c8; }
    .tile[data-theme="dark"] .header:hover { background: rgba(30, 42, 68, 0.55); }
    .tile[data-theme="dark"].dragging {
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    }
  `;
  shadow.appendChild(style);

  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.setAttribute('data-theme', getHsTheme());
  tile.innerHTML = `
    <div class="header" id="hs-tile-header" title="Drag to move · Click to show keywords">
      <div class="meta">
        <div class="drag-hint">⠿ DRAG</div>
        <div class="title-row">
          <div class="title">Keywords</div>
          <span class="chevron" aria-hidden="true">▾</span>
        </div>
        <div class="status busy" id="hs-tile-status"><span class="spin"></span>Analyzing page…</div>
      </div>
      <div class="header-actions">
        <button class="gear-btn" id="hs-tile-gear" title="Feature settings" type="button">⚙</button>
        <button class="clear-btn" id="hs-tile-clear" disabled title="Clear highlights">Clear</button>
      </div>
    </div>
    <div class="prefs-panel" id="hs-tile-prefs">
      <div class="prefs-heading">Page highlights</div>
      <label class="pref-row">
        <span>Sticky notes</span>
        <span class="switch">
          <input type="checkbox" id="hs-pref-sticky" />
          <span class="switch-slider"></span>
        </span>
      </label>
      <div class="prefs-heading">Selection tooltip</div>
      <label class="pref-row">
        <span>Save Highlight</span>
        <span class="switch">
          <input type="checkbox" id="hs-pref-save" />
          <span class="switch-slider"></span>
        </span>
      </label>
      <label class="pref-row">
        <span>AI Summary</span>
        <span class="switch">
          <input type="checkbox" id="hs-pref-ai" />
          <span class="switch-slider"></span>
        </span>
      </label>
      <label class="pref-row">
        <span>Summarize Page</span>
        <span class="switch">
          <input type="checkbox" id="hs-pref-page" />
          <span class="switch-slider"></span>
        </span>
      </label>
    </div>
    <div class="word-panel" id="hs-tile-words">
      <div class="hint">Click a word for AI summary</div>
    </div>
  `;
  shadow.appendChild(tile);
  document.body.appendChild(host);

  // Restore last position (or keep default top-right)
  loadTilePosition((saved) => {
    if (saved) applyTilePosition(host, saved.left, saved.top);
  });

  const statusEl = shadow.getElementById('hs-tile-status');
  const clearBtn = shadow.getElementById('hs-tile-clear');
  const wordsEl = shadow.getElementById('hs-tile-words');
  const headerEl = shadow.getElementById('hs-tile-header');
  const gearBtn = shadow.getElementById('hs-tile-gear');
  const prefSticky = shadow.getElementById('hs-pref-sticky');
  const prefSave = shadow.getElementById('hs-pref-save');
  const prefAi = shadow.getElementById('hs-pref-ai');
  const prefPage = shadow.getElementById('hs-pref-page');

  enableKeywordTileDrag(host, headerEl, clearBtn);

  let prefsOpen = false;
  const syncPrefsUi = () => {
    prefSticky.checked = !!hsPrefs.stickyNotesEnabled;
    prefSave.checked = !!hsPrefs.tooltipSave;
    prefAi.checked = !!hsPrefs.tooltipAiSummary;
    prefPage.checked = !!hsPrefs.tooltipSummarizePage;
    gearBtn.classList.toggle('active', prefsOpen);
    tile.classList.toggle('prefs-open', prefsOpen);
  };
  host._hsSyncPrefsUi = syncPrefsUi;
  syncPrefsUi();

  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    prefsOpen = !prefsOpen;
    if (prefsOpen) host._hsSetListOpen(false);
    syncPrefsUi();
  });

  const bindPrefToggle = (el, key) => {
    el.addEventListener('change', (e) => {
      e.stopPropagation();
      saveHsPrefs({ [key]: el.checked }, () => {
        applyFeaturePrefsToPage();
        if (key === 'stickyNotesEnabled' && keywordStore.size > 0 && typeof host._hsSetStatus === 'function') {
          const found = keywordStore.size;
          if (!hsPrefs.stickyNotesEnabled) {
            host._hsSetStatus(`${found} words · sticky notes off`, 'ok');
          } else if (keywordMarksActive) {
            host._hsSetStatus(`${found} words — click tile`, 'ok');
          }
        }
      });
    });
    el.addEventListener('click', (e) => e.stopPropagation());
  };
  bindPrefToggle(prefSticky, 'stickyNotesEnabled');
  bindPrefToggle(prefSave, 'tooltipSave');
  bindPrefToggle(prefAi, 'tooltipAiSummary');
  bindPrefToggle(prefPage, 'tooltipSummarizePage');

  host._hsSetStatus = (text, kind = '') => {
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
    if (kind === 'busy') {
      statusEl.innerHTML = '<span class="spin"></span>' + text;
    } else {
      statusEl.textContent = text;
    }
  };
  host._hsSetBusy = () => {};

  const openWordSummary = (key, item) => {
    const mark = document.querySelector(`.hs-kw-mark[data-hs-key="${CSS.escape(key)}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showKeywordPopup(item, mark);
    } else {
      showKeywordPopup(item, null);
    }
  };

  host._hsRefreshLegend = () => {
    wordsEl.innerHTML = '<div class="hint">Click a word for AI summary</div>';
    if (!keywordStore.size) {
      clearBtn.disabled = true;
      tile.classList.remove('open');
      listOpen = false;
      return;
    }
    clearBtn.disabled = false;
    for (const [key, item] of keywordStore) {
      const color = KW_COLORS[item.colorIndex % KW_COLORS.length];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = item.term;
      chip.title = 'Show AI summary';
      chip.style.background = color.bg;
      chip.style.borderColor = color.border;
      chip.style.color = color.text;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openWordSummary(key, item);
      });
      wordsEl.appendChild(chip);
    }
  };

  host._hsSetListOpen = (open) => {
    listOpen = !!open && keywordStore.size > 0;
    if (listOpen) {
      prefsOpen = false;
      syncPrefsUi();
    }
    tile.classList.toggle('open', listOpen);
  };

  headerEl.addEventListener('click', (e) => {
    if (host._hsSkipNextHeaderClick) return;
    if (e.target === clearBtn || clearBtn.contains(e.target)) return;
    if (e.target === gearBtn || gearBtn.contains(e.target)) return;
    if (shadow.getElementById('hs-tile-prefs')?.contains(e.target)) return;
    if (!keywordStore.size) return;
    prefsOpen = false;
    syncPrefsUi();
    host._hsSetListOpen(!listOpen);
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearKeywordHighlights();
    host._hsSetStatus('Cleared');
    host._hsRefreshLegend();
    host._hsSetListOpen(false);
    closeKeywordPopup();
  });

  // Auto-analyze shortly after inject so the page can settle
  setTimeout(() => runKeywordAnalysis(host), 600);
  watchPageNavigation(host);
}

let keywordAnalysisGeneration = 0;

async function waitForFreshPageText(prevSnippet, maxWaitMs = 4500) {
  const start = Date.now();
  let latest = extractPageContentForAi(3500);
  while (Date.now() - start < maxWaitMs) {
    await sleep(450);
    latest = extractPageContentForAi(3500);
    if (latest && latest.length >= 60) {
      // Content changed from previous page, or we have enough text
      if (!prevSnippet || latest.slice(0, 180) !== prevSnippet.slice(0, 180)) {
        return latest;
      }
    }
  }
  return latest || extractPageContentForAi(3500);
}

function scheduleKeywordRetry(tileHost, pageNavKey, delayMs) {
  const counts = tileHost._hsRetryCounts || (tileHost._hsRetryCounts = Object.create(null));
  counts[pageNavKey] = (counts[pageNavKey] || 0) + 1;
  if (counts[pageNavKey] > 3) return; // stop endless retries on a broken page

  setTimeout(() => {
    if (navUrlKey(location.href) !== pageNavKey) return;
    runKeywordAnalysis(tileHost, { isRetry: true });
  }, delayMs);
}

async function runKeywordAnalysis(tileHost, opts = {}) {
  if (!isContextValid()) {
    tileHost._hsSetStatus('Refresh the page to enable', 'error');
    return;
  }

  const gen = ++keywordAnalysisGeneration;
  const pageUrl = location.href;
  const pageNavKey = navUrlKey(pageUrl);
  // Mark this URL as "handled" immediately so navigation polling won't loop forever on failures
  tileHost._hsLastNavKey = pageNavKey;
  tileHost._hsSetStatus(opts.isRetry ? 'Retrying…' : 'Checking cache…', 'busy');

  const isStale = () =>
    gen !== keywordAnalysisGeneration || navUrlKey(location.href) !== pageNavKey;

  const applyOfflineOrThrow = (pageText, label) => {
    const offline = extractKeywordsOffline(pageText || extractPageContentForAi(3500), 8);
    if (!offline.length) throw new Error('Could not find keywords on this page.');
    applyKeywordItems(offline, tileHost, label || 'offline');
    tileHost._hsLastNavKey = pageNavKey;
  };

  try {
    // 1) Cache hit → zero API calls
    const cached = await readKeywordCache(pageUrl);
    if (isStale()) return;
    if (cached?.length) {
      applyKeywordItems(cached, tileHost, 'cached');
      tileHost._hsLastNavKey = pageNavKey;
      return;
    }

    let pageText = extractPageContentForAi(3500);
    if (isStale()) return;
    if (!pageText || pageText.length < 40) {
      pageText = await waitForFreshPageText(tileHost._hsPrevPageSnippet || '', 3500);
      if (isStale()) return;
      if (!pageText || pageText.length < 40) {
        throw new Error('Not enough readable text on this page.');
      }
    }

    // 2) Cooldown → offline now, retry AI later without requiring refresh
    const until = await getGroqCooldownUntil();
    if (isStale()) return;
    if (Date.now() < until) {
      applyOfflineOrThrow(pageText, 'offline');
      const wait = Math.min(Math.max(until - Date.now() + 500, 5000), 120000);
      scheduleKeywordRetry(tileHost, pageNavKey, wait);
      return;
    }

    tileHost._hsSetStatus('Analyzing page…', 'busy');

    const raw = await callGroq([
      {
        role: 'system',
        content: 'Extract keywords. Return ONLY a compact JSON array. No markdown.'
      },
      {
        role: 'user',
        content: `Extract 6–8 important keywords/phrases from this page.
Return JSON array only. Each item:
{"term":"exact page wording","sections":[
{"title":"Meaning","body":"1 short sentence"},
{"title":"On this page","body":"1 short sentence"},
{"title":"Why it matters","body":"1 short sentence"},
{"title":"Quick tip","body":"1 short sentence"}
]}
Title: ${document.title || 'Webpage'}
Text:
${pageText}`
      }
    ], { temperature: 0.2, max_tokens: 900, retries: 2 });

    if (isStale()) return;

    const items = parseKeywordJson(raw);
    if (!items.length) {
      // Bad/empty model output — offline rather than hard fail
      applyOfflineOrThrow(pageText, 'offline');
      scheduleKeywordRetry(tileHost, pageNavKey, 8000);
      return;
    }

    applyKeywordItems(items, tileHost, '');
    tileHost._hsLastNavKey = pageNavKey;
    if (tileHost._hsRetryCounts) tileHost._hsRetryCounts[pageNavKey] = 0;
    writeKeywordCache(pageUrl, items);
  } catch (err) {
    if (isStale()) return;
    const code = err?.code || '';
    const msg = err?.message || String(err);

    // Always try offline before surfacing an error (except auth)
    if (msg !== 'LOGIN_REQUIRED' && msg !== 'NO_API_KEY') {
      try {
        applyOfflineOrThrow(extractPageContentForAi(3500), 'offline');
        if (code === 'RATE_LIMITED' || code === 'COOLDOWN' || isRateLimitError(msg, err?.status)) {
          const until = await getGroqCooldownUntil();
          const wait = Math.min(Math.max(until - Date.now() + 500, 8000), 120000);
          scheduleKeywordRetry(tileHost, pageNavKey, wait);
        } else {
          scheduleKeywordRetry(tileHost, pageNavKey, 10000);
        }
        return;
      } catch (_) { /* fall through */ }
    }

    tileHost._hsSetStatus(friendlyAiMessage(msg, err?.status), 'error');
    // Still mark nav key so we don't spam; allow a later retry
    tileHost._hsLastNavKey = pageNavKey;
    if (msg !== 'LOGIN_REQUIRED' && msg !== 'NO_API_KEY') {
      scheduleKeywordRetry(tileHost, pageNavKey, 12000);
    }
  }
}

/**
 * Re-run keyword analysis when navigating in the same tab (SPA / Turbo / back-forward).
 * Full reloads already re-inject the content script.
 */
function watchPageNavigation(tileHost) {
  if (tileHost._hsNavWatchAttached) return;
  tileHost._hsNavWatchAttached = true;
  tileHost._hsLastNavKey = navUrlKey(location.href);
  tileHost._hsPrevPageSnippet = extractPageContentForAi(400);

  let debounceTimer = null;

  const onNavigate = () => {
    const key = navUrlKey(location.href);
    if (key === tileHost._hsLastNavKey) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const nextKey = navUrlKey(location.href);
      if (nextKey === tileHost._hsLastNavKey) return;

      const prevSnippet = tileHost._hsPrevPageSnippet || '';
      // Claim this navigation immediately — prevents 1s polling from re-firing forever
      tileHost._hsLastNavKey = nextKey;
      keywordAnalysisGeneration += 1;

      closeKeywordPopup();
      clearKeywordHighlights();
      if (typeof tileHost._hsRefreshLegend === 'function') tileHost._hsRefreshLegend();
      if (typeof tileHost._hsSetListOpen === 'function') tileHost._hsSetListOpen(false);
      tileHost._hsSetStatus('New page detected…', 'busy');

      (async () => {
        try {
          // Wait until content looks different from the previous page
          await waitForFreshPageText(prevSnippet, 4500);
        } catch (_) { /* ignore */ }
        if (navUrlKey(location.href) !== nextKey) return;
        tileHost._hsPrevPageSnippet = extractPageContentForAi(400);
        runKeywordAnalysis(tileHost);
      })();
    }, 300);
  };

  if (!window.__hsHistoryPatched) {
    window.__hsHistoryPatched = true;
    const wrap = (method) => {
      const original = history[method];
      if (typeof original !== 'function') return;
      history[method] = function (...args) {
        const ret = original.apply(this, args);
        try {
          window.dispatchEvent(new Event('hs-locationchange'));
        } catch (_) { /* ignore */ }
        return ret;
      };
    };
    wrap('pushState');
    wrap('replaceState');
  }

  window.addEventListener('hs-locationchange', onNavigate);
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) onNavigate();
  });

  // Fallback for routers that change the URL without reliable history events
  setInterval(() => {
    if (navUrlKey(location.href) !== tileHost._hsLastNavKey) onNavigate();
  }, 1200);
}

function parseKeywordJson(raw) {
  if (!raw) return [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

const DEFAULT_SECTION_TITLES = ['Meaning', 'On this page', 'Why it matters', 'Quick tip'];

function normalizeKeywordSections(item) {
  const sections = [];
  if (Array.isArray(item?.sections)) {
    item.sections.forEach((s) => {
      const title = String(s?.title || '').trim();
      const body = String(s?.body || s?.content || s?.text || '').trim();
      if (title && body) sections.push({ title, body });
    });
  }

  // Fallback if model returned flat fields instead of sections
  if (!sections.length) {
    const flatMap = [
      ['Meaning', item?.meaning || item?.definition],
      ['On this page', item?.context || item?.on_this_page],
      ['Why it matters', item?.why_it_matters || item?.importance],
      ['Quick tip', item?.tip || item?.example || item?.related]
    ];
    flatMap.forEach(([title, body]) => {
      const t = String(body || '').trim();
      if (t) sections.push({ title, body: t });
    });
  }

  if (!sections.length) {
    const summary = String(item?.summary || '').trim();
    if (summary) {
      sections.push({ title: 'Summary', body: summary });
    } else {
      sections.push({ title: 'Meaning', body: `Key term: ${String(item?.term || '').trim()}` });
    }
  }

  // Ensure preferred order when titles match defaults
  sections.sort((a, b) => {
    const ai = DEFAULT_SECTION_TITLES.indexOf(a.title);
    const bi = DEFAULT_SECTION_TITLES.indexOf(b.title);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return sections;
}

function sectionsToPlainSummary(sections) {
  return (sections || [])
    .map((s) => `**${s.title}**\n${s.body}`)
    .join('\n\n');
}

function renderKeywordSectionsHtml(sections) {
  if (!sections || !sections.length) {
    return '<p>No summary available.</p>';
  }
  return sections.map((s) => `
    <section class="section">
      <h4 class="section-title">${escapeHtml(s.title)}</h4>
      <div class="section-body">${formatMarkdownInline(s.body)}</div>
    </section>
  `).join('');
}

function clearKeywordHighlights() {
  document.querySelectorAll('mark.hs-kw-mark').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(el.textContent || ''), el);
    parent.normalize();
  });
  keywordStore.clear();
  keywordMarksActive = false;
}

function isSkippableHighlightRoot(node) {
  if (!node || node.nodeType !== 1) return true;
  const tag = node.tagName;
  if (!tag) return true;
  if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|CANVAS|IFRAME|CODE|PRE|KBD|SAMP)$/i.test(tag)) return true;
  if (node.isContentEditable) return true;
  if (node.id && HS_OWN_IDS.has(node.id)) return true;
  if (node.closest && (node.closest('#hs-keyword-tile-root') || node.closest('#hs-keyword-popup-root') || node.closest('#hs-ai-modal-root') || node.closest('#highlight-saver-tooltip-root'))) return true;
  return false;
}

function applyKeywordHighlights() {
  if (!hsPrefs.stickyNotesEnabled) return 0;
  const terms = [...keywordStore.values()]
    .map((v) => v.term)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return 0;

  const pattern = new RegExp(
    '(' + terms.map((t) => {
      const escaped = escapeRegExp(t);
      // Prefer whole-word matches for short single tokens
      if (!/\s/.test(t) && t.length <= 12) return '\\b' + escaped + '\\b';
      return escaped;
    }).join('|') + ')',
    'gi'
  );

  const root = document.querySelector('article') || document.querySelector('main') || document.body;
  if (!root || isSkippableHighlightRoot(root)) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || isSkippableHighlightRoot(parent)) return NodeFilter.FILTER_REJECT;
      if (parent.closest && parent.closest('mark.hs-kw-mark')) return NodeFilter.FILTER_REJECT;
      if (parent.closest && parent.closest('[id^="hs-"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  let markCount = 0;
  const MAX_MARKS = 120;

  for (const textNode of textNodes) {
    if (markCount >= MAX_MARKS) break;
    const text = textNode.nodeValue;
    pattern.lastIndex = 0;
    if (!pattern.test(text)) {
      pattern.lastIndex = 0;
      continue;
    }
    pattern.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    let madeMark = false;
    while ((match = pattern.exec(text)) !== null) {
      if (markCount >= MAX_MARKS) break;
      const matched = match[0];
      const key = matched.toLowerCase();
      const meta = keywordStore.get(key);

      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      if (!meta) {
        frag.appendChild(document.createTextNode(matched));
        lastIndex = match.index + matched.length;
        continue;
      }

      const color = KW_COLORS[meta.colorIndex % KW_COLORS.length];
      const mark = document.createElement('mark');
      mark.className = 'hs-kw-mark';
      mark.dataset.hsKey = key;
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
      mark.title = 'Click for explanation · Esc to close';
      mark.addEventListener('click', (ev) => {
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
    textNode.parentNode.replaceChild(frag, textNode);
  }

  return markCount;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// ── Keyword explanation popup ────────────────────────────────────────────────
let keywordPopupCleanup = null;

function closeKeywordPopup() {
  if (typeof keywordPopupCleanup === 'function') {
    keywordPopupCleanup();
    keywordPopupCleanup = null;
  }
  const existing = document.getElementById('hs-keyword-popup-root');
  if (!existing) return;
  existing.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  existing.style.opacity = '0';
  existing.style.transform = 'translateY(6px) scale(0.97)';
  setTimeout(() => existing.remove(), 180);
}

function buildKeywordPlainText(item, sections) {
  const lines = [item.term || '', ''];
  (sections || []).forEach((s) => {
    lines.push(String(s.title || ''));
    lines.push(String(s.body || ''));
    lines.push('');
  });
  return lines.join('\n').trim();
}

/** Document coordinates (absolute) — scrolls with the page, not the viewport. */
function positionKeywordPopupAbsolute(host, anchorEl) {
  if (!host.isConnected) return;
  const gap = 10;
  const pad = 12;
  const popupW = Math.min(360, Math.max(240, document.documentElement.clientWidth - 24));
  const card = host.shadowRoot?.querySelector('.card');
  const popupH = card?.offsetHeight || 280;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  let rect;
  if (anchorEl && document.contains(anchorEl)) {
    rect = anchorEl.getBoundingClientRect();
  } else {
    const tile = document.getElementById('hs-keyword-tile-root');
    const t = tile?.getBoundingClientRect();
    rect = t || { top: 80, bottom: 110, left: window.innerWidth - 380, width: 0, height: 0 };
  }

  const spaceBelow = window.innerHeight - rect.bottom;
  let topViewport;
  if (spaceBelow >= Math.min(popupH + gap, 140)) {
    topViewport = rect.bottom + gap;
  } else {
    topViewport = rect.top - popupH - gap;
  }

  let leftViewport = rect.left + (rect.width || 0) / 2 - popupW / 2;
  const docW = Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth);
  let leftDoc = leftViewport + scrollX;
  leftDoc = Math.max(pad, Math.min(leftDoc, docW - popupW - pad));
  const topDoc = Math.max(pad, topViewport + scrollY);

  host.style.top = `${topDoc}px`;
  host.style.left = `${leftDoc}px`;
  host.style.width = `${popupW}px`;
}

function showKeywordPopup(item, anchorEl) {
  closeKeywordPopup();

  const host = document.createElement('div');
  host.id = 'hs-keyword-popup-root';
  // Absolute = document-sticky: scrolls away with the word; still there when you scroll back
  host.style.cssText = 'position:absolute;z-index:2147483647;opacity:0;transform:translateY(6px) scale(0.97);';

  const shadow = host.attachShadow({ mode: 'open' });
  const color = KW_COLORS[item.colorIndex % KW_COLORS.length];
  const sections = item.sections && item.sections.length
    ? item.sections
    : normalizeKeywordSections({ summary: item.summary, term: item.term });
  const plainText = buildKeywordPlainText(item, sections);

  const key = String(item.term || '').toLowerCase();
  let anchor = anchorEl && document.contains(anchorEl) ? anchorEl : null;
  if (!anchor && key) {
    anchor = document.querySelector(`.hs-kw-mark[data-hs-key="${CSS.escape(key)}"]`);
  }

  const style = document.createElement('style');
  style.textContent = `
    .card {
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      width: 100%;
      background: #fffef8;
      border: 1px solid #e8e4d8;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(60, 50, 30, 0.12);
      overflow: hidden;
      color: #3d3420;
    }
    .accent {
      height: 6px;
      background: ${color.bg};
      border-bottom: 1px solid ${color.border};
    }
    .head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px 8px;
    }
    .term {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #2c2416;
      line-height: 1.25;
    }
    .badge {
      display: inline-block;
      margin-top: 6px;
      font-size: 10px;
      font-weight: 650;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 4px;
      background: ${color.bg};
      border: 1px solid ${color.border};
      color: ${color.text};
    }
    .close {
      border: 1px solid #e0dccf;
      background: #f7f5ee;
      color: #5c5548;
      width: 28px; height: 28px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      flex-shrink: 0;
    }
    .close:hover { background: #efece3; color: #9a3412; }
    .body {
      padding: 2px 14px 10px;
      max-height: min(360px, 58vh);
      overflow: auto;
      scrollbar-width: thin;
    }
    .section {
      padding: 8px 0;
      border-top: 1px solid #ebe6da;
    }
    .section:first-child { border-top: none; padding-top: 2px; }
    .section-title {
      margin: 0 0 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #8a8272;
    }
    .section-body {
      font-size: 13px;
      line-height: 1.55;
      color: #4a4336;
    }
    .section-body p { margin: 0 0 6px; }
    .section-body p:last-child { margin-bottom: 0; }
    .section-body ul { margin: 0 0 6px; padding-left: 18px; }
    .section-body strong { color: #2c2416; }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px 12px;
      border-top: 1px solid #ebe6da;
      background: #faf8f1;
    }
    .abtn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid #e0dccf;
      background: #fff;
      color: #3d3420;
      border-radius: 6px;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
      outline: none;
    }
    .abtn:hover { background: #f3f0e6; }
    .abtn svg { width: 13px; height: 13px; fill: currentColor; }
    .abtn-save {
      background: #fff59d;
      border-color: #f0e68c;
      color: #3d3420;
    }
    .abtn-save:hover { background: #fff176; }
    .abtn-save:disabled {
      background: #e8f5e9;
      border-color: #c8e6c9;
      color: #2e7d32;
      cursor: default;
    }
    .hint {
      margin-left: auto;
      font-size: 10.5px;
      color: #8a8272;
    }
    .kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid #e0dccf;
      background: #fff;
      color: #5c5548;
    }
  `;
  shadow.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="accent"></div>
    <div class="head">
      <div>
        <div class="term">${escapeHtml(item.term)}</div>
        <span class="badge">AI summary</span>
      </div>
      <button class="close" type="button" aria-label="Close" title="Close (Esc)">&times;</button>
    </div>
    <div class="body">${renderKeywordSectionsHtml(sections)}</div>
    <div class="actions">
      <button class="abtn abtn-save" type="button" id="hs-kw-save">
        <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        Save
      </button>
      <button class="abtn" type="button" id="hs-kw-copy">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        Copy
      </button>
      <span class="hint"><span class="kbd">Esc</span> close</span>
    </div>
  `;
  shadow.appendChild(card);
  document.body.appendChild(host);

  shadow.querySelector('.close').addEventListener('click', closeKeywordPopup);

  const saveBtn = shadow.getElementById('hs-kw-save');
  const copyBtn = shadow.getElementById('hs-kw-copy');

  copyBtn.addEventListener('click', () => {
    const flash = () => {
      const orig = copyBtn.innerHTML;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.innerHTML = orig; }, 1400);
    };
    const fallbackCopy = () => {
      const ta = document.createElement('textarea');
      ta.value = plainText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flash(); } catch (_) { /* ignore */ }
      ta.remove();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(plainText).then(flash).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  });

  saveBtn.addEventListener('click', () => {
    if (!isContextValid()) {
      window.location.reload();
      return;
    }
    // Term + sectioned summary → shows in extension dashboard via doSaveHighlight
    doSaveHighlight(plainText, saveBtn, null);
  });

  const place = () => {
    if (!anchor || !document.contains(anchor)) {
      if (key) anchor = document.querySelector(`.hs-kw-mark[data-hs-key="${CSS.escape(key)}"]`);
    }
    positionKeywordPopupAbsolute(host, anchor);
  };

  place();
  requestAnimationFrame(() => {
    host.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    host.style.opacity = '1';
    host.style.transform = 'translateY(0) scale(1)';
    place(); // re-measure after paint (height known); still absolute, no scroll follow
  });

  const onResize = () => place();
  window.addEventListener('resize', onResize);

  const onDocDown = (e) => {
    const path = e.composedPath();
    if (
      !path.includes(host) &&
      !path.some((n) => n?.classList?.contains?.('hs-kw-mark')) &&
      !path.some((n) => n?.id === 'hs-keyword-tile-root')
    ) {
      closeKeywordPopup();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);

  keywordPopupCleanup = () => {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('mousedown', onDocDown, true);
  };
}

// Boot floating tile after prefs load (see loadHsPrefs → applyFeaturePrefsToPage)

