# Browser Extension (MVP) — Design

Date: 2026-09-24 | PRD: `.opencode/datacloak-prd.md` v0.2 §6

## 1. Goal

`packages/browser-extension`: MV3 extension that finds the chatbot input box,
cloaks on send, restores echoes in responses. Same engine, same guarantees
as the OpenCode plugin. Chrome/Edge now; Firefox compat flagged, not tested.

## 2. Architecture

```
content.ts  (per supported site: find input → intercept send → rewrite → badge)
    ↕ chrome.runtime.sendMessage {type: 'cloak'|'restore', text, tabId}
background.ts (service worker: DataCloakEngine per tabId + vault in chrome.storage.session)
popup/ (viewer: session counts, vault synthetics+blurred originals, rule toggles)
sites.ts (per-site input selectors + send-button hooks, generic fallback)
```

- **Input detection**: per-site selector map first (`textarea`, `[contenteditable]`
  in the composer region); fallback: largest visible empty-ish textarea/
  contenteditable in viewport bottom half. Scored, not hardcoded-only.
- **Send interception**: capture-phase `keydown` (Enter without shift) +
  click listener on send button + `submit` on composer form. Cloak via
  background, rewrite field value, then re-dispatch the original event
  (`isTrusted` cannot be faked — instead call the site's own submit path:
  set value + click the real button / dispatch Enter that our listener
  ignores once via token flag).
- **Modes**: auto-cloak default. Review mode: block submit, inline panel
  per detection (Accept/Skip/Cloak-all), then proceed. Stored in
  chrome.storage.sync.
- **Response restore**: MutationObserver on chat log container; on
  settle (no mutations 800ms), replace known synthetics with originals,
  wrap in `<span class="dc-restored">` with `↩ restored` title attr.
- **Vault isolation**: `chrome.storage.session` keyed per tabId; cleared
  on tab close; never synced. Background keeps engine instances in memory
  (service-worker lifetime — rehydrate vault from session storage on wake).

## 3. Permissions (minimum)

`storage` + host permissions for 8 sites only
(claude.ai, chat.openai.com, chatgpt.com, gemini.google.com, x.ai, perplexity.ai,
cowork.ai, chat.deepseek.com). No tabs, no webRequest, no cookies.

## 4. Build

esbuild bundles `src/background.ts` (with `@pratikw/detect` + faker) and
`src/content.ts` (engine-free: messaging + DOM only) to `dist/`.
`manifest.json` references dist. `web-ext lint` for Firefox-compat flags
if available, else manual MV3-key audit.

## 5. Layout

```
packages/browser-extension/
  manifest.json  package.json  tsconfig.json
  src/{sites.ts,content.ts,background.ts,popup.ts}  popup.html  icons/
  test/{sites.test.ts,protocol.test.ts}
```

## 6. Testing (no live browser)

Vitest + happy-dom: composer fixtures per site (minimal textarea/button
trees) → input finder returns right node; submit-interceptor rewrites value
and calls through exactly once; message protocol (cloak/restore shapes);
review-panel accept/skip logic; vault per-tab namespacing with mocked
chrome.storage.session. No selenium/playwright.

## Self-review

- No TBDs. Site-selector churn is the known risk: mitigated by generic
  fallback + scored selection, documented.
- Service-worker wake/rebind: vault rehydrate path specified.
- Trusted-event problem solved via real-button-click + once-flag, not
  synthetic event spoofing.
- fetch/XHR-based submitters bypass DOM interception (no webRequest per
  permissions floor) — accepted MVP constraint.
