# AI Knowledge Assistant — Extension

Greenfield MV3 rebuild (Vite + React + TypeScript + Tailwind).

## Build

From repo root:

```bash
npm install
npm run build
```

Load unpacked in Chrome: **`extension/dist`**

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

## Architecture

- `src/background` — service worker (AI, sync, message bus)
- `src/content` — selection tooltip + keyword tile (Shadow DOM)
- `src/sidepanel` — React dashboard
- `src/shared` — messaging, IndexedDB, AI, sync, vectors, personalization
