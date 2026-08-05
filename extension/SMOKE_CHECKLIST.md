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

## AI (multi-model, automatic)
- [ ] Settings → **AI** explains fast primary + backup on failure — no Nano status, no flags, no key paste
- [ ] AI Summary / side-panel AI results do **not** show Gemini Nano or Groq provider badges
- [ ] Timeline rows show action + latency (no provider brand names)
- [ ] 👍 Like on AI results increments Personalization Liked count
- [ ] AI still works when primary fails (automatic backup; never fake responses)

## Core flows
- [ ] Select text on a page → tooltip Save / Summarize / Explain / Page
- [ ] Save highlight → appears in side panel Highlights (offline OK)
- [ ] Search filters the **full** highlights list, then paginates 10 / page (Prev / Next)
- [ ] Notes search filters the **full** notes list, then paginates 10 / page
- [ ] Delete highlight
- [ ] Notes tab: create markdown note, pin/favorite, tags, Summarize/Rewrite/Flashcards (rendered via Streamdown)
- [ ] Settings: theme Light/Dark/System; feature toggles; privacy Private/Sync/Cloud AI
- [ ] Workspace switcher filters scoped data
- [ ] AI Summary works with no user key paste or chrome://flags setup
- [ ] AI Timeline shows recent actions with latency, Streamdown rendering, and 10 items / page pagination
- [ ] Keyword insights tile (top-right) + pastel sticky-note marks on page when prefs enable them
- [ ] Sign in → Sync mode → save highlight/note → Sync now shows pushed > 0 (Convex)

## Security spot-checks
- [ ] Content script bundle has no `gsk_` / Groq bearer strings
- [ ] Invalid runtime messages rejected (wrong type / oversize)
