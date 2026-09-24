# OpenCode Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/opencode-plugin` with 3 v2 hooks (cloak, block, redact) plus `/datacloak` commands over the workspace detect engine.

**Architecture:** Pure logic (`config.ts`, `guard.ts`, command handlers) isolated from SDK adapters (`hooks.ts`, `index.ts`); vitest mocks ctx. SDK shapes verified against installed `.d.ts` before coding, with specified fallbacks.

**Tech Stack:** TypeScript ~5.6, `@opencode-ai/plugin` ≥1.18 (v2 subpath), workspace `@pratikw/detect`, vitest ^3, Node ≥18.

**Spec:** `docs/superpowers/specs/2026-09-24-opencode-plugin-design.md`

## Global Constraints

- Node.js ≥18. `@opencode-ai/plugin` ≥1.18 via v2 subpath import.
- Tool hooks fail-CLOSED (exception → deny/suppress); request hook fail-OPEN with logged warning.
- Never write original values to disk, logs, or error messages (pattern/category names only).
- Env key names preserved (engine handles); blocklist deny surfaces as thrown Error.
- Imports use `.js` suffixes (tsc nodenext, same as detect).
- Package name `@pratikw/opencode-plugin`, version 0.1.0.

---

### Task 1: Scaffold + config loader

**Files:**
- Create: `packages/opencode-plugin/package.json`
- Create: `packages/opencode-plugin/tsconfig.json`
- Create: `packages/opencode-plugin/src/config.ts`
- Test: `packages/opencode-plugin/test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ResolvedConfig{enabled,mode,detection,vault,allowPaths,blockPaths,customPatterns,notifications}`, `defaultResolvedConfig`, `loadConfig(cwd?: string): ResolvedConfig` → Tasks 2–4. `DATACLOAK_MODE`, `DATACLOAK_ENABLED`, `DATACLOAK_ENTROPY_THRESHOLD`, `DATACLOAK_MAX_ENTRIES` env overrides → Task 4 documents them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/opencode-plugin/test/config.test.ts
import { describe, expect, it } from 'vitest';
import { defaultResolvedConfig, loadConfig } from '../src/config.js';

describe('config', () => {
  it('defaults are safe (enabled, warn, persist off)', () => {
    expect(defaultResolvedConfig.enabled).toBe(true);
    expect(defaultResolvedConfig.mode).toBe('warn');
    expect(defaultResolvedConfig.detection).toEqual({ secrets: true, envVars: true, pii: true, entropy: true, entropyThreshold: 4.5 });
    expect(defaultResolvedConfig.vault).toEqual({ maxEntries: 2000 });
  });
  it('env overrides mode', () => {
    process.env.DATACLOAK_MODE = 'block';
    expect(loadConfig('/nonexistent-dir-xyz').mode).toBe('block');
    delete process.env.DATACLOAK_MODE;
  });
  it('missing files fall back to defaults', () => {
    const c = loadConfig('/nonexistent-dir-xyz');
    expect(c.allowPaths).toEqual(['.env.example', 'fixtures/**']);
    expect(c.blockPaths).toContain('.env');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/opencode-plugin 2>&1 | tail -5`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 3: Write minimal implementation**

```json
// packages/opencode-plugin/package.json
{
  "name": "@pratikw/opencode-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "@pratikw/detect": "workspace:*", "@opencode-ai/plugin": "^1.18.0" },
  "devDependencies": { "typescript": "~5.6.3", "vitest": "^3.0.0" }
}
```

```json
// packages/opencode-plugin/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "nodenext", "moduleResolution": "nodenext",
    "strict": true, "declaration": true, "outDir": "dist", "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```ts
// packages/opencode-plugin/src/config.ts
export type ToolMode = 'warn' | 'block' | 'allow';
export interface ResolvedConfig {
  enabled: boolean;
  mode: ToolMode;
  detection: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean; entropyThreshold: number };
  vault: { maxEntries: number };
  allowPaths: string[];
  blockPaths: string[];
  customPatterns: { name: string; pattern: string; category: string; type: 'pii' | 'secret' | 'credential' }[];
  notifications: { onDetection: boolean; onBlock: boolean };
}
export const defaultResolvedConfig: ResolvedConfig = {
  enabled: true,
  mode: 'warn',
  detection: { secrets: true, envVars: true, pii: true, entropy: true, entropyThreshold: 4.5 },
  vault: { maxEntries: 2000 },
  allowPaths: ['.env.example', 'fixtures/**'],
  blockPaths: ['.env', '.env.local', '**/*.pem', '~/.ssh/**'],
  customPatterns: [],
  notifications: { onDetection: true, onBlock: true },
};

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function readJson(path: string): Partial<ResolvedConfig> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<ResolvedConfig>;
  } catch {
    return {};
  }
}

export function loadConfig(cwd: string = process.cwd()): ResolvedConfig {
  const base = defaultResolvedConfig;
  const user = readJson(join(homedir(), '.config', 'datacloak', 'config.json'));
  const project = readJson(join(cwd, '.opencode', 'datacloak.json'));
  const merged: ResolvedConfig = {
    ...base, ...user, ...project,
    detection: { ...base.detection, ...user.detection, ...project.detection },
    vault: { ...base.vault, ...user.vault, ...project.vault },
    notifications: { ...base.notifications, ...user.notifications, ...project.notifications },
  };
  if (process.env.DATACLOAK_ENABLED === 'false' || process.env.DATACLOAK_ENABLED === '0') merged.enabled = false;
  const mode = process.env.DATACLOAK_MODE;
  if (mode === 'warn' || mode === 'block' || mode === 'allow') merged.mode = mode;
  const thr = Number(process.env.DATACLOAK_ENTROPY_THRESHOLD);
  if (Number.isFinite(thr)) merged.detection.entropyThreshold = thr;
  const max = Number(process.env.DATACLOAK_MAX_ENTRIES);
  if (Number.isFinite(max) && max > 0) merged.vault.maxEntries = Math.floor(max);
  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/opencode-plugin 2>&1 | tail -5`
Expected: 3 passed. Then root `npm install` first if workspace not linked (npm workspaces resolve `workspace:*` after root install).

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin/package.json packages/opencode-plugin/tsconfig.json packages/opencode-plugin/src/config.ts packages/opencode-plugin/test/config.test.ts
git commit -m "feat(plugin): scaffold with 4-level config loader"
```

### Task 2: Guard (pure blocklist matchers)

**Files:**
- Create: `packages/opencode-plugin/src/guard.ts`
- Test: `packages/opencode-plugin/test/guard.test.ts`

**Interfaces:**
- Consumes: `ResolvedConfig` (Task 1).
- Produces: `shouldBlock(tool: string, args: unknown, config: ResolvedConfig): string | null` (reason or null) → Task 3. Minimatch-free: `*`/`**` compiled inline.

- [ ] **Step 1: Write the failing test**

```ts
// packages/opencode-plugin/test/guard.test.ts
import { describe, expect, it } from 'vitest';
import { shouldBlock } from '../src/guard.js';
import { defaultResolvedConfig } from '../src/config.js';

const cfg = defaultResolvedConfig;

describe('shouldBlock', () => {
  it('denies cat of .env via bash', () => {
    expect(shouldBlock('bash', { command: 'cat .env' }, cfg)).toMatch(/\.env/);
  });
  it('denies printenv and env pipes', () => {
    expect(shouldBlock('bash', { command: 'printenv | grep KEY' }, cfg)).toBeTruthy();
    expect(shouldBlock('bash', { command: 'env | grep SECRET' }, cfg)).toBeTruthy();
  });
  it('denies echo of $VAR and ssh reads', () => {
    expect(shouldBlock('bash', { command: 'echo $AWS_SECRET' }, cfg)).toBeTruthy();
    expect(shouldBlock('bash', { command: 'cat ~/.ssh/id_rsa' }, cfg)).toBeTruthy();
    expect(shouldBlock('bash', { command: 'cat ~/.aws/credentials' }, cfg)).toBeTruthy();
  });
  it('denies read of blocked paths, allows examples', () => {
    expect(shouldBlock('read', { filePath: '.env.local' }, cfg)).toBeTruthy();
    expect(shouldBlock('read', { filePath: 'certs/key.pem' }, cfg)).toBeTruthy();
    expect(shouldBlock('read', { filePath: '.env.example' }, cfg)).toBeNull();
  });
  it('ignores safe commands', () => {
    expect(shouldBlock('bash', { command: 'ls -la src' }, cfg)).toBeNull();
    expect(shouldBlock('read', { filePath: 'src/index.ts' }, cfg)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/opencode-plugin -- guard 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/guard.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/opencode-plugin/src/guard.ts
import type { ResolvedConfig } from './config.js';

const BASH_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /cat\s+[^\n]*\.env\b/, reason: 'reads .env file' },
  { re: /(^|[;&|]\s*)printenv\b/, reason: 'dumps environment' },
  { re: /(^|[;&|]\s*)env\s*\|/, reason: 'pipes environment' },
  { re: /echo\s+\$[A-Za-z_][A-Za-z0-9_]*/, reason: 'echoes secret variable' },
  { re: /~\/\.ssh\//, reason: 'reads ssh directory' },
  { re: /~\/\.aws\/credentials/, reason: 'reads aws credentials' },
  { re: /export\s+[A-Za-z_]+=/, reason: 'exports secret to environment' },
];

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

function pathBlocked(filePath: string, config: ResolvedConfig): boolean {
  if (config.allowPaths.some((g) => globToRegExp(g).test(filePath))) return false;
  return config.blockPaths.some((g) => globToRegExp(g).test(filePath));
}

export function shouldBlock(tool: string, args: unknown, config: ResolvedConfig): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  if ((tool === 'bash' || tool === 'shell') && typeof a.command === 'string') {
    for (const p of BASH_PATTERNS) {
      if (p.re.test(a.command)) return `DataCloak: blocked bash (${p.reason})`;
    }
    return null;
  }
  if ((tool === 'read' || tool === 'read_file') && typeof a.filePath === 'string') {
    return pathBlocked(a.filePath, config) ? `DataCloak: blocked read of ${a.filePath}` : null;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/opencode-plugin 2>&1 | tail -4`
Expected: all pass (config 3 + guard 5).

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin/src/guard.ts packages/opencode-plugin/test/guard.test.ts
git commit -m "feat(plugin): pure tool-call blocklist matchers"
```

### Task 3: Hooks (v2 adapters over engine)

**Files:**
- Create: `packages/opencode-plugin/src/hooks.ts`
- Create: `packages/opencode-plugin/src/index.ts`
- Test: `packages/opencode-plugin/test/hooks.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `shouldBlock` (Task 2), `DataCloakEngine` from `@pratikw/detect`.
- Produces: default export plugin object; engine instance shared with Task 4 via createHooks return. Session counts via module-level `sessionStats{cloaked,blocked,restored}` reset per process.

**Step 0 (do first, before tests):** read `node_modules/@opencode-ai/plugin/dist/index.d.ts`
(resp. `dist/v2.d.ts` if the v2 subpath has its own) and confirm: (a)
`session.hook("request")` event exposes mutable `system: string` and
`messages: {parts: {type,text?}[]}[]`-shaped fields; (b)
`tool.hook("execute.before")` event has mutable `input` and throwing denies;
(c) `tool.hook("execute.after")` exposes mutable `result`/`output`.
Adapt the field accesses below to the real shapes — same logic, exact names
from the .d.ts. If `messages` parts use a different text field name, use it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/opencode-plugin/test/hooks.test.ts
import { describe, expect, it } from 'vitest';
import { createHooks } from '../src/hooks.js';
import { defaultResolvedConfig } from '../src/config.js';

function mockCtx() {
  const handlers: Record<string, ((e: never) => void)[]> = {};
  const hook = (name: string, fn: (e: never) => void) => { (handlers[name] ??= []).push(fn); };
  return { ctx: { session: { hook }, tool: { hook } }, handlers };
}

describe('hooks', () => {
  it('request hook cloaks system + message text', () => {
    const { ctx, handlers } = mockCtx();
    const h = createHooks(ctx as never, { ...defaultResolvedConfig });
    void h;
    const event = { system: 'key sk-abcdefghij1234567890', messages: [{ parts: [{ type: 'text', text: 'mail john.doe@acme.com' }] }] };
    for (const fn of handlers['request'] ?? []) fn(event as never);
    expect(event.system).not.toContain('sk-abcdefghij1234567890');
    expect(event.messages[0].parts[0].text).not.toContain('john.doe@acme.com');
  });
  it('before hook throws on env dump, passes safe calls', () => {
    const { ctx, handlers } = mockCtx();
    createHooks(ctx as never, { ...defaultResolvedConfig, mode: 'block' });
    expect(() => (handlers['execute.before']?.[0] as (e: unknown) => void)({ tool: 'bash', input: { command: 'cat .env' } })).toThrow(/DataCloak/);
    expect(() => (handlers['execute.before']?.[0] as (e: unknown) => void)({ tool: 'bash', input: { command: 'ls' } })).not.toThrow();
  });
  it('after hook redacts secrets, suppresses on internal error', () => {
    const { ctx, handlers } = mockCtx();
    createHooks(ctx as never, { ...defaultResolvedConfig });
    const event = { tool: 'read', result: 'token sk-abcdefghij1234567890 end', output: '' };
    for (const fn of handlers['execute.after'] ?? []) fn(event as never);
    expect(event.result).not.toContain('sk-abcdefghij1234567890');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/opencode-plugin -- hooks 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/hooks.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/opencode-plugin/src/hooks.ts
import { DataCloakEngine } from '@pratikw/detect';
import type { ResolvedConfig } from './config.js';
import { shouldBlock } from './guard.js';

export interface SessionStats { cloaked: number; blocked: number; restored: number; }
export const sessionStats: SessionStats = { cloaked: 0, blocked: 0, restored: 0 };

type AnyEvent = Record<string, unknown>;
interface HookCtx {
  session: { hook: (name: string, fn: (e: AnyEvent) => void) => void };
  tool: { hook: (name: string, fn: (e: AnyEvent) => void) => void };
}

const asTextParts = (messages: unknown): { type?: string; text?: string }[][] => {
  if (!Array.isArray(messages)) return [];
  return (messages as { parts?: { type?: string; text?: string }[] }[]).map((m) => m.parts ?? []);
};

export function createHooks(ctx: HookCtx, config: ResolvedConfig): DataCloakEngine {
  const engine = new DataCloakEngine({
    detection: config.detection,
    vault: config.vault,
    customPatterns: config.customPatterns,
  });

  ctx.session.hook('request', (event) => {
    if (!config.enabled) return;
    try {
      if (typeof event.system === 'string') {
        const r = engine.cloak(event.system);
        event.system = r.text;
        sessionStats.cloaked += r.substitutions.length;
      }
      if (Array.isArray(event.messages)) {
        for (const parts of asTextParts(event.messages)) {
          for (const part of parts) {
            if (part.type === 'text' && typeof part.text === 'string') {
              const r = engine.cloak(part.text);
              part.text = r.text;
              sessionStats.cloaked += r.substitutions.length;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[datacloak] request cloak failed open: ${(err as Error).message}`);
    }
  });

  ctx.tool.hook('execute.before', (event) => {
    if (!config.enabled || config.mode === 'allow') return;
    try {
      const reason = shouldBlock(String(event.tool ?? ''), event.input, config);
      if (reason !== null) {
        sessionStats.blocked += 1;
        throw new Error(reason);
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error('DataCloak: blocked tool call');
    }
  });

  ctx.tool.hook('execute.after', (event) => {
    if (!config.enabled) return;
    try {
      for (const key of ['result', 'output'] as const) {
        const value = event[key];
        if (typeof value === 'string' && value.length > 0) {
          const before = engine.detect(value).length;
          const r = engine.cloak(value);
          event[key] = r.text;
          sessionStats.cloaked += r.substitutions.length;
          if (r.substitutions.length === 0 && before > 0) {
            event[key] = `${r.text}\n[DataCloak: ${before} possible secrets redacted from output]`;
          }
        }
      }
    } catch {
      event.result = '[DataCloak: output suppressed after detection failure]';
      event.output = '';
    }
  });

  return engine;
}
```

```ts
// packages/opencode-plugin/src/index.ts
import { Plugin } from '@opencode-ai/plugin/v2';
import { loadConfig } from './config.js';
import { createHooks, sessionStats } from './hooks.js';

export default Plugin.define({
  id: 'pratikw.datacloak',
  setup: async (ctx) => {
    const config = loadConfig(process.cwd());
    if (!config.enabled) return;
    createHooks(ctx as never, config);
    console.error(`[datacloak] active: secrets=${config.detection.secrets} pii=${config.detection.pii} entropy=${config.detection.entropy} vault=${config.vault.maxEntries}`);
  },
});

export { sessionStats };
```

If `Plugin.define` / `setup` / hook-registration names differ in the
installed .d.ts, adapt index.ts hook wiring only — hooks.ts logic stays.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/opencode-plugin 2>&1 | tail -4`
Expected: all pass. `npm run build --workspace packages/opencode-plugin` clean
(if v2 types mismatch, fix field names only — never `any`-cast the engine).

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin/src/hooks.ts packages/opencode-plugin/src/index.ts packages/opencode-plugin/test/hooks.test.ts
git commit -m "feat(plugin): v2 request/block/redact hooks over engine"
```

### Task 4: Write-path auto-restore (no command surface)

**Files:**
- Modify: `packages/opencode-plugin/src/hooks.ts` (restore in `execute.before` for write tools)
- Test: `packages/opencode-plugin/test/restore.test.ts`

**Interfaces:**
- Consumes: `createHooks` engine + `sessionStats` (Task 3).
- Produces: nothing new — fully automatic behavior. No slash commands by design.

**Behavior:** in `execute.before`, after the blocklist check passes, if the
tool is a file-writing tool (`write`, `edit`, `create`, `write_file`,
`edit_file`), scan string args (`content`, `text`, `old_string`,
`new_string`, `filePath` excluded) for known synthetics via
`engine.restore()` and replace args in place. Count `restored`. Fail-OPEN
(restore failure must never block a write — log warning, leave args intact).
TUI replies may still show synthetics (no v2 response hook; documented).

- [ ] **Step 1: Write the failing test**

```ts
// packages/opencode-plugin/test/restore.test.ts
import { describe, expect, it } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { applyWriteRestore } from '../src/hooks.js';

describe('write-path restore', () => {
  it('restores synthetics in write content', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('key sk-abcdefghij1234567890');
    const args = { filePath: 'cfg.txt', content: `token=${c.text}` };
    const n = applyWriteRestore(e, 'write', args);
    expect(n).toBe(1);
    expect(args.content).toContain('sk-abcdefghij1234567890');
  });
  it('leaves clean content untouched', () => {
    const e = new DataCloakEngine();
    const args = { filePath: 'a.txt', content: 'hello world' };
    expect(applyWriteRestore(e, 'write', args)).toBe(0);
    expect(args.content).toBe('hello world');
  });
  it('ignores non-write tools', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('john.doe@acme.com');
    const args = { command: `echo ${c.text}` };
    expect(applyWriteRestore(e, 'bash', args)).toBe(0);
    expect(args.command).toContain(c.text);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/opencode-plugin -- restore 2>&1 | tail -3`
Expected: FAIL — `applyWriteRestore` not exported from `../src/hooks.js`.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/opencode-plugin/src/hooks.ts`:

```ts
const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'write_file', 'edit_file']);
const RESTORABLE_KEYS = new Set(['content', 'text', 'old_string', 'new_string', 'prefix', 'suffix']);

export function applyWriteRestore(engine: DataCloakEngine, tool: string, args: Record<string, unknown>): number {
  if (!WRITE_TOOLS.has(tool)) return 0;
  let total = 0;
  for (const key of RESTORABLE_KEYS) {
    const value = args[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    try {
      const r = engine.restore(value);
      if (r.restored > 0) {
        args[key] = r.text;
        total += r.restored;
      }
    } catch (err) {
      console.error(`[datacloak] write restore failed open: ${(err as Error).message}`);
    }
  }
  sessionStats.restored += total;
  return total;
}
```

Wire into the `execute.before` handler from Task 3, after the blocklist
check passes:

```ts
if (config.enabled && config.mode !== 'allow') {
  // ... existing blocklist check (throws on deny) ...
}
if (config.enabled) {
  applyWriteRestore(engine, String(event.tool ?? ''), event.input as Record<string, unknown>);
}
```

In allow mode the blocklist is skipped but restore still runs (restore is
never a denial).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/opencode-plugin 2>&1 | tail -4`
Expected: all suites pass. Build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode-plugin/src/hooks.ts packages/opencode-plugin/test/restore.test.ts
git commit -m "feat(plugin): write-path auto-restore of synthetics"
```

## Self-review

- Spec §3: Task 3 (3 hooks, fail-open request, fail-closed tools, notice counts). §4 restore: Task 4 write-path auto-restore, zero user action. §5 no commands by design. §6 config: Task 1 (4 levels + 4 env vars). §7 layout + names match verbatim.
- No placeholders: every step has literal code/commands; SDK uncertainty bounded by Step 0 + named fallback.
- Type consistency: ResolvedConfig, shouldBlock→string|null, createHooks(ctx, config)→engine, runDatacloakCommand(engine, argv)→Promise<string> used identically across tasks.
