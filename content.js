// content.js - Website Highlight Saver Content Script

document.addEventListener('mousedown', (e) => {
  // If tooltip container exists and click target is not within the tooltip container, remove it
  const existing = document.getElementById('highlight-saver-tooltip-root');
  if (existing) {
    // Note: click target on shadow host evaluates to host itself
    if (e.target !== existing && !existing.contains(e.target)) {
      existing.remove();
    }
  }
});

document.addEventListener('mouseup', (e) => {
  // Wait a small timeout to let the selection populate completely
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString().trim();

    if (!text) {
      return;
    }

    // Check if the click happened inside the existing tooltip
    const existing = document.getElementById('highlight-saver-tooltip-root');
    if (existing) {
      // Find if clicked element is inside the shadow root of the existing container
      const path = e.composedPath();
      if (path.includes(existing)) {
        return;
      }
    }

    // Remove existing tooltip if there is one
    if (existing) {
      existing.remove();
    }

    const contextValid = isContextValid();
    showTooltip(selection, text, contextValid);
  }, 10);
});

function isContextValid() {
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function showTooltip(selection, text, contextValid) {
  try {
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Create host element
    const container = document.createElement('div');
    container.id = 'highlight-saver-tooltip-root';

    // Position host element absolute on body
    container.style.position = 'absolute';
    container.style.zIndex = '2147483647';

    // Attach Shadow DOM
    const shadow = container.attachShadow({ mode: 'open' });

    // Add CSS
    const style = document.createElement('style');
    style.textContent = `
      .tooltip-container {
        pointer-events: auto;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: tooltip-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(26, 26, 36, 0.95);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 8px 14px;
        border-radius: 24px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        user-select: none;
      }
      @keyframes tooltip-fade-in {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      .save-btn {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #ffffff;
        border: none;
        padding: 7px 16px;
        border-radius: 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
        outline: none;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
      }
      .save-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(99, 102, 241, 0.45);
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
      }
      .save-btn:active {
        transform: translateY(0);
      }
      .save-btn.warning-btn {
        background: rgba(244, 63, 94, 0.15);
        color: #f43f5e;
        border: 1px solid rgba(244, 63, 94, 0.3);
        box-shadow: none;
      }
      .save-btn.warning-btn:hover {
        background: rgba(244, 63, 94, 0.25);
        border-color: rgba(244, 63, 94, 0.5);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(244, 63, 94, 0.3);
      }
      .close-btn {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        font-size: 18px;
        padding: 2px 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s ease;
        outline: none;
        line-height: 1;
      }
      .close-btn:hover {
        color: #f43f5e;
      }
      .icon-star {
        display: inline-block;
        width: 14px;
        height: 14px;
        fill: currentColor;
      }
    `;
    shadow.appendChild(style);

    // Add tooltip body
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip-container';

    const saveBtn = document.createElement('button');
    if (contextValid) {
      saveBtn.className = 'save-btn';
      saveBtn.innerHTML = `
        <svg class="icon-star" viewBox="0 0 24 24">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
        </svg>
        Save Highlight
      `;
    } else {
      saveBtn.className = 'save-btn warning-btn';
      saveBtn.title = 'Click to refresh the tab and enable highlights';
      saveBtn.innerHTML = `
        <svg class="icon-star" viewBox="0 0 24 24" style="fill: #f43f5e; animation: pulse 2s infinite;">
          <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
        </svg>
        Refresh Page to Save
      `;
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Dismiss';

    tooltip.appendChild(saveBtn);
    tooltip.appendChild(closeBtn);
    shadow.appendChild(tooltip);

    document.body.appendChild(container);

    // Calculate sizing after appending to DOM for layout context
    const tooltipWidth = tooltip.offsetWidth || 185;
    const tooltipHeight = tooltip.offsetHeight || 38;

    // Calculate positioning relative to the page document
    let top = rect.top + window.scrollY - tooltipHeight - 10;
    let left = rect.left + window.scrollX + (rect.width - tooltipWidth) / 2;

    // Keep it on screen bounds
    if (top < window.scrollY) {
      top = rect.bottom + window.scrollY + 10; // Show below selection if there is no space above
    }
    if (left < 10) {
      left = 10;
    } else if (left + tooltipWidth > document.documentElement.clientWidth + window.scrollX - 10) {
      left = document.documentElement.clientWidth + window.scrollX - tooltipWidth - 10;
    }

    container.style.top = `${top}px`;
    container.style.left = `${left}px`;

    // Save highlight handler
    saveBtn.addEventListener('click', () => {
      if (!contextValid) {
        console.log('[Highlight Saver] Context is invalidated. Triggering page reload.');
        window.location.reload();
        return;
      }

      console.log('[Highlight Saver] Save button clicked. Attempting storage.local write.');

      try {
        chrome.storage.local.get({ highlights: [] }, (result) => {
          try {
            const lastError = chrome.runtime?.lastError;
            if (lastError) {
              console.error('[Highlight Saver] Runtime error in get:', lastError.message);
              alert('[Highlight Saver] Runtime error in get: ' + lastError.message);
              return;
            }

            const highlights = (result && result.highlights) ? result.highlights : [];
            const newHighlight = {
              id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
              text: text,
              url: window.location.href,
              title: document.title || window.location.hostname,
              timestamp: Date.now()
            };

            highlights.unshift(newHighlight);

            chrome.storage.local.set({ highlights }, () => {
              try {
                const setLastError = chrome.runtime?.lastError;
                if (setLastError) {
                  console.error('[Highlight Saver] Storage write error in set:', setLastError.message);
                  alert('[Highlight Saver] Storage write error: ' + setLastError.message);
                  return;
                }

                console.log('[Highlight Saver] Saved highlight successfully:', newHighlight);

                // Switch state to 'Saved!'
                saveBtn.innerHTML = `
                  <svg class="icon-star" viewBox="0 0 24 24" style="fill: #10b981;">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                  Saved!
                `;
                saveBtn.style.background = 'rgba(16, 185, 129, 0.15)';
                saveBtn.style.color = '#10b981';
                saveBtn.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                saveBtn.style.boxShadow = 'none';
                saveBtn.disabled = true;

                setTimeout(() => {
                  container.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                  container.style.opacity = '0';
                  container.style.transform = 'translateY(-4px) scale(0.95)';
                  setTimeout(() => {
                    container.remove();
                  }, 250);
                }, 800);
              } catch (setCbErr) {
                console.error('[Highlight Saver] Exception in set callback:', setCbErr);
                alert('[Highlight Saver] Set Callback error: ' + setCbErr.message);
              }
            });
          } catch (getCbErr) {
            console.error('[Highlight Saver] Exception in get callback:', getCbErr);
            alert('[Highlight Saver] Get Callback error: ' + getCbErr.message);
          }
        });
      } catch (err) {
        console.error('[Highlight Saver] Exception in save click:', err);
        alert('[Highlight Saver] Save failed: ' + err.message);
      }
    });

    closeBtn.addEventListener('click', () => {
      container.remove();
    });

  } catch (err) {
    console.error('Highlight Saver error:', err);
  }
}
