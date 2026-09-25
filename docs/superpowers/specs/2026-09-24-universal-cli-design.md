# Universal CLI + Adapters — Design

Date: 2026-09-24 | Survey: `.superpowers/sdd/harness-hooks-survey.md`

## 1. Goal

One `datacloak` binary (`@pratikw/datacloak`) + thin per-harness adapters
covering 11 CLIs: Claude Code, Codex CLI, Gemini CLI, Aider, Kilo Code,
Qwen Code, OpenCode, Hermes, OpenClaw, Pi, DeepSeek harness. Same job
everywhere: cloak entry, block exfiltration, redact/restore exits.

## 2. Architecture

```
packages/cli/            # @pratikw/datacloak, bin: datacloak
  cloak                  # stdin→stdout synthetics; updates --vault file
  restore                # stdin→stdout originals; reads --vault file
  scan                   # exit 2 + categories on detection (hooks/preexec/git)
  guard                  # universal hook protocol: JSON stdin → decision JSON
  install-shell          # prints preexec snippet (bash/zsh/fish)
adapters/
  claude/   (.claude/hooks/*.sh + settings.json)
  codex/    (.codex/hooks.json + hook scripts)
  gemini/   (.gemini/settings.json + hook scripts)
  qwen/     (.qwen/settings.json + hook scripts)
  kilo/     (plugin.ts re-exporting opencode-plugin hooks — same shape)
  openclaw/ (plugin entry: before_prompt_build/before_tool_call)
  hermes/   (plugin.py: pre_llm_call/pre_tool_call)
  pi/       (hooks.yaml: user.prompt.submit + tool.before.*)
  deepseek/ (cordis plugin: tools/pre-execute + agent/pre-step)
  aider/    (shell wrapper + pre-commit docs — no in-harness API)
  opencode/ (already shipped as @pratikw/opencode-plugin — referenced only)
shell/
  preexec.sh (bash), preexec.zsh, preexec.fish, pre-commit-hook
```

- **Vault file** (`--vault PATH`, default `$DATACLOAK_VAULT` or
  `~/.config/datacloak/vault-<DATACLOAK_SESSION|default>.json`):
  `{version:1, entries:[{original,synthetic,category,type}]}`.
  chmod 600 on write. Session-scoped; documented retention warning.
- **guard protocol** (adapter-normalized): stdin
  `{event:"prompt"|"tool", text?, tool?, args?}` → stdout
  `{decision:"allow"|"deny"|"rewrite", text?, args?, reason?}`; exit 0
  allow/rewrite, exit 2 deny. Every adapter translates its harness codec
  to/from this — one tested core, eleven thin shims.
- **Shell preexec**: before each interactive command, `datacloak scan`
  the command line; on hit, print categories and return 1 (block).
  Installed by eval'ing `datacloak install-shell --shell fish|bash|zsh`.
  Covers Aider fully, everything else as backstop.
- **Kilo**: hook shape identical to OpenCode — adapter is a 10-line
  re-export of `@pratikw/opencode-plugin` hooks, not a rewrite.

## 3. Per-harness mapping (from survey)

| Harness | Entry | Tool block/rewrite | Exit redact |
|---|---|---|---|
| claude | UserPromptSubmit → scan (block/warn) | PreToolUse → guard deny + write-restore | PostToolUse → redact |
| codex | UserPromptSubmit → scan | PreToolUse → guard | PostToolUse → redact |
| gemini | BeforeAgent/BeforeModel → scan | BeforeTool → guard | AfterTool → redact |
| qwen | UserPromptSubmit → scan | PreToolUse → guard | PostToolUse → redact |
| kilo | chat.message transform | tool.execute.before | tool.execute.after |
| openclaw | before_prompt_build gate | before_tool_call veto | after_tool_call observe |
| hermes | pre_llm_call inject | pre_tool_call block/modify | transform_tool_result |
| pi | user.prompt.submit (context-only) | tool.before.* block/modify | tool.after.* observe |
| deepseek | agent/pre-step gate | tools/pre-execute deny | tools/post-execute transform |
| aider | shell preexec only | shell preexec only | — (documented) |
| opencode | shipped plugin | shipped plugin | shipped plugin |

## 4. Testing

- CLI: child-process tests (execFile node dist/cli.js) — cloak/restore
  round-trip via temp vault file; scan exit codes 0/2; guard JSON vectors.
- Adapters: config-shape tests (JSON/YAML parses, hook commands reference
  `datacloak`, required events present per mapping table).
- Shell: `bash -n` + `fish -n` syntax checks on snippets; preexec logic
  unit-tested via extracted pure function (no live shell).
- Live smoke (installed here): claude, gemini, hermes adapters end-to-end;
  others shape-verified.

## Self-review

- Vault-on-disk is a deliberate, documented tradeoff (pipes need shared
  state); 600 perms + session scope + retention warning.
- No prompt-rewrite claims where harnesses forbid it (Pi context-only,
  Aider none) — mapping table is honest per survey.
- Kilo re-export avoids a second implementation to drift.
