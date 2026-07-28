// popup.js - Website Highlight Saver logic
// AI: Groq API (llama-3.3-70b-versatile)
// Storage: Convex cloud + chrome.storage.local (fallback)
// Auth: Convex email/password sessions

// ── Config ────────────────────────────────────────────────────────────────
const CONVEX_HTTP_URL = 'https://ardent-partridge-610.convex.site';

function syncConfigApiKey() {
  const envKey = window.HS_CONFIG?.GROQ_API_KEY;
  if (envKey && envKey !== 'YOUR_GROQ_API_KEY_HERE' && envKey !== 'REPLACE_WITH_YOUR_GROQ_API_KEY') {
    chrome.storage.local.set({ groq_api_key: envKey });
  }
}
syncConfigApiKey();

// ── Auth helpers (session token in chrome.storage.local) ──────────────────
function getSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['session_token', 'user_email'], (result) => {
      resolve({ token: result.session_token || null, email: result.user_email || null });
    });
  });
}

function saveSession(token, email) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ session_token: token, user_email: email }, resolve);
  });
}

function clearSession() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['session_token', 'user_email'], resolve);
  });
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ── Convex auth calls ─────────────────────────────────────────────────────
async function convexRegister(email, password) {
  const resp = await fetch(`${CONVEX_HTTP_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Registration failed');
  return data; // { token, email }
}

async function convexLogin(email, password) {
  const resp = await fetch(`${CONVEX_HTTP_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Login failed');
  return data; // { token, email }
}

async function convexLogout(token) {
  await fetch(`${CONVEX_HTTP_URL}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
}

// ── Convex highlights calls (require token) ───────────────────────────────
async function convexGetHighlights(token) {
  try {
    const resp = await fetch(`${CONVEX_HTTP_URL}/highlights`, {
      method: 'GET',
      headers: authHeaders(token)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? data : (data.highlights || []);
  } catch (e) {
    console.warn('[Highlight Saver] Convex GET failed:', e.message);
    return null;
  }
}

async function convexDeleteHighlight(token, id) {
  try {
    const resp = await fetch(`${CONVEX_HTTP_URL}/highlights/${id}`, {
      method: 'DELETE',
      headers: authHeaders(token)
    });
    return resp.ok;
  } catch (e) {
    console.warn('[Highlight Saver] Convex DELETE failed:', e.message);
    return false;
  }
}

// ══ Main UI ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {

  // ── Auth screen elements
  const authScreen    = document.getElementById('auth-screen');
  const mainApp       = document.getElementById('main-app');
  const tabLogin      = document.getElementById('tab-login');
  const tabRegister   = document.getElementById('tab-register');
  const authError     = document.getElementById('auth-error');
  const authEmail     = document.getElementById('auth-email');
  const authPassword  = document.getElementById('auth-password');
  const authSubmitBtn = document.getElementById('auth-submit-btn');

  // ── Main app elements
  const highlightsList    = document.getElementById('highlights-list');
  const emptyState        = document.getElementById('empty-state');
  const highlightCount    = document.getElementById('highlight-count');
  const searchInput       = document.getElementById('search-input');
  const summarizeAllBtn   = document.getElementById('summarize-all-btn');
  const userEmailDisplay  = document.getElementById('user-email-display');
  const signoutBtn        = document.getElementById('signout-btn');
  const summaryOverlay    = document.getElementById('summary-overlay');
  const closeSummaryBtn   = document.getElementById('close-summary-btn');
  const summaryTitle      = document.getElementById('summary-title');
  const summaryLoading    = document.getElementById('summary-loading');
  const summaryText       = document.getElementById('summary-text');
  const copySummaryBtn    = document.getElementById('copy-summary-btn');

  // ── Settings & Pagination elements
  const settingsBtn       = document.getElementById('settings-btn');
  const apiKeyBanner      = document.getElementById('api-key-banner');
  const apiKeyCancelBtn   = document.getElementById('api-key-cancel-btn');
  const apiKeyInput       = document.getElementById('api-key-input');
  const apiKeySaveBtn     = document.getElementById('api-key-save-btn');
  const tabSettingsKey    = document.getElementById('tab-settings-key');
  const tabSettingsPwd    = document.getElementById('tab-settings-pwd');
  const settingsKeySection= document.getElementById('settings-key-section');
  const settingsPwdSection= document.getElementById('settings-pwd-section');
  const pwdCurrent        = document.getElementById('pwd-current');
  const pwdNew            = document.getElementById('pwd-new');
  const pwdSaveBtn        = document.getElementById('pwd-save-btn');
  const pwdChangeError    = document.getElementById('pwd-change-error');

  const paginationControls= document.getElementById('pagination-controls');
  const prevPageBtn       = document.getElementById('prev-page-btn');
  const nextPageBtn       = document.getElementById('next-page-btn');
  const paginationInfo    = document.getElementById('pagination-info');

  const themeToggleBtn    = document.getElementById('theme-toggle-btn');
  const themeIconSun      = document.querySelector('.theme-icon-sun');
  const themeIconMoon     = document.querySelector('.theme-icon-moon');
  const summarizePageBtn  = document.getElementById('summarize-page-btn');

  let allHighlights = [];
  let currentFilteredHighlights = [];
  let currentToken  = null;
  let isLoginMode   = true;

  let currentPage = 1;
  const itemsPerPage = 10;

  // ── Theme Switcher ────────────────────────────────────────────────────────
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.setAttribute('data-theme', 'dark');
      themeIconSun?.classList.remove('hidden');
      themeIconMoon?.classList.add('hidden');
    } else {
      document.body.removeAttribute('data-theme');
      themeIconSun?.classList.add('hidden');
      themeIconMoon?.classList.remove('hidden');
    }
  }

  chrome.storage.local.get({ theme: 'light' }, (result) => {
    applyTheme(result.theme);
  });

  themeToggleBtn?.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const nextTheme = isDark ? 'light' : 'dark';
    applyTheme(nextTheme);
    chrome.storage.local.set({ theme: nextTheme });
  });

  // ── Summarize Page Button Handler ─────────────────────────────────────────
  summarizePageBtn?.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'SUMMARIZE_PAGE' });
        window.close();
      }
    });
  });



  // ── Boot: check for existing session ─────────────────────────────────────
  const { token, email } = await getSession();
  if (token) {
    currentToken = token;
    showMainApp(email);
  } else {
    showAuthScreen();
  }

  // ── Auth screen logic ─────────────────────────────────────────────────────
  function showAuthScreen() {
    authScreen.classList.remove('hidden');
    mainApp.classList.add('hidden');
  }

  function showMainApp(email) {
    authScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    userEmailDisplay.textContent = email || '';
    loadHighlights();
  }

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  function clearAuthError() {
    authError.classList.add('hidden');
    authError.textContent = '';
  }

  tabLogin.addEventListener('click', () => {
    isLoginMode = true;
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    authSubmitBtn.textContent = 'Sign In';
    clearAuthError();
  });

  tabRegister.addEventListener('click', () => {
    isLoginMode = false;
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    authSubmitBtn.textContent = 'Create Account';
    clearAuthError();
  });

  authSubmitBtn.addEventListener('click', async () => {
    const email    = authEmail.value.trim();
    const password = authPassword.value.trim();

    clearAuthError();
    if (!email || !password) { showAuthError('Please enter your email and password.'); return; }
    if (password.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }

    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = isLoginMode ? 'Signing in…' : 'Creating account…';

    try {
      const result = isLoginMode
        ? await convexLogin(email, password)
        : await convexRegister(email, password);

      currentToken = result.token;
      await saveSession(result.token, result.email);
      // Store session token for content.js to use
      chrome.storage.local.set({ session_token: result.token });
      syncConfigApiKey();
      showMainApp(result.email);

    } catch (err) {
      showAuthError(err.message);
    } finally {
      authSubmitBtn.disabled = false;
      authSubmitBtn.textContent = isLoginMode ? 'Sign In' : 'Create Account';
    }
  });

  // Allow Enter key to submit
  [authEmail, authPassword].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') authSubmitBtn.click();
    });
  });

  // ── Sign out ──────────────────────────────────────────────────────────────
  signoutBtn.addEventListener('click', async () => {
    if (currentToken) await convexLogout(currentToken);
    currentToken = null;
    allHighlights = [];
    await clearSession();
    chrome.storage.local.remove('session_token');
    showAuthScreen();
  });

  // ── Highlights ────────────────────────────────────────────────────────────
  async function loadHighlights() {
    if (!currentToken) return;
    try {
      const cloudHighlights = await convexGetHighlights(currentToken);
      if (cloudHighlights !== null) {
        allHighlights = cloudHighlights;
        chrome.storage.local.set({ highlights: allHighlights });
        renderHighlights(allHighlights);
      } else {
        // Fallback to local storage
        chrome.storage.local.get({ highlights: [] }, (result) => {
          allHighlights = result.highlights || [];
          renderHighlights(allHighlights);
        });
      }
    } catch (e) {
      console.error('[Highlight Saver] loadHighlights error:', e);
    }
  }

  function renderHighlights(highlights) {
    currentFilteredHighlights = highlights;
    highlightsList.innerHTML = '';
    highlightCount.textContent = `${highlights.length} saved`;

    if (highlights.length === 0) {
      emptyState.classList.remove('hidden');
      highlightsList.classList.add('hidden');
      paginationControls.classList.add('hidden');
      summarizeAllBtn.style.opacity = '0.5';
      summarizeAllBtn.style.pointerEvents = 'none';
      return;
    }

    emptyState.classList.add('hidden');
    highlightsList.classList.remove('hidden');
    summarizeAllBtn.style.opacity = '1';
    summarizeAllBtn.style.pointerEvents = 'auto';

    // Pagination calculations
    const totalPages = Math.ceil(highlights.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const pageItems = highlights.slice(startIndex, startIndex + itemsPerPage);

    pageItems.forEach(hl => {
      const card = document.createElement('div');
      card.className = 'highlight-card';
      card.dataset.id = hl.id;

      card.innerHTML = `
        <div class="highlight-text" title="Click to expand/collapse">${escapeHtml(hl.text)}</div>
        <div class="highlight-source">
          <div class="source-title">${escapeHtml(hl.title)}</div>
          <div class="source-meta">
            <a href="${escapeHtml(hl.url)}" target="_blank" class="source-url" title="${escapeHtml(hl.url)}">
              <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(getDomain(hl.url))}&sz=32" class="favicon-icon" alt="" onerror="this.style.display='none'"/>
              <span>${escapeHtml(getDomain(hl.url))}</span>
            </a>
            <span>${formatTime(hl.timestamp)}</span>
          </div>
        </div>

        <div class="card-actions">
          <button class="card-btn btn-summarize" data-id="${hl.id}">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.53c-.26-.81-1-1.4-1.9-1.4h-1v-3c0-.55-.45-1-1-1h-6v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.4z"/></svg>
            AI Summary
          </button>
          <button class="card-btn btn-delete" data-id="${hl.id}">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            Delete
          </button>
        </div>
      `;

      card.querySelector('.highlight-text').addEventListener('click', function() {
        this.classList.toggle('expanded');
      });
      card.querySelector('.btn-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHighlight(hl.id);
      });
      card.querySelector('.btn-summarize').addEventListener('click', (e) => {
        e.stopPropagation();
        summarizeSingle(hl.text);
      });

      highlightsList.appendChild(card);
    });

    // Render pagination controls
    if (highlights.length > itemsPerPage) {
      paginationControls.classList.remove('hidden');
      paginationInfo.textContent = `Page ${currentPage} of ${totalPages}`;
      prevPageBtn.disabled = (currentPage <= 1);
      nextPageBtn.disabled = (currentPage >= totalPages);
    } else {
      paginationControls.classList.add('hidden');
    }
  }

  // ── Pagination Controls Handlers ─────────────────────────────────────────
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderHighlights(currentFilteredHighlights);
      highlightsList.scrollTop = 0;
    }
  });

  nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(currentFilteredHighlights.length / itemsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      renderHighlights(currentFilteredHighlights);
      highlightsList.scrollTop = 0;
    }
  });

  // ── Settings Panel & Password Change Handlers ─────────────────────────────
  settingsBtn.addEventListener('click', () => {
    apiKeyBanner.classList.toggle('hidden');
  });

  apiKeyCancelBtn.addEventListener('click', () => {
    apiKeyBanner.classList.add('hidden');
  });

  tabSettingsKey?.addEventListener('click', () => {
    tabSettingsKey.classList.add('active');
    tabSettingsPwd?.classList.remove('active');
    settingsKeySection?.classList.remove('hidden');
    settingsPwdSection?.classList.add('hidden');
  });

  tabSettingsPwd?.addEventListener('click', () => {
    tabSettingsPwd.classList.add('active');
    tabSettingsKey?.classList.remove('active');
    settingsPwdSection?.classList.remove('hidden');
    settingsKeySection?.classList.add('hidden');
  });

  apiKeySaveBtn?.addEventListener('click', () => {
    const val = apiKeyInput?.value.trim();
    if (!val) return;
    chrome.storage.local.set({ groq_api_key: val }, () => {
      apiKeySaveBtn.textContent = 'Saved!';
      setTimeout(() => {
        apiKeySaveBtn.textContent = 'Save';
        apiKeyBanner.classList.add('hidden');
      }, 1000);
    });
  });


  pwdSaveBtn.addEventListener('click', async () => {
    const currentPassword = pwdCurrent.value.trim();
    const newPassword     = pwdNew.value.trim();

    pwdChangeError.classList.add('hidden');
    pwdChangeError.style.color = '';
    if (!currentPassword || !newPassword) {
      pwdChangeError.textContent = 'Please enter both current and new password.';
      pwdChangeError.classList.remove('hidden');
      return;
    }
    if (newPassword.length < 6) {
      pwdChangeError.textContent = 'New password must be at least 6 characters.';
      pwdChangeError.classList.remove('hidden');
      return;
    }

    pwdSaveBtn.disabled = true;
    pwdSaveBtn.textContent = 'Updating…';

    try {
      const resp = await fetch(`${CONVEX_HTTP_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: currentToken,
          currentPassword,
          newPassword
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to update password');

      pwdChangeError.textContent = '✓ Password updated successfully!';
      pwdChangeError.style.color = 'var(--success)';
      pwdChangeError.classList.remove('hidden');
      pwdCurrent.value = '';
      pwdNew.value = '';
    } catch (err) {
      pwdChangeError.textContent = err.message;
      pwdChangeError.style.color = '';
      pwdChangeError.classList.remove('hidden');
    } finally {
      pwdSaveBtn.disabled = false;
      pwdSaveBtn.textContent = 'Update Password';
    }
  });

  async function deleteHighlight(id) {
    const card = highlightsList.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
    }

    if (currentToken) await convexDeleteHighlight(currentToken, id);

    chrome.storage.local.get({ highlights: [] }, (result) => {
      const updated = (result.highlights || []).filter(hl => hl.id !== id);
      chrome.storage.local.set({ highlights: updated }, () => {
        setTimeout(() => loadHighlights(), 200);
      });
    });
  }

  // ── Search ────────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', (e) => {
    currentPage = 1;
    const query = e.target.value.toLowerCase().trim();
    const filtered = allHighlights.filter(hl =>
      hl.text.toLowerCase().includes(query) ||
      hl.title.toLowerCase().includes(query) ||
      hl.url.toLowerCase().includes(query)
    );
    renderHighlights(filtered);
  });


  // ── Summary overlay ───────────────────────────────────────────────────────
  closeSummaryBtn.addEventListener('click', () => summaryOverlay.classList.add('hidden'));

  copySummaryBtn.addEventListener('click', () => {
    const textToCopy = summaryText.innerText;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      const orig = copySummaryBtn.innerHTML;
      copySummaryBtn.textContent = 'Copied!';
      copySummaryBtn.style.background = 'var(--success)';
      copySummaryBtn.style.borderColor = 'var(--success)';
      setTimeout(() => {
        copySummaryBtn.innerHTML = orig;
        copySummaryBtn.style.background = '';
        copySummaryBtn.style.borderColor = '';
      }, 1200);
    });
  });

  // ── Summarize single highlight (smart mode) ───────────────────────────────
  function summarizeSingle(text) {
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    let panelTitle, prompt;

    if (wordCount <= 2) {
      panelTitle = `✦ Word Lookup: "${trimmed}"`;
      prompt = `The user is reading a webpage and highlighted the word or phrase: "${trimmed}"

Please provide a rich, well-structured explanation covering:
1. **Definition** – What does it mean? (include all common meanings if it has multiple)
2. **Part of Speech** – (noun, verb, adjective, etc.)
3. **Etymology** – Brief origin of the word (if interesting)
4. **Example Sentences** – 2 natural example sentences using the word
5. **Synonyms** – 3–5 similar words
6. **Usage Tip** – Any nuance, common mistake, or context where this word is used

Keep the tone clear, friendly, and educational. Format using bold headings and short bullet points.`;
    } else if (wordCount <= 10) {
      panelTitle = `✦ Phrase Explained`;
      prompt = `The user highlighted this short phrase or term from a webpage: "${trimmed}"

Please explain:
1. **Meaning** – What does this phrase/term mean?
2. **Context** – Where is it commonly used? (e.g. technical, literary, casual)
3. **Example** – One sentence showing it in use
4. **Related terms** – 2–3 similar or related phrases

Keep it concise, clear, and useful for someone who is learning.`;
    } else {
      panelTitle = 'AI Highlight Summary';
      prompt = `Summarize this text highlighting the key points:\n\n"${trimmed}"`;
    }

    showSummaryPanel(panelTitle);
    requestGroqSummary(prompt);
  }

  // ── Summarize all ─────────────────────────────────────────────────────────
  summarizeAllBtn.addEventListener('click', () => {
    if (allHighlights.length === 0) return;
    showSummaryPanel('AI Combined Digest');
    const combined = allHighlights
      .map((hl, i) => `Highlight ${i + 1} (from "${hl.title}"):\n"${hl.text}"`)
      .join('\n\n');
    requestGroqSummary(
      `Below are multiple text highlights collected from websites. Create a coherent, structured digest summarizing the core information and key takeaways. Use bullet points where appropriate.\n\n${combined}`
    );
  });

  // ── Groq API call (reads key from chrome.storage.local) ─────────────────
  async function requestGroqSummary(prompt) {
    // Read the Groq key stored during login (or set manually)
    const stored = await new Promise(resolve =>
      chrome.storage.local.get(['groq_api_key'], resolve)
    );
    const apiKey = stored.groq_api_key || '';

    if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_GROQ_API_KEY') {
      renderSummaryError('AI service is currently unavailable. Please try again later.');
      return;
    }


    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a professional reading assistant. Provide concise, clear, and structured summaries using simple paragraphs and bullet points. Do not include introductory filler.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 400
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      renderSummaryText(data.choices[0].message.content.trim());
    } catch (error) {
      renderSummaryError(error.message);
    }
  }

  // ── Summary helpers ───────────────────────────────────────────────────────
  function showSummaryPanel(title) {
    summaryTitle.textContent = title;
    summaryOverlay.classList.remove('hidden');
    summaryLoading.classList.remove('hidden');
    summaryText.classList.add('hidden');
    summaryText.innerHTML = '';
    copySummaryBtn.disabled = true;
    copySummaryBtn.style.opacity = '0.5';
  }

  function renderSummaryText(text) {
    summaryLoading.classList.add('hidden');
    summaryText.classList.remove('hidden');
    summaryText.innerHTML = formatMarkdown(text);
    copySummaryBtn.disabled = false;
    copySummaryBtn.style.opacity = '1';
  }

  function renderSummaryError(msg) {
    summaryLoading.classList.add('hidden');
    summaryText.classList.remove('hidden');
    summaryText.innerHTML = `<div style="color:var(--danger);padding:8px;border:1px solid rgba(239,68,68,0.2);border-radius:8px;background:rgba(239,68,68,0.05);font-size:12px;line-height:1.5;"><strong>Error:</strong><br>${escapeHtml(msg)}</div>`;
    copySummaryBtn.disabled = false;
    copySummaryBtn.style.opacity = '1';
  }

  // ── Utility helpers ───────────────────────────────────────────────────────
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }


  function getDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
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

});
