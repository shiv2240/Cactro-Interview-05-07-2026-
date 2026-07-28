// content.js - Website Highlight Saver Content Script
// Storage: Convex cloud + chrome.storage.local (fallback)
const CONVEX_HTTP_URL = 'https://ardent-partridge-610.convex.site';
const GROQ_API_URL    = 'https://api.groq.com/openai/v1/chat/completions';
// Groq API key is stored in chrome.storage.local as 'groq_api_key' (set by the popup).
// Set it once via the extension popup settings or chrome.storage.local.set({ groq_api_key: 'gsk_...' })


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

  // Don't trigger if click was inside our AI modal
  const modal = document.getElementById('hs-ai-modal-root');
  if (modal && eventPath.includes(modal)) return;

  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString().trim();
    if (!text) return;

    const existing = document.getElementById('highlight-saver-tooltip-root');
    if (existing && eventPath.includes(existing)) return;
    if (existing) existing.remove();

    const contextValid = isContextValid();
    showTooltip(selection, text, contextValid);
  }, 10);
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

function buildPrompt(text) {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount <= 2) {
    return {
      title: `✦ Word Lookup: "${trimmed}"`,
      prompt: `The user is reading a webpage and highlighted the word or phrase: "${trimmed}"

Please provide a rich, well-structured explanation covering:
1. **Definition** – What does it mean? (include all common meanings if multiple)
2. **Part of Speech** – (noun, verb, adjective, etc.)
3. **Etymology** – Brief origin of the word (if interesting)
4. **Example Sentences** – 2 natural example sentences
5. **Synonyms** – 3–5 similar words
6. **Usage Tip** – Any nuance, common mistake, or context

Keep the tone clear, friendly, and educational. Format using bold headings and short bullet points.`
    };
  } else if (wordCount <= 10) {
    return {
      title: `✦ Phrase Explained`,
      prompt: `The user highlighted this short phrase or term: "${trimmed}"

Please explain:
1. **Meaning** – What does this phrase/term mean?
2. **Context** – Where is it commonly used? (e.g. technical, literary, casual)
3. **Example** – One sentence showing it in use
4. **Related terms** – 2–3 similar or related phrases

Keep it concise, clear, and useful for someone who is learning.`
    };
  } else {
    return {
      title: '✦ AI Summary',
      prompt: `Summarize this highlighted text, extracting the key points and insights:\n\n"${trimmed}"\n\nBe concise. Use bullet points for key takeaways.`
    };
  }
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
function showTooltip(selection, text, contextValid) {
  try {
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rect  = range.getBoundingClientRect();

    const container = document.createElement('div');
    container.id = 'highlight-saver-tooltip-root';
    container.style.cssText = 'position:absolute;z-index:2147483647;';

    const shadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .tooltip-container {
        pointer-events: auto;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: tooltip-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.97);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.10);
        padding: 6px 10px;
        border-radius: 28px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(99,102,241,0.15);
        user-select: none;
      }
      @keyframes tooltip-fade-in {
        from { opacity: 0; transform: translateY(8px) scale(0.93); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      .btn {
        border: none;
        padding: 7px 14px;
        border-radius: 20px;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.18s ease;
        outline: none;
        white-space: nowrap;
      }
      .btn-save {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff;
        box-shadow: 0 3px 10px rgba(99,102,241,0.35);
      }
      .btn-save:hover {
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        transform: translateY(-1px);
        box-shadow: 0 5px 14px rgba(99,102,241,0.5);
      }
      .btn-save:active { transform: translateY(0); }
      .btn-save.warning {
        background: rgba(244,63,94,0.12);
        color: #f43f5e;
        border: 1px solid rgba(244,63,94,0.3);
        box-shadow: none;
      }
      .btn-save.warning:hover {
        background: rgba(244,63,94,0.22);
        border-color: rgba(244,63,94,0.5);
        box-shadow: 0 4px 12px rgba(244,63,94,0.25);
      }
      .btn-ai {
        background: linear-gradient(135deg, #0ea5e9, #6366f1);
        color: #fff;
        box-shadow: 0 3px 10px rgba(14,165,233,0.3);
      }
      .btn-ai:hover {
        background: linear-gradient(135deg, #0284c7, #4f46e5);
        transform: translateY(-1px);
        box-shadow: 0 5px 14px rgba(14,165,233,0.45);
      }
      .btn-ai:active { transform: translateY(0); }
      .divider {
        width: 1px;
        height: 20px;
        background: rgba(255,255,255,0.12);
        flex-shrink: 0;
      }
      .close-btn {
        background: none;
        border: none;
        color: rgba(255,255,255,0.4);
        cursor: pointer;
        font-size: 17px;
        padding: 2px 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s;
        outline: none;
        line-height: 1;
      }
      .close-btn:hover { color: #f43f5e; }
      .icon { display:inline-block; width:13px; height:13px; fill:currentColor; flex-shrink:0; }
    `;
    shadow.appendChild(style);

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip-container';

    // ── Save button ──────────────────────────────────────────────────────────
    const saveBtn = document.createElement('button');
    if (contextValid) {
      saveBtn.className = 'btn btn-save';
      saveBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        Save Highlight
      `;
    } else {
      saveBtn.className = 'btn btn-save warning';
      saveBtn.title = 'Click to refresh and re-enable';
      saveBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" style="fill:#f43f5e"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        Refresh to Save
      `;
    }

    // ── Divider ──────────────────────────────────────────────────────────────
    const divider = document.createElement('div');
    divider.className = 'divider';

    // ── AI Summary button ────────────────────────────────────────────────────
    const aiBtn = document.createElement('button');
    aiBtn.className = 'btn btn-ai';
    aiBtn.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>
      AI Summary
    `;

    // ── Close button ─────────────────────────────────────────────────────────
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Dismiss';

    tooltip.appendChild(saveBtn);
    tooltip.appendChild(divider);
    tooltip.appendChild(aiBtn);
    tooltip.appendChild(closeBtn);
    shadow.appendChild(tooltip);
    document.body.appendChild(container);

    // Position tooltip
    const tooltipWidth  = tooltip.offsetWidth  || 260;
    const tooltipHeight = tooltip.offsetHeight || 40;

    let top  = rect.top + window.scrollY - tooltipHeight - 10;
    let left = rect.left + window.scrollX + (rect.width - tooltipWidth) / 2;

    if (top < window.scrollY) top = rect.bottom + window.scrollY + 10;
    if (left < 10) left = 10;
    else if (left + tooltipWidth > document.documentElement.clientWidth + window.scrollX - 10)
      left = document.documentElement.clientWidth + window.scrollX - tooltipWidth - 10;

    container.style.top  = `${top}px`;
    container.style.left = `${left}px`;

    // ── Save button handler ──────────────────────────────────────────────────
    saveBtn.addEventListener('click', () => {
      if (!contextValid) { window.location.reload(); return; }
      doSaveHighlight(text, saveBtn, () => {
        // Fade out tooltip after save
        setTimeout(() => {
          container.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
          container.style.opacity    = '0';
          container.style.transform  = 'translateY(-4px) scale(0.95)';
          window.getSelection()?.removeAllRanges();
          setTimeout(() => container.remove(), 250);
        }, 900);
      });
    });

    // ── AI Summary button handler ────────────────────────────────────────────
    aiBtn.addEventListener('click', () => {
      container.remove();
      window.getSelection()?.removeAllRanges();
      showAiSummaryModal(text, contextValid);
    });

    closeBtn.addEventListener('click', () => {
      window.getSelection()?.removeAllRanges();
      container.remove();
    });

  } catch (err) {
    console.error('[Highlight Saver] showTooltip error:', err);
  }
}

// ── Save highlight logic (reusable) ─────────────────────────────────────────
function doSaveHighlight(text, feedbackEl, onSaved) {
  if (!isContextValid()) { window.location.reload(); return; }

  const newHighlight = {
    id:        'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    text:      text,
    url:       window.location.href,
    title:     document.title || window.location.hostname,
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
                const token  = stored.session_token;
                if (!token) { console.warn('[Highlight Saver] No session token — Convex sync skipped.'); return; }
                const r = await fetch(`${CONVEX_HTTP_URL}/highlights`, {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body:    JSON.stringify(newHighlight)
                });
                if (r.ok) console.log('[Highlight Saver] Synced to Convex.');
                else      console.warn('[Highlight Saver] Convex sync failed:', r.status);
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

// ── AI Summary In-Page Modal ─────────────────────────────────────────────────
function showAiSummaryModal(text, contextValid) {
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
    .fbtn-close {
      background: transparent;
      color: rgba(148,163,184,0.7);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .fbtn-close:hover { color: #f1f5f9; background: rgba(255,255,255,0.06); }

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

  const { title: modalTitle } = buildPrompt(text);

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
        <div class="header-subtitle">Powered by Groq · LLaMA 3.3 70B</div>
      </div>
    </div>
    <button class="close-modal-btn" id="hs-close-modal">&times;</button>
  `;

  // Preview of selected text
  const preview = document.createElement('div');
  preview.className = 'selected-preview';
  preview.innerHTML = `<div class="preview-label">Selected Text</div>${escapeHtml(text)}`;

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
    modal.style.transition   = 'opacity 0.2s ease, transform 0.2s ease';
    backdrop.style.transition = 'opacity 0.2s ease';
    modal.style.opacity      = '0';
    modal.style.transform    = 'scale(0.95)';
    backdrop.style.opacity   = '0';
    setTimeout(() => host.remove(), 220);
  };
  closeModalBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

  // ── Wire up Save ─────────────────────────────────────────────────────────
  const saveBtn  = shadow.getElementById('hs-save-btn');
  const copyBtn  = shadow.getElementById('hs-copy-btn');

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


    // Persist valid key to chrome.storage.local for future consistency
    chrome.storage.local.set({ groq_api_key: apiKey });

    // Show loading skeleton
    showLoading(body);

    // Call Groq
    try {
      const { prompt } = buildPrompt(text);
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          messages: [
            {
              role:    'system',
              content: 'You are a professional reading assistant. Provide concise, clear, and structured explanations using bold headings and bullet points. Do not include introductory filler phrases.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          max_tokens:  500
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }

      const data    = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '(No response)';

      showResult(body, content);
      copyBtn.disabled = false;

      // Copy handler
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => {
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
      showError(body, err.message);
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
      <p>Sign in via the extension popup to use AI Summary.<br>Your highlights and AI features are tied to your account.</p>
      <div class="hint">
        <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        Click the extension icon in the toolbar to sign in
      </div>
    </div>
  `;
}
