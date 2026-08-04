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

## Gemini Nano vs Groq
- [ ] Settings → **AI providers** shows Nano status Available / Unavailable + reason
- [ ] **Recheck Nano** re-probes the Prompt API (does not fake success)
- [ ] AI Summary modal / side-panel AI results show a badge: **Gemini Nano** or **Groq (fallback)**
- [ ] Timeline rows include the same provider label + latency

### If Nano is Unavailable
1. Use Chrome 128+ (Canary / Dev recommended)
2. Enable `chrome://flags/#prompt-api-for-gemini-nano`
3. Enable `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
4. Restart Chrome; wait for the model under `chrome://components` (Optimization Guide On Device Model) or `chrome://on-device-internals`
5. Reload the extension → Settings → Recheck Nano
6. Run AI Summary again — badge should say **Gemini Nano** when the probe succeeds

If Prompt API is missing in the service worker context, status stays Unavailable and AI correctly uses **Groq (fallback)** — never a fake Nano response.

## Core flows
- [ ] Select text on a page → tooltip Save / Summarize / Explain / Page
- [ ] Save highlight → appears in side panel Highlights (offline OK)
- [ ] Search + delete highlight
- [ ] Notes tab: create markdown note, pin/favorite, tags, Summarize/Rewrite/Flashcards
- [ ] Settings: theme Light/Dark/System; feature toggles; privacy Private/Sync/Cloud AI
- [ ] Workspace switcher filters scoped data
- [ ] AI Summary works with Gemini Nano and/or developer-bundled Groq (no user key paste)
- [ ] AI Timeline shows recent actions with provider + latency
- [ ] Keyword insights tile (top-right) + pastel sticky-note marks on page when prefs enable them
- [ ] Sign in → Sync mode → save highlight/note → Sync now shows pushed > 0 (Convex)

## Security spot-checks
- [ ] Content script bundle has no `gsk_` / Groq bearer strings
- [ ] Invalid runtime messages rejected (wrong type / oversize)
