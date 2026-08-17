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

**Website Highlight Saver** (v2.0.1) is a Chrome Extension (Manifest V3) rebuilt as a local-first AI Knowledge Assistant that:
- Injects a floating tooltip on any webpage when text is selected (Shadow DOM context)
- Tooltip has three actions: **Save Highlight**, **AI Summary**, and **Summarize Page** (customizable via feature toggles in settings)
- **AI Summary** and **Summarize Page** open an in-page Shadow DOM modal with accessible header × buttons and marked HTML markdown rendering; AI runs in the background service worker using fast Groq-first multi-model routing (with automatic failover to on-device Nano) and real-time streaming for faster first paint.
- Features context cleaning (stripping Wikipedia/nav chrome and centering on keyword), **👍 Like** personalization training (which enriches prompts without clobbering base settings), custom **AI Tone & Style** preferences, automated keyword highlighting with a draggable, position-persisted keyword tile (`hs_tile_position`), and pastel sticky-note marks
- Side panel dashboard (React/Vite) features a mist-and-ink palette & sky theme aesthetic, Streamdown markdown response rendering, pagination (10 items/page for highlights, notes, and timelines), instant search/delete, live refresh broadcast across views, theme switcher (Light / Dark / System sync) with fixed dark-theme contrast, feature toggles, password updates, and total highlights/notes AI summaries/rewrites/flashcards
- Auth uses Convex Auth (email/password); session tokens stored in `chrome.storage.local` with IndexedDB-first offline support.

## Key Files (New Architecture under `extension/`)

| Directory / File | Purpose |
|---|---|
| `extension/src/content/` | Tooltip + in-page AI modal + keywords tile & sticky notes (Shadow DOM, theme & feature prefs sync, SPA handling) |
| `extension/src/sidepanel/` | React dashboard — notes, highlights, auth, CRUD, pagination, AI summary, theme switcher, feature toggles |
| `extension/src/background/` | Service worker (AI routing, sync, message bus) |
| `extension/src/shared/` | Messaging, IndexedDB, AI, sync, vectors, personalization |
| `config.js` / `extension/.env` | Environment configuration for Convex deployment URL and developer AI keys (not for end users). Provider brands are hidden in UI. |
| `convex/` | Backend — auth, highlights schema, mutations, queries |
| `extension/manifest.json` | MV3 config for the Vite build |

## Architecture Rules

- **Content script** runs in the webpage context — it cannot import Convex client directly. It calls the background service worker for AI and Convex sync via message passing.
- **Side Panel** uses the Convex HTTP REST API, IndexedDB for local-first storage, and `chrome.storage.local` for the session token and settings.
- **Session token** is stored in `chrome.storage.local` and read by the background script/content script for Convex sync.
- **Theme preference** (`light`, `dark`, `system`) is stored in `chrome.storage.local` and synchronized between the React UI and the in-page tooltip context.
- **Feature preferences** (`hs_feature_prefs`) control visibility for on-page keywords tile, sticky notes, and individual tooltip action buttons.
- **Shadow DOM** is used for all injected UI to prevent CSS bleed from host pages.
- **AI keys** (developer builds) live in `extension/.env` or root `config.js`. End users do not paste keys or see provider brands in the UI; multi-model AI (Groq primary, Nano fallback) switches automatically.
- **Coding Conventions**: Always clear `window.getSelection()` when dismissing the tooltip. Always wrap Chrome storage callbacks in their own `try/catch`. Check `isContextValid()` before any `chrome.*` API call in the content script.
