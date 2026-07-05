// popup.js - Website Highlight Saver logic

document.addEventListener('DOMContentLoaded', () => {
  let allHighlights = [];

  // DOM Elements
  const highlightsList = document.getElementById('highlights-list');
  const emptyState = document.getElementById('empty-state');
  const highlightCount = document.getElementById('highlight-count');
  const searchInput = document.getElementById('search-input');

  const summarizeAllBtn = document.getElementById('summarize-all-btn');
  const toggleSettingsBtn = document.getElementById('toggle-settings-btn');

  const settingsPanel = document.getElementById('settings-panel');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const openaiApiKeyInput = document.getElementById('openai-api-key');
  const saveSettingsBtn = document.getElementById('save-settings-btn');

  const summaryOverlay = document.getElementById('summary-overlay');
  const closeSummaryBtn = document.getElementById('close-summary-btn');
  const summaryTitle = document.getElementById('summary-title');
  const summaryLoading = document.getElementById('summary-loading');
  const summaryText = document.getElementById('summary-text');
  const copySummaryBtn = document.getElementById('copy-summary-btn');

  // Initialize
  loadHighlights();
  loadSettings();

  // Load highlights from storage
  function loadHighlights() {
    console.log('[Highlight Saver Popup] loadHighlights called.');
    try {
      chrome.storage.local.get({ highlights: [] }, (result) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.error('[Highlight Saver Popup] chrome.runtime.lastError inside get:', lastError.message);
          return;
        }
        allHighlights = (result && result.highlights) ? result.highlights : [];
        console.log('[Highlight Saver Popup] Loaded highlights from storage:', allHighlights);
        renderHighlights(allHighlights);
      });
    } catch (e) {
      console.error('[Highlight Saver Popup] Exception in storage get:', e);
    }
  }

  // Load settings (API key)
  function loadSettings() {
    console.log('[Highlight Saver Popup] loadSettings called.');
    try {
      chrome.storage.local.get(['openai_api_key'], (result) => {
        if (result && result.openai_api_key) {
          openaiApiKeyInput.value = result.openai_api_key;
        } else {
          // Pre-populate with the user provided key
          const defaultKey = 'Use your API key';
          openaiApiKeyInput.value = defaultKey;
          chrome.storage.local.set({ openai_api_key: defaultKey });
        }
      });
    } catch (e) {
      console.error('[Highlight Saver Popup] Exception in settings load:', e);
    }
  }

  // Render highlights list
  function renderHighlights(highlights) {
    console.log('[Highlight Saver Popup] renderHighlights rendering count:', highlights.length);
    highlightsList.innerHTML = '';

    // Update badge count
    highlightCount.textContent = `${highlights.length} saved`;

    if (highlights.length === 0) {
      console.log('[Highlight Saver Popup] Empty state shown.');
      emptyState.classList.remove('hidden');
      highlightsList.classList.add('hidden');
      summarizeAllBtn.style.opacity = '0.5';
      summarizeAllBtn.style.pointerEvents = 'none';
      return;
    }

    emptyState.classList.add('hidden');
    highlightsList.classList.remove('hidden');
    summarizeAllBtn.style.opacity = '1';
    summarizeAllBtn.style.pointerEvents = 'auto';

    highlights.forEach(hl => {
      const card = document.createElement('div');
      card.className = 'highlight-card';
      card.dataset.id = hl.id;

      card.innerHTML = `
        <div class="highlight-text" title="Click to expand/collapse">${escapeHtml(hl.text)}</div>
        <div class="highlight-source">
          <div class="source-title">${escapeHtml(hl.title)}</div>
          <div class="source-meta">
            <a href="${escapeHtml(hl.url)}" target="_blank" class="source-url" title="${escapeHtml(hl.url)}">${escapeHtml(getDomain(hl.url))}</a>
            <span>${formatTime(hl.timestamp)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="card-btn btn-summarize" data-id="${hl.id}">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.53c-.26-.81-1-1.4-1.9-1.4h-1v-3c0-.55-.45-1-1-1h-6v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.4z"/>
            </svg>
            AI Summary
          </button>
          <button class="card-btn btn-delete" data-id="${hl.id}">
            <svg viewBox="0 0 24 24">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
            Delete
          </button>
        </div>
      `;

      // Expand / Collapse card text on click
      const textDiv = card.querySelector('.highlight-text');
      textDiv.addEventListener('click', () => {
        textDiv.classList.toggle('expanded');
      });

      // Delete action
      const deleteBtn = card.querySelector('.btn-delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHighlight(hl.id);
      });

      // Summarize action
      const summarizeBtn = card.querySelector('.btn-summarize');
      summarizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        summarizeSingle(hl.text);
      });

      highlightsList.appendChild(card);
    });
  }

  // Delete Highlight Function
  function deleteHighlight(id) {
    chrome.storage.local.get({ highlights: [] }, (result) => {
      const updated = (result.highlights || []).filter(hl => hl.id !== id);
      chrome.storage.local.set({ highlights: updated }, () => {
        // Remove card visually with transition
        const card = highlightsList.querySelector(`[data-id="${id}"]`);
        if (card) {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';
          setTimeout(() => {
            loadHighlights();
          }, 200);
        } else {
          loadHighlights();
        }
      });
    });
  }

  // Real-time Search Filter
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const filtered = allHighlights.filter(hl =>
      hl.text.toLowerCase().includes(query) ||
      hl.title.toLowerCase().includes(query) ||
      hl.url.toLowerCase().includes(query)
    );
    renderHighlights(filtered);
  });

  // Settings Panel Toggles
  toggleSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  // Save Settings
  saveSettingsBtn.addEventListener('click', () => {
    const key = openaiApiKeyInput.value.trim();
    chrome.storage.local.set({ openai_api_key: key }, () => {
      saveSettingsBtn.textContent = 'Saved Key!';
      saveSettingsBtn.style.background = 'var(--success)';
      setTimeout(() => {
        saveSettingsBtn.textContent = 'Save API Key';
        saveSettingsBtn.style.background = '';
        settingsPanel.classList.add('hidden');
      }, 1000);
    });
  });

  // Close Summary Overlay
  closeSummaryBtn.addEventListener('click', () => {
    summaryOverlay.classList.add('hidden');
  });

  // Copy Summary to Clipboard
  copySummaryBtn.addEventListener('click', () => {
    const textToCopy = summaryText.innerText;
    if (!textToCopy) return;

    navigator.clipboard.writeText(textToCopy).then(() => {
      const originalText = copySummaryBtn.innerHTML;
      copySummaryBtn.textContent = 'Copied!';
      copySummaryBtn.style.background = 'var(--success)';
      copySummaryBtn.style.borderColor = 'var(--success)';
      setTimeout(() => {
        copySummaryBtn.innerHTML = originalText;
        copySummaryBtn.style.background = '';
        copySummaryBtn.style.borderColor = '';
      }, 1200);
    }).catch(err => {
      console.error('Could not copy text: ', err);
    });
  });

  // Summarize Single Highlight
  function summarizeSingle(text) {
    checkApiKeyAndRun((apiKey) => {
      showSummaryPanel('AI Highlight Summary');
      requestOpenAISummary(apiKey, `Summarize this text highlighting the key points: "${text}"`);
    });
  }

  // Summarize All Highlights
  summarizeAllBtn.addEventListener('click', () => {
    if (allHighlights.length === 0) return;

    checkApiKeyAndRun((apiKey) => {
      showSummaryPanel('AI Combined Digest');

      const combinedTexts = allHighlights
        .map((hl, index) => `Highlight ${index + 1} (from "${hl.title}"):\n"${hl.text}"`)
        .join('\n\n');

      requestOpenAISummary(
        apiKey,
        `Below are multiple text highlights collected from websites. Create a coherent, structured digest summarizing the core information and key takeaways across all of them. Use bullet points where appropriate.\n\n${combinedTexts}`
      );
    });
  });

  // Helper: Verify API Key is Set
  function checkApiKeyAndRun(callback) {
    chrome.storage.local.get(['openai_api_key'], (result) => {
      let apiKey = result.openai_api_key;
      if (!apiKey) {
        // Use user provided key as fallback
        apiKey = 'Use You API Key';
        chrome.storage.local.set({ openai_api_key: apiKey });
      }
      callback(apiKey);
    });
  }

  // Helper: Show Summary Panel
  function showSummaryPanel(title) {
    summaryTitle.textContent = title;
    summaryOverlay.classList.remove('hidden');
    summaryLoading.classList.remove('hidden');
    summaryText.classList.add('hidden');
    summaryText.innerHTML = '';
    copySummaryBtn.disabled = true;
    copySummaryBtn.style.opacity = '0.5';
  }

  // OpenAI Summary API Request
  async function requestOpenAISummary(apiKey, prompt) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a professional reading assistant. Provide concise, clear, and structured summaries using simple paragraphs and bullet points. Do not include introductory filler.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.5,
          max_tokens: 400
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const resultText = data.choices[0].message.content.trim();

      renderSummaryText(resultText);
    } catch (error) {
      console.error('OpenAI API Error:', error);
      renderSummaryError(error.message);
    }
  }

  // Render successful summary
  function renderSummaryText(text) {
    summaryLoading.classList.add('hidden');
    summaryText.classList.remove('hidden');
    summaryText.innerHTML = formatMarkdown(text);
    copySummaryBtn.disabled = false;
    copySummaryBtn.style.opacity = '1';
  }

  // Render error
  function renderSummaryError(errorMessage) {
    summaryLoading.classList.add('hidden');
    summaryText.classList.remove('hidden');
    summaryText.innerHTML = `
      <div style="color: var(--danger); padding: 8px; border: 1px solid rgba(239,68,68,0.2); border-radius: 8px; background: rgba(239,68,68,0.05); font-size: 12px; line-height: 1.5;">
        <strong>Error generating summary:</strong><br>${escapeHtml(errorMessage)}
      </div>
    `;
    copySummaryBtn.disabled = false;
    copySummaryBtn.style.opacity = '1';
  }

  // Helper: Format relative timestamp
  function formatTime(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  // Helper: Extract domain from URL
  function getDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace('www.', '');
    } catch (e) {
      return url;
    }
  }

  // Helper: HTML Escaper
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper: Basic Markdown Parser for Bold and Bullets
  function formatMarkdown(text) {
    if (!text) return '';

    // First escape HTML entities
    let html = escapeHtml(text);

    // Parse Bold: **text** -> <strong>text</strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Parse Lists
    const lines = html.split('\n');
    let inList = false;
    const processedLines = lines.map(line => {
      const trimmed = line.trim();

      // Match bullet points starting with - or * or •
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
        const content = trimmed.substring(2).trim();
        if (!inList) {
          inList = true;
          return '<ul><li>' + content + '</li>';
        }
        return '<li>' + content + '</li>';
      } else {
        let result = '';
        if (inList) {
          inList = false;
          result += '</ul>';
        }
        if (trimmed) {
          result += '<p>' + trimmed + '</p>';
        }
        return result;
      }
    });

    if (inList) {
      processedLines.push('</ul>');
    }

    return processedLines.join('');
  }
});
