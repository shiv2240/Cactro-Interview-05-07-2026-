# AI Knowledge Assistant — Extension

Greenfield MV3 rebuild (Vite + React + TypeScript + Tailwind).

## Build

From repo root:

```bash
npm install
npm run build
```

### Load unpacked (required)

In Chrome → `chrome://extensions` → Developer mode → **Load unpacked**:

**Select `extension/dist` only** — not the repo root, not `extension/`.

- Repo root has a stub manifest that opens a “wrong folder” popup on purpose.
- `extension/` source manifests point at TypeScript; Chrome cannot run those.
- Toolbar click opens the **side panel** dashboard (`sidePanel` + `openPanelOnActionClick`).

Dev (HMR):

```bash
npm run dev
```

Then load the temporary dist path printed by CRX, or use `extension/dist` after build.

## Typecheck

```bash
npm run typecheck
```

## Environment

Copy `extension/.env.example` → `extension/.env` (gitignored).

- `VITE_CONVEX_HTTP_URL` — Convex HTTP actions base URL
- `VITE_GROQ_API_KEY` — optional build-time key (prefer Settings → Groq key in chrome.storage)

**Never import `swConfig` / Groq keys from content scripts.**

## Sync model

| Data | IndexedDB | Convex (Sync / Cloud AI + signed in) |
|---|---|---|
| Highlights | Always | Yes |
| Notes | Always | Yes |
| Auth session | chrome.storage | Convex auth HTTP |
| Prefs / theme / feature toggles | IndexedDB + chrome.storage mirror | Optional preferences route |
| AI timeline, vectors, personalization, Groq key | Local only | No |

**Private** mode disables highlight/note sync. Default privacy mode is **Sync**.

## Architecture

- `src/background` — service worker (AI, sync, message bus)
- `src/content` — selection tooltip + keyword tile + sticky-note marks (Shadow DOM)
- `src/sidepanel` — React dashboard (mist/ink)
- `src/shared` — messaging, IndexedDB, AI, sync, vectors, personalization
