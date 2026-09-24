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

## 4. Response restore (known limitation)

v2 exposes no response-mutation hook, so TUI auto-restore is impossible.
Restore path: `/datacloak restore <text>` command + `vault` / `reveal`
viewers. Mitigation: request hook re-cloaks any originals that leak into
later-turn history, so the model never sees them twice.

## 5. Commands (`/datacloak <sub>`)

status (rules, vault size, session counts), vault (synthetics + blurred
originals + categories), reveal <synthetic> (confirm-gated), restore <text>,
clear, test <text> (dry-run), config (resolved config). Via v2 command API —
implementer verifies exact registration signature against installed .d.ts
before coding; if commands API differs, fall back to a single `datacloak`
tool with subcommand arg.

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
  src/{index.ts,hooks.ts,guard.ts,config.ts,commands.ts}
  test/{hooks.test.ts,guard.test.ts,config.test.ts,commands.test.ts}
```

`guard.ts`: pure blocklist matchers (testable without SDK). `hooks.ts`:
thin ctx adapters. `commands.ts`: subcommand implementations over engine.

## 8. Testing

Vitest with hand-mocked ctx (`{ session: { hook }, tool: { hook } }`
recording callbacks; invoke callbacks with fake events). No live OpenCode.
Cases: cloak rewrites system+messages; originals re-cloaked in history;
bash `cat ~/.env` denied in block mode, passed in allow; `.env.example`
allowed via allowPaths; tool output secrets redacted; exception in after →
suppressed output; invalid custom regex throws at load.

## Self-review

- No TBDs except commands-API signature — explicitly delegated to
  implementer with fallback, bounded and testable.
- Deviations from PRD recorded with cause: 5 v1 hooks → 3 v2 hooks
  (v1 chat.message read-only); auto-restore → command restore
  (no response hook); scope @datacloak → @pratikw (org reality).
- Scope single-package, no overlap with detect. NFRs preserved:
  fail-closed tool hooks, fail-open request, no originals on disk.
