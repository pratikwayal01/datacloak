# Chrome Web Store listing (paste-ready)

Upload file: `datacloak-0.1.0.zip` (manifest at zip root — rebuild with
`npm run build --workspace packages/browser-extension`, then zip the
package dir CONTENTS, not the dir itself).

## Title

DataCloak — stop leaking secrets to AI chat

## Short description (132 chars max)

Swaps API keys, PII and secrets for realistic fakes before AI chat sees them. Restores originals on return. 100% local.

## Detailed description

Paste a password, API key or customer email into Claude, ChatGPT, Gemini,
Grok, Perplexity, Cowork or DeepSeek and it goes straight to someone else's
server. DataCloak sits between you and the chat box: it detects secrets and
PII as you hit send and replaces them with realistic synthetic fakes — same
shape, same meaning, zero real data. When the model replies, echoes are
swapped back to your real values locally.

- Auto-cloak on send, per-item review mode
- API keys, JWTs, env vars, emails, phones, IPs, names, addresses
- Per-tab vault in chrome.storage.session — cleared when the tab closes
- No account, no server, no telemetry. Fully offline after install.

Open source (MIT): https://github.com/pratikwayal01/datacloak

## Category

Productivity > Privacy & Security

## Single purpose

Protect AI chat prompts from accidental secret/PII exposure via local
synthetic substitution.

## Permission justifications

- `storage`: session vault (cleared on tab close) + mode preference sync.
- Host permissions (7 AI chat sites only): read the chat input to cloak
  before submit; scan responses to restore echoes. No other sites touched.
- No `tabs`, `webRequest`, `cookies`, history, or clipboard access.

## Data usage answers

- No data collected, transmitted, or sold. All processing on-device.
- No remote code (no CDN in extension pages; all JS bundled).
