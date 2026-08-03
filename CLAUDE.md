# Website Highlight Saver — Claude Rules

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

---

## Project Overview

**Website Highlight Saver** (v1.0.1) is a Chrome Extension (Manifest V3) that:
- Injects a floating tooltip on any webpage when text is selected (content script)
- Tooltip has three actions: **Save Highlight**, **AI Summary**, and **Summarize Page**
- **AI Summary** and **Summarize Page** open an in-page Shadow DOM modal calling the Groq API directly (formatting summaries into Overview, Agenda/Main Topics, and Key Takeaways)
- Features automated keyword highlighting and sectioned AI breakdown for saved text snippets
- Popup dashboard features a cloudy day/night Sky Theme aesthetic, pagination (10 items/page), instant search/delete, theme switcher (Light / Dark / System sync), password updates, and total highlights AI summary
- Auth uses Convex Auth (email/password); session tokens stored in `chrome.storage.local`


## Key Files

| File | Purpose |
|---|---|
| `content.js` | Tooltip + in-page AI modal (Shadow DOM, Groq API, Convex sync, theme sync, SPA handling) |
| `popup.js` | Extension popup — auth, CRUD, AI summary of all highlights, theme switcher |
| `popup.html` / `popup.css` | Popup UI — glassmorphism sky & dark themes, animations |
| `config.js` | Environment configuration for Convex deployment URL and Groq API key |
| `convex/` | Backend — auth, highlights schema, mutations, queries |
| `manifest.json` | MV3 config — permissions, host permissions, content scripts |

## Architecture Rules

- **Content script** (`content.js`) runs in the webpage context — it cannot use ES modules or import Convex client directly. It calls Convex via the HTTP REST API and Groq via `fetch`.
- **Popup** (`popup.js`) uses the Convex HTTP REST API and `chrome.storage.local` for the session token.
- **Session token** is stored in `chrome.storage.local` as `session_token` by the popup after login, and read by `content.js` for Convex sync.
- **Theme preference** (`light`, `dark`, `system`) is stored in `chrome.storage.local` and synchronized between popup UI and the in-page tooltip context.
- **Shadow DOM** is used for all injected UI to prevent CSS bleed from host pages.
- **API keys** live in `config.js` / `.env.local` (gitignored).

## Coding Conventions

- All injected UI (tooltip, modal) must use Shadow DOM (`attachShadow({ mode: 'open' })`)
- Always clear `window.getSelection()` when dismissing the tooltip to prevent re-triggering the `mouseup` handler
- Always wrap Chrome storage callbacks in their own `try/catch` — outer `try/catch` does NOT catch callback exceptions
- Check `isContextValid()` before any `chrome.*` API call in the content script
