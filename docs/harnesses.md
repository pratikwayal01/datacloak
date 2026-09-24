# DataCloak × coding agents

One binary, every harness. Install `datacloak` once, then drop in the
adapter for your agent. All adapters share one vault file per session via
`DATACLOAK_VAULT` (export it once per shell session).

```bash
npm install -g @pratikw/datacloak   # after first publish; until then:
git clone https://github.com/pratikwayal01/datacloak.git && cd datacloak
npm install && npm run build --workspace packages/cli
export PATH="$PWD/packages/cli/dist:$PATH"   # dev shim until npm publish
```

> Adapters live in `packages/cli/adapters/<agent>/`. Each dir has a README
> with the exact copy destination. Hook scripts call `datacloak` from PATH —
> install the binary first.

## Claude Code

```bash
cp packages/cli/adapters/claude/* /your/project/.claude/
# trust .claude/guard.sh when prompted
export DATACLOAK_VAULT=~/.config/datacloak/vault-$(date +%s).json
```

Covers: prompt scan (deny on secrets), `PreToolUse` env-dump block +
write-restore, `PostToolUse` redact.

## OpenAI Codex CLI

```bash
cp packages/cli/adapters/codex/* /your/project/.codex/
# approve hooks via /hooks (trust-gated)
export DATACLOAK_VAULT=~/.config/datacloak/vault-$(date +%s).json
```

Covers: `UserPromptSubmit` gate, `PreToolUse` (Bash) deny/rewrite,
`PostToolUse` observe.

## Gemini CLI

```bash
cp packages/cli/adapters/gemini/* /your/project/.gemini/
export DATACLOAK_VAULT=~/.config/datacloak/vault-$(date +%s).json
```

Covers: `BeforeAgent`/`BeforeModel` prompt gate, `BeforeTool` block/rewrite,
`AfterTool` redact. Project `.gemini/settings.json` overrides user config.

## Qwen Code

```bash
cp packages/cli/adapters/qwen/* /your/project/.qwen/
export DATACLOAK_VAULT=~/.config/datacloak/vault-$(date +%s).json
```

Covers: `UserPromptSubmit`, `PreToolUse` deny/rewrite, `PostToolUse`.
`disableAllHooks:true` is the kill-switch.

## Kilo Code

```ts
// kilo config "plugin" entry — re-exports the OpenCode plugin (same hook shape)
"plugin": ["@pratikw/opencode-plugin"]
```

Or copy `packages/cli/adapters/kilo/plugin.ts` into your Kilo plugins dir.
Covers: `chat.message` transform, `tool.execute.before/after`.

## OpenClaw

Copy `packages/cli/adapters/openclaw/hooks.ts` into your OpenClaw plugin
entry (`api.on` wiring inside). Covers: `before_prompt_build` gate,
`before_tool_call` veto/rewrite, `after_tool_call` redact.

## Hermes Agent

```bash
cp packages/cli/adapters/hermes/plugin.py ~/.hermes/plugins/datacloak/
# enable in ~/.hermes/config.yaml plugins list
```

Covers: `pre_llm_call` note, `pre_tool_call` block/modify,
`transform_tool_result` redact. Fail-open throughout.

## Pi

```bash
cp packages/cli/adapters/pi/* /your/project/.pi/hook/
# trust via /hooks-trust (or PI_YAML_HOOKS_TRUST_PROJECT=1)
```

Covers: `user.prompt.submit` context note (cannot block — Pi limitation),
`tool.before.*` block/modify, `tool.after.*` observe.

## DeepSeek harness

Register `packages/cli/adapters/deepseek/cordis.ts` in `cordis.yml`, or
reuse the Claude/Codex `hooks.json` bridges (`dsh-hooks-claude-code`).
Covers: `agent/pre-step` gate, `tools/pre-execute` deny,
`tools/post-execute` transform.

## Aider (shell-only — no hook API)

```bash
cp packages/cli/adapters/aider/pre-commit .git/hooks/pre-commit
eval "$(datacloak install-shell --shell bash)"   # or zsh/fish
```

Command lines are scanned before execution; commits are scanned before
landing. Optional `.aider.conf.yml` loop: `test-cmd: pre-commit run`.

## OpenCode

Plugin built (`packages/opencode-plugin`), npm publish pending. Until then,
run from source — see `packages/opencode-plugin` README section in the main
README. Covers: prompt+system cloak, env-dump block, output redact,
write-path restore. Fully automatic, no commands.

## Any other terminal (backstop)

```bash
eval "$(datacloak install-shell --shell bash)"  # bash/zsh/fish supported
export DATACLOAK_OFF=1  # escape hatch when you need raw control
```

Every command line is scanned for secrets before it runs — covers any
harness, including ones with no hook API.
