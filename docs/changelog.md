# Changelog

## v0.3.0 (detect, extension)

**Typed custom entities (no regex).** Extension rows are now value + type
(Name, Employee ID, Email, Phone, Other) — each type ships a hardcoded
matcher and a same-length / same-case / same-format fake. `Ramesh` cloaks
every case variant; `EMP-001234` cloaks any `EMP-<digits>` ID. Legacy
literals migrate to Name rows; manual regex entries are dropped with a
console warning.

**Cloak profiles.** Named configs (Default seed + add/rename/delete with
guards) holding their own entity lists, detector flags, and UI prefs
(blur, review, badge…). Switching repaints rows, flags, and settings;
site grants stay global. Right-click any selection → Add to DataCloak
with kind auto-inferred.

**Review UX.** Optional Review-before-sending mode (Settings toggle):
centered overlay lists every detected value with per-row Keep/Reveal,
Send cloaked, one-click Send-original, scrim-click cancels. Same text
never asks twice; Keep on the last row auto-sends. Auto mode shows
`🔒 N cloaked ⚠️ M uncertain` badge counts (hideable).

**Diff view + full-page tab.** `Full page ↗` opens a dedicated shell
(sidebar, vault table, persisted panel/fold state) with a side-by-side
last-cloak diff and per-sub Add-to-entities. No shared stylesheet with
the 380px popup.

**Restore hardening.** Case-insensitive restore with verbatim originals
(LLMs recase fakes mid-reply); origin-scoped fallback for redirect tabs
without ever overwriting tab-authoritative mappings; copy matches display
via a synthetic→original clipboard cache.

**Vault + audit.** Clear is a confirmed global wipe (session, engines,
origin store, diffs) that stays wiped; Dev Tools Network log carries
per-site origin attribution; all-time cloaked counter survives Clear.
First-run tour overlay for new installs.

## v0.1.3 (cli, plugin, ner)

- First npm publish: `@pratikw/datacloak`, `@pratikw/opencode-plugin`,
  `@pratikw/detect-ner`
- NER slice: heuristic names/addresses/DOB, ONNX loader, engine integration
  (recall 26/26 + 10/10 negatives)
- Universal CLI + 10 harness adapters (Claude Code, Codex, Gemini, Qwen,
  Kilo, OpenClaw, Hermes, Pi, DeepSeek, Aider)
- OpenCode plugin: auto cloak/block/redact/restore, live-smoked on 1.18.32
- install.sh falls back to `~/.local` when the global prefix is unwritable

## Unreleased

- MkDocs site (this page) + GitHub Pages deploy
- Per-agent install matrix + `docs/harnesses.md`

## detect v0.1.2

- npm tarball ships README + LICENSE (absolute asset links)

## detect v0.1.1

- Rescoped `@datacloak/detect` → `@pratikw/detect`

## detect v0.1.0

- Engine MVP: patterns + entropy, Faker synthesis, vault, cloak/restore
- Corpus recall 39/39, 28 tests

## Milestones (shipped, unpublished)

- OpenCode plugin: auto cloak/block/redact/restore, live-smoked on 1.18.32
- Browser extension: 8 sites, per-tab vault, popup, bootstrap verified
- Universal CLI + 10 harness adapters (Claude Code, Codex, Gemini, Qwen,
  Kilo, OpenClaw, Hermes, Pi, DeepSeek, Aider)
- NER: heuristic names/addresses/DOB, ONNX loader, engine integration
