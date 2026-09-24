# OpenCode Plugin — Design

Date: 2026-09-24 | PRD: `.opencode/datacloak-prd.md` v0.2 §5 | Approach: v2 API, 3 hooks

## 1. Goal

`packages/opencode-plugin`: cloak prompts pre-dispatch, block secret-exfiltrating
tool calls, redact tool output. Depends on workspace `@pratikw/detect`.
Published as `@pratikw/opencode-plugin` (v1.0.0).

## 2. API target (verified 2026-09-24)

`@opencode-ai/plugin` ≥1.18, v2 subpath: `import { Plugin } from "@opencode-ai/plugin/v2"`,
`Plugin.define({ id: "pratikw.datacloak", setup })`. PRD's v1 `chat.message`
is read-only and `experimental.chat.*.transform` unverified — not used.

## 3. Hooks

```
ctx.session.hook("request")       # mutate event.system + event.messages (cloak)
ctx.tool.hook("execute.before")   # mutate/deny event.input (block env dumps)
ctx.tool.hook("execute.after")    # mutate event.result/output (redact)
```

- **request**: run engine.cloak over system string + each message text part.
  Count substitutions; stash notice in vault session log (TUI toast only if
  SDK exposes it — silent otherwise). Fail-OPEN with logged warning
  (must never break dispatch).
- **before**: deny bash matching `cat .*\.env|printenv|env\s*\||echo\s+\$[A-Z_]+|~/.ssh|~/.aws/credentials`
  and reads of blockPaths (`.env`, `.env.local`, `**/*.pem`, `~/.ssh/**`),
  minus allowPaths. Modes: warn (default; throw to deny — surfaces as
  confirmation-safe denial), block (deny), allow (pass). Fail-CLOSED.
- **after**: recursively cloak strings in result/output (objects, arrays).
  Medium-confidence hits append `[DataCloak: N possible secrets redacted]`.
  Fail-CLOSED: on exception replace output with safe error message.

## 4. Response restore (automatic, write-path)

No slash commands, no manual step: everything auto-invokes. Cloaking fires
on the first entry point (session.request) with zero user action.
Restore fires on the last exit point: `execute.before` on file-writing tools
(`write`, `edit`, `create`) replaces known synthetics with originals in file
content args, so files on disk always carry real values while the model only
ever saw fakes. TUI display of model replies may still show synthetic values
(no response-mutation hook exists in v2) — documented limitation, data-safe
by default.

## 5. No command surface

Deliberately no `/datacloak` command: the plugin is invisible when nothing
sensitive is present. Only signals: startup log line (active rules, vault
capacity) and a session summary in the returned message metadata where the
SDK allows. Vault inspection happens via unit-testable pure functions, not UI.

## 6. Config (priority order)

1. `DATACLOAK_*` env, 2. `<project>/.opencode/datacloak.json`,
3. `~/.config/datacloak/config.json`, 4. built-in defaults (PRD §5.3 shape:
enabled, mode, detection flags, allowPaths, blockPaths, customPatterns,
vault.maxEntries, notifications).

## 7. Layout

```
packages/opencode-plugin/
  package.json   # @pratikw/opencode-plugin, workspace dep @pratikw/detect + @opencode-ai/plugin
  tsconfig.json
  src/{index.ts,hooks.ts,guard.ts,config.ts}
  test/{hooks.test.ts,guard.test.ts,config.test.ts}
```

`guard.ts`: pure blocklist matchers (testable without SDK). `hooks.ts`:
thin ctx adapters (cloak on request, block + write-path restore on before,
redact on after). No commands module.

## 8. Testing

Vitest with hand-mocked ctx (`{ session: { hook }, tool: { hook } }`
recording callbacks; invoke callbacks with fake events). No live OpenCode.
Cases: cloak rewrites system+messages; originals re-cloaked in history;
bash `cat ~/.env` denied in block mode, passed in allow; `.env.example`
allowed via allowPaths; tool output secrets redacted; exception in after →
suppressed output; invalid custom regex throws at load; write-tool content
with synthetics restored to originals before dispatch.

## Self-review

- No TBDs except commands-API signature — explicitly delegated to
  implementer with fallback, bounded and testable.
- Deviations from PRD recorded with cause: 5 v1 hooks → 3 v2 hooks
  (v1 chat.message read-only); auto-restore → command restore
  (no response hook); scope @datacloak → @pratikw (org reality).
- Scope single-package, no overlap with detect. NFRs preserved:
  fail-closed tool hooks, fail-open request, no originals on disk.
