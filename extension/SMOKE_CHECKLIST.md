# Extension smoke checklist (M6)

## Build
- [ ] `npm install`
- [ ] `npm run typecheck` passes
- [ ] `npm run build` produces `extension/dist/manifest.json`

## Load unpacked
1. Chrome → `chrome://extensions` → Developer mode
2. Load unpacked → select **`extension/dist`** (not repo root, not `extension/`)
3. Pin the extension; click icon → **side panel** dashboard opens
4. If you see “Wrong folder”, you loaded the repo root — unload and pick `extension/dist`

## Core flows
- [ ] Select text on a page → tooltip Save / Summarize / Explain / Page
- [ ] Save highlight → appears in side panel Highlights (offline OK)
- [ ] Search + delete highlight
- [ ] Notes tab: create markdown note, pin/favorite, tags, Summarize/Rewrite/Flashcards
- [ ] Settings: theme Light/Dark/System; feature toggles; privacy Private/Sync/Cloud AI
- [ ] Workspace switcher filters scoped data
- [ ] Groq key in Settings (SW-only) OR Gemini Nano when available
- [ ] AI Timeline shows recent actions with provider + latency
- [ ] Keyword insights tile (top-right) + pastel sticky-note marks on page when prefs enable them
- [ ] Sign in → Sync mode → save highlight/note → Sync now shows pushed > 0 (Convex)

## Security spot-checks
- [ ] Content script bundle has no `gsk_` / Groq bearer strings
- [ ] Invalid runtime messages rejected (wrong type / oversize)
