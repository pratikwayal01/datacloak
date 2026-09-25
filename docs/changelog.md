# Changelog

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
