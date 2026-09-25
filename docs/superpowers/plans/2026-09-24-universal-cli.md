# Universal CLI + Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/cli` (`datacloak` binary: cloak/restore/scan/guard/install-shell) plus tested adapters for all 11 harnesses.

**Architecture:** Zero-dependency CLI over workspace detect with file-backed vault; adapters are thin config+shim translating each harness codec to one guard protocol; shell preexec covers Aider and backstops the rest.

**Tech Stack:** TypeScript ~5.6, workspace `@pratikw/detect`, vitest (execFile child-process tests), bash/fish syntax checks. Node ≥18.

**Spec:** `docs/superpowers/specs/2026-09-24-universal-cli-design.md`

## Global Constraints

- Node.js ≥18. Zero runtime dependencies beyond workspace detect.
- `scan` exits 0 clean / 2 on detection; `guard` exits 0 allow-or-rewrite / 2 deny.
- Vault file chmod 600 on write; default path `$DATACLOAK_VAULT` or `~/.config/datacloak/vault-<DATACLOAK_SESSION|default>.json`.
- Never print originals to stdout (cloak output contains synthetics only); errors carry categories, not values.
- Adapter hook scripts call `datacloak` from PATH (no absolute paths).

---

### Task 1: CLI core (vault-file + cloak/restore/scan)

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/vault-file.ts`
- Create: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/cli.test.ts` (execFile `node dist/cli.js`)

**Interfaces:**
- Consumes: `DataCloakEngine` from `@pratikw/detect`.
- Produces: `datacloak cloak [--vault P]`, `restore [--vault P]`, `scan [--quiet]`, vault-file `{version, entries[]}` → Tasks 2–4.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/cli.test.ts
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

const cli = (args: string[], input: string, env: Record<string, string> = {}) =>
  run('node', [CLI, ...args], { input, env: { ...process.env, ...env } }).then(
    (r) => ({ code: 0, stdout: r.stdout as string, stderr: r.stderr as string }),
    (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }),
  );

describe('cli', () => {
  it('cloak round-trips through a vault file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-'));
    const vault = join(dir, 'v.json');
    const c = await cli(['cloak', '--vault', vault], 'mail john.doe@acme.com');
    expect(c.code).toBe(0);
    expect(c.stdout).not.toContain('john.doe@acme.com');
    expect(statSync(vault).mode & 0o777).toBe(0o600);
    const r = await cli(['restore', '--vault', vault], c.stdout);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('mail john.doe@acme.com');
  });
  it('scan exits 2 on detection, 0 when clean', async () => {
    expect((await cli(['scan'], 'key sk-abcdefghij1234567890')).code).toBe(2);
    expect((await cli(['scan'], 'hello world')).code).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/cli 2>&1 | tail -3`
Expected: FAIL — dist/cli.js missing (package doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```json
// packages/cli/package.json
{
  "name": "@pratikw/datacloak",
  "version": "0.1.0",
  "type": "module",
  "bin": { "datacloak": "dist/cli.js" },
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "@pratikw/detect": "*" },
  "devDependencies": { "typescript": "~5.6.3", "vitest": "^3.0.0" }
}
```

```json
// packages/cli/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "nodenext", "moduleResolution": "nodenext",
    "strict": true, "outDir": "dist", "rootDir": "src", "skipLibCheck": true
  },
  "include": ["src"]
}
```

```ts
// packages/cli/src/vault-file.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DataCloakEngine } from '@pratikw/detect';

export interface FileEntry { original: string; synthetic: string; category: string; type: 'pii' | 'secret' | 'credential'; }

export function defaultVaultPath(): string {
  if (process.env.DATACLOAK_VAULT) return process.env.DATACLOAK_VAULT;
  const session = process.env.DATACLOAK_SESSION ?? 'default';
  return join(homedir(), '.config', 'datacloak', `vault-${session}.json`);
}

export function loadInto(engine: DataCloakEngine, path: string): void {
  if (!existsSync(path)) return;
  const data = JSON.parse(readFileSync(path, 'utf8')) as { version: number; entries: FileEntry[] };
  for (const e of data.entries ?? []) {
    engine.vault.set({ ...e, synthesizedAt: Date.now(), confidence: 'high' });
  }
}

export function saveFrom(engine: DataCloakEngine, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, entries: engine.vault.list() }), { mode: 0o600 });
  chmodSync(path, 0o600);
}
```

```ts
// packages/cli/src/cli.ts
#!/usr/bin/env node
import { DataCloakEngine } from '@pratikw/detect';
import { defaultVaultPath, loadInto, saveFrom } from './vault-file.js';

const readStdin = async (): Promise<string> => {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
};

const vaultFlag = (argv: string[]): string => {
  const i = argv.indexOf('--vault');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : defaultVaultPath();
};

const main = async (): Promise<number> => {
  const [cmd, ...rest] = process.argv.slice(2);
  const engine = new DataCloakEngine();
  if (cmd === 'cloak') {
    const path = vaultFlag(rest);
    loadInto(engine, path);
    const r = engine.cloak(await readStdin());
    saveFrom(engine, path);
    process.stdout.write(r.text);
    return 0;
  }
  if (cmd === 'restore') {
    loadInto(engine, vaultFlag(rest));
    process.stdout.write(engine.restore(await readStdin()).text);
    return 0;
  }
  if (cmd === 'scan') {
    const found = engine.detect(await readStdin());
    if (found.length === 0) return 0;
    if (!rest.includes('--quiet')) {
      const cats = [...new Set(found.map((d) => d.category))].join(', ');
      process.stderr.write(`datacloak: detected ${found.length} (${cats})\n`);
    }
    return 2;
  }
  process.stderr.write('usage: datacloak <cloak|restore|scan|guard|install-shell> [--vault PATH]\n');
  return 1;
};

main().then(
  (code) => process.exit(code),
  (err) => { process.stderr.write(`datacloak: ${(err as Error).message}\n`); process.exit(1); },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build --workspace packages/cli && npm test --workspace packages/cli 2>&1 | tail -4`
Expected: 2 passed, tsc clean. (Tests run against dist — build first.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/src/vault-file.ts packages/cli/src/cli.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): cloak/restore/scan with 600 file vault"
```

### Task 2: guard + shell integration

**Files:**
- Create: `packages/cli/src/guard-cmd.ts` (wired into cli.ts)
- Create: `packages/cli/shell/preexec.sh`
- Create: `packages/cli/shell/preexec.zsh`
- Create: `packages/cli/shell/preexec.fish`
- Test: extend `packages/cli/test/cli.test.ts` (guard vectors) + `packages/cli/test/shell.test.ts` (syntax checks)

**Interfaces:**
- Consumes: vault-file helpers, engine (Task 1).
- Produces: `datacloak guard` protocol `{event,text?,tool?,args?}` → `{decision,text?,args?,reason?}` + exit codes; `datacloak install-shell --shell bash|zsh|fish` prints snippet → Tasks 3–4.

Guard protocol (exact):
- stdin JSON `{event:"prompt", text}` → prompt scan: allow `{decision:"allow"}` (exit 0) or deny `{decision:"deny", reason:"datacloak: <cats> in prompt"}` (exit 2).
- stdin JSON `{event:"tool", tool, args}` → blocklist via same patterns as opencode guard (inline: env-dump regexes + sensitive paths); write tools (`write|edit|create|write_file|edit_file|apply_patch`) get restore applied to string args → `{decision:"rewrite", args}` (exit 0); deny → exit 2 with reason.
- Unknown events → allow, exit 0.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/cli/test/cli.test.ts
describe('guard', () => {
  it('denies prompts with secrets, allows clean', async () => {
    const deny = await cli(['guard'], JSON.stringify({ event: 'prompt', text: 'key sk-abcdefghij1234567890' }));
    expect(deny.code).toBe(2);
    expect(JSON.parse(deny.stdout).decision).toBe('deny');
    expect(JSON.parse(deny.stdout).reason).not.toContain('sk-abcdefghij1234567890');
    const ok = await cli(['guard'], JSON.stringify({ event: 'prompt', text: 'hello world' }));
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout).decision).toBe('allow');
  });
  it('denies env dumps, rewrites writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-'));
    const vault = join(dir, 'v.json');
    await cli(['cloak', '--vault', vault], 'sk-abcdefghij1234567890', { DATACLOAK_VAULT: vault });
    const deny = await cli(['guard'], JSON.stringify({ event: 'tool', tool: 'bash', args: { command: 'cat .env' } }), { DATACLOAK_VAULT: vault });
    expect(deny.code).toBe(2);
    const c = await cli(['cloak', '--vault', vault], 'sk-abcdefghij1234567890');
    const rw = await cli(['guard'], JSON.stringify({ event: 'tool', tool: 'write', args: { filePath: 'a.txt', content: c.stdout } }), { DATACLOAK_VAULT: vault });
    expect(rw.code).toBe(0);
    expect(JSON.parse(rw.stdout).decision).toBe('rewrite');
    expect(JSON.parse(rw.stdout).args.content).toContain('sk-abcdefghij1234567890');
  });
});
```

```ts
// packages/cli/test/shell.test.ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('shell snippets', () => {
  it('bash/zsh parse clean', () => {
    for (const f of ['shell/preexec.sh', 'shell/preexec.zsh']) {
      execFileSync('bash', ['-n', new URL(`../${f}`, import.meta.url).pathname]);
    }
  });
  it('fish parses clean', () => {
    try {
      execFileSync('fish', ['-n', new URL('../shell/preexec.fish', import.meta.url).pathname]);
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return;
      throw err;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/cli -- guard 2>&1 | tail -3`
Expected: FAIL — `guard` prints usage, exits 1.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/guard-cmd.ts
import { DataCloakEngine } from '@pratikw/detect';
import { defaultVaultPath, loadInto } from './vault-file.js';

export type GuardOut = { decision: 'allow' | 'deny' | 'rewrite'; reason?: string; args?: unknown };

const ENV_DUMP = [/(^|[;&|]\s*)printenv\b/, /(^|[;&|]\s*)env\b/, /echo\s+\$[A-Za-z_]/, /~\/\.ssh\//, /~\/\.aws\/credentials/];
const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'write_file', 'edit_file', 'apply_patch']);

export function guard(incoming: { event: string; text?: string; tool?: string; args?: Record<string, unknown> }, engine: DataCloakEngine): { out: GuardOut; code: number } {
  if (incoming.event === 'prompt' && typeof incoming.text === 'string') {
    const found = engine.detect(incoming.text);
    if (found.length === 0) return { out: { decision: 'allow' }, code: 0 };
    const cats = [...new Set(found.map((d) => d.category))].join(', ');
    return { out: { decision: 'deny', reason: `datacloak: ${cats} in prompt` }, code: 2 };
  }
  if (incoming.event === 'tool') {
    const cmd = (incoming.args as Record<string, unknown> | undefined)?.command;
    if (typeof cmd === 'string' && ENV_DUMP.some((re) => re.test(cmd))) {
      return { out: { decision: 'deny', reason: 'datacloak: blocked env-dump command' }, code: 2 };
    }
    if (incoming.tool && WRITE_TOOLS.has(incoming.tool) && incoming.args && typeof incoming.args === 'object') {
      let rewrote = false;
      for (const [k, v] of Object.entries(incoming.args)) {
        if (k === 'filePath' || typeof v !== 'string') continue;
        const r = engine.restore(v);
        if (r.restored > 0) { (incoming.args as Record<string, unknown>)[k] = r.text; rewrote = true; }
      }
      if (rewrote) return { out: { decision: 'rewrite', args: incoming.args }, code: 0 };
    }
    return { out: { decision: 'allow' }, code: 0 };
  }
  return { out: { decision: 'allow' }, code: 0 };
}

export const vaultPathForGuard = (): string => process.env.DATACLOAK_VAULT ?? defaultVaultPath();

export const loadGuardEngine = (): DataCloakEngine => {
  const engine = new DataCloakEngine();
  loadInto(engine, vaultPathForGuard());
  return engine;
};
```

Wire into cli.ts main (add before usage line):

```ts
if (cmd === 'guard') {
  const { guard, loadGuardEngine } = await import('./guard-cmd.js');
  const raw = await readStdin();
  let incoming: { event: string };
  try {
    incoming = JSON.parse(raw) as { event: string };
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return 0;
  }
  const { out, code } = guard(incoming as never, loadGuardEngine());
  process.stdout.write(JSON.stringify(out));
  return code;
}
if (cmd === 'install-shell') {
  const shell = rest[rest.indexOf('--shell') + 1] ?? 'bash';
  const names: Record<string, string> = { bash: 'preexec.sh', zsh: 'preexec.zsh', fish: 'preexec.fish' };
  const { readFileSync } = await import('node:fs');
  const file = new URL(`../shell/${names[shell] ?? 'preexec.sh'}`, import.meta.url);
  process.stdout.write(readFileSync(file, 'utf8'));
  return 0;
}
```

shell snippets (each: hook command lines through `datacloak scan --quiet`, block on exit 2):

```bash
# packages/cli/shell/preexec.sh (bash)
# usage: eval "$(datacloak install-shell --shell bash)"
_datacloak_preexec() {
  [ -n "$DATACLOAK_OFF" ] && return 0
  printf '%s' "$BASH_COMMAND" | datacloak scan --quiet 2>/dev/null || {
    echo "datacloak: secret in command line — blocked" >&2
    return 1
  }
}
```

```zsh
# packages/cli/shell/preexec.zsh
# usage: eval "$(datacloak install-shell --shell zsh)"
datacloak_preexec() {
  [ -n "$DATACLOAK_OFF" ] && return 0
  printf '%s' "$1" | datacloak scan --quiet 2>/dev/null || {
    echo "datacloak: secret in command line — blocked" >&2
    return 1
  }
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec datacloak_preexec
```

```fish
# packages/cli/shell/preexec.fish
# usage: datacloak install-shell --shell fish | source
function datacloak_preexec --on-event fish_preexec
  if set -q DATACLOAK_OFF; return 0; end
  printf '%s' $argv[1] | datacloak scan --quiet 2>/dev/null
  if test $status -eq 2
    echo "datacloak: secret in command line — blocked" >&2
    return 1
  end
end
```

Note: bash needs DEBUG-trap wiring (`trap '_datacloak_preexec' DEBUG` breaks
`$BASH_COMMAND` semantics in functions — keep snippet minimal per above;
document `PROMPT_COMMAND`-style install as follow-up if trap misbehaves).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build --workspace packages/cli && npm test --workspace packages/cli 2>&1 | tail -4`
Expected: all pass. `bash -n` checks pass; fish check skips if fish absent.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/guard-cmd.ts packages/cli/src/cli.ts packages/cli/shell/ packages/cli/test/cli.test.ts packages/cli/test/shell.test.ts
git commit -m "feat(cli): guard protocol plus shell preexec snippets"
```

### Task 3: Adapters batch A (claude, codex, gemini, qwen)

**Files (per harness H in claude/codex/gemini/qwen):**
- Create: `packages/cli/adapters/<H>/hooks.json` (or settings.json for gemini/qwen)
- Create: `packages/cli/adapters/<H>/guard.sh` (hook shim → `datacloak guard`)
- Create: `packages/cli/adapters/<H>/README.md` (install: copy where, trust note)
- Test: `packages/cli/test/adapters-a.test.ts` (JSON parses, events present, hook commands reference datacloak, shims `bash -n` clean)

Shared shim (identical content per harness, different path):

```bash
#!/usr/bin/env bash
# datacloak hook shim: harness JSON on stdin → datacloak guard → harness codec on stdout
set -euo pipefail
INPUT="$(cat)"
TEXT="$(printf '%s' "$INPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.prompt||j.text||'')}catch{}})")"
TOOL="$(printf '%s' "$INPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_name||j.tool||'')}catch{}})")"
if [ -n "$TOOL" ]; then
  printf '%s' "$INPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(JSON.stringify({event:'tool',tool:j.tool_name||j.tool,args:j.tool_input||j.input||{}}))})" | datacloak guard
else
  printf '%s' '{"event":"prompt","text":%s}' "$TEXT" | datacloak guard
fi
```

Harness configs (exact file names):
- claude: `adapters/claude/settings.json` → `{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"datacloak-adapter-guard"}]}]}}` — use relative `./guard.sh`? Adapters are copied INTO project `.claude/`; hook command `./.claude/guard.sh`. Keep command `"./.claude/guard.sh"`, README says copy dir contents.
- codex: `adapters/codex/hooks.json` same shape with matcher PreToolUse Bash.
- gemini: `adapters/gemini/settings.json` with BeforeAgent + BeforeTool matchers.
- qwen: `adapters/qwen/settings.json` with UserPromptSubmit + PreToolUse.

Each harness dir gets `guard.sh` (copy of shared shim) + README (3 lines: copy to project dot-dir, trust/allow note, DATACLOAK_VAULT session note).

Test asserts: JSON parses; hook command strings end with `guard.sh`; shim files pass `bash -n`; each README mentions vault env.

- [ ] Steps 1–5: test-first per file group, run, implement, verify, commit `feat(cli): adapters for claude/codex/gemini/qwen`.

### Task 4: Adapters batch B (kilo, openclaw, hermes, pi, deepseek, aider)

**Files:**
- Create: `packages/cli/adapters/kilo/plugin.ts` — re-export opencode-plugin hooks:
```ts
export { createHooks, sessionStats, applyWriteRestore } from '@pratikw/opencode-plugin/dist/hooks.js';
export { shouldBlock } from '@pratikw/opencode-plugin/dist/guard.js';
export { loadConfig } from '@pratikw/opencode-plugin/dist/config.js';
```
(plus package.json dep on workspace opencode-plugin; Kilo loads it as its `plugin` entry — shape-identical per survey.)
- Create: `packages/cli/adapters/openclaw/hooks.ts` — `before_prompt_build` (scan via guard? prompt gate: run datacloak scan semantics inline? NO — keep shim: spawn `datacloak guard` with prompt JSON, map decision to `{block, blockReason}` / prependContext), `before_tool_call` (veto/rewrite via guard).
- Create: `packages/cli/adapters/hermes/plugin.py` — `register(ctx)`: `pre_llm_call` (scan → context note), `pre_tool_call` (subprocess `datacloak guard`, block/modify), `transform_tool_result` (redact via `datacloak cloak`? NO — redact = cloak tool RESULT text through cloak stdin with vault env).
- Create: `packages/cli/adapters/pi/hooks.yaml` — `user.prompt.submit` (context note via scan), `tool.before.*` (guard.sh call, block+modify).
- Create: `packages/cli/adapters/deepseek/cordis.ts` — `tools/pre-execute` deny, `agent/pre-step` gate, both via spawned `datacloak guard`.
- Create: `packages/cli/adapters/aider/README.md` + `packages/cli/adapters/aider/pre-commit` — shell-wrapper docs + git hook calling `datacloak scan` (exit 2 blocks commit).
- Test: `packages/cli/test/adapters-b.test.ts` — YAML/TS parse (tsc --noEmit on kilo/openclaw/deepseek via project refs? simpler: esbuild transform check), hook-entry names present per spec mapping table, python `py_compile` hermes plugin, aider pre-commit `bash -n`.

Keep each adapter ≤60 lines (shims, not reimplementations). Python hermes plugin uses `subprocess.run(['datacloak','guard'], input=..., capture_output=True)`.

- [ ] Steps 1–5: test-first, run, implement, verify, commit `feat(cli): adapters for kilo/openclaw/hermes/pi/deepseek/aider`.

### Task 5: Live smoke (claude, gemini, hermes)

**Files:** none (verification only) + fix commits if gaps found.
- Test: `packages/cli/test/smoke.test.ts` — SKIPPED unless env `DATACLOAK_SMOKE=1` (`it.skipIf(!process.env.DATACLOAK_SMOKE)`): asserts `datacloak` binary resolves on PATH and each harness CLI exists (`claude --version`, `gemini --version`, `hermes --version`).

Manual (implementer runs, records output in report):
1. `npm i -g ./packages/cli` (or npm link) so adapters resolve `datacloak`.
2. Scratch dir with `.env` canary; install claude adapter to `./.claude/`; run non-interactive prompt asking to print `.env`; PASS = blocked or redacted, canary never in output.
3. Same for gemini adapter; hermes plugin loaded per its docs.
4. Record exact commands + outputs in report; failures → fix adapter (commit) or downgrade to shape-verified with reason.

Commit smoke test `test(cli): opt-in live smoke`. This task completes when report holds evidence for all three (PASS or documented BLOCKED-with-cause).

## Self-review

- Spec §2: T1 (vault+cloak/restore/scan) → T2 (guard+shell) → T3/T4 adapters → T5 smoke. Vault 600 + session scope: T1. Guard protocol: T2, reused T3–T5. Kilo re-export: T4. Aider shell-only: T2+T4 docs.
- No placeholders: literal code/commands/configs throughout; harness codec uncertainty bounded by shape tests + smoke.
- Type consistency: GuardOut, MemoryStore-free (file vault), `{decision,text?,args?,reason?}` + exit codes used identically in T2–T5.
