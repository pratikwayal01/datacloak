# Privacy policy

*Effective: September 2026. DataCloak has no company, no account system,
no server, and no telemetry — this policy describes what the software
does with your data on your own machine.*

## What we collect

**Nothing.** DataCloak makes zero network calls except the ones your AI
provider was already going to make. There is no analytics, no crash
reporting, no update check, no account.

## Where your secrets live

- **Extension:** per-origin AES-GCM blobs in `chrome.storage.local`
  (10 origins × 200 entries, 7-day TTL, auto-pruned) plus the raw device
  key under `dc-dek` (obfuscation-grade: stops casual disk readers, not
  determined local attackers) and the site list in sync storage. The
  session vault remains a write-through cache.
- **Library / plugin:** the vault (synthetic ↔ original mappings) lives
  in process memory (or the browser's session storage, cleared when the
  tab closes). It is never written to disk, never synced, never transmitted.
- **CLI:** the file vault (`~/.config/datacloak/vault-*.json`, chmod 600)
  contains originals by design — it must, to restore across processes.
  Delete it when the session ends. `install.sh --uninstall` removes the
  packages but deliberately leaves vault files for you to purge.
- **Audit exports** (JSON/CSV from the extension popup) contain originals.
  They land wherever you save them, unencrypted. Treat them like secrets.

## What leaves your machine

Only what you (or your agent) send to your AI provider — which, thanks to
cloaking, contains synthetic substitutes instead of your real values.
Model responses may echo synthetics back; those are restored locally.

## What DataCloak cannot promise

- It cannot stop you explicitly sending a secret somewhere (`curl`,
  pasting into a non-covered field).
- It cannot protect data once it reaches your AI provider's servers —
  read their privacy policy for that half.
- Your agent's local session files still contain what you typed.

## Contact

Questions about this policy:
[open a GitHub issue](https://github.com/pratikwayal01/datacloak/issues).
