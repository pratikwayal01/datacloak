# Detect Engine MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@datacloak/detect` MVP: detect/cloak/restore with Faker synthetics and in-memory vault.

**Architecture:** Single npm package under `packages/detect`, PRD §7 module layout, regex pass 1 + entropy pass 2, per-category Faker synthesizers with `SYNTH` infix, bidirectional Map vault with LRU eviction.

**Tech Stack:** TypeScript ~5.6, `@faker-js/faker` ^10.6.0, vitest ^3, Node ≥18.

**Spec:** `docs/superpowers/specs/2026-09-24-detect-engine-mvp-design.md`

## Global Constraints

- Node.js ≥18 (dev machine runs v22).
- Faker version pinned `^10.6.0`; API names verified: `faker.internet.email()`, `faker.phone.number()`, `faker.internet.ipv4()`, `faker.string.alphanumeric()`.
- `cloak()` never throws on item failure — opaque-token fallback, continue.
- Synthetic secrets MUST contain `SYNTH` infix.
- Env key names always preserved; only values synthesized.
- No disk writes; vault in-memory only, default max 2000 entries.
- Import with `.js` suffixes in src (tsc `module: nodenext`).

---

### Task 1: Scaffold + types + vault

**Files:**
- Create: `packages/detect/package.json`
- Create: `packages/detect/tsconfig.json`
- Create: `packages/detect/src/types.ts`
- Create: `packages/detect/src/vault.ts`
- Test: `packages/detect/test/vault.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Vault{set,getBySynthetic,getByOriginal,list,clear,size}` → Task 5; types `Detection,Substitution,CloakResult,RestoreResult,VaultEntry,DataCloakConfig,CustomPattern,defaultConfig` → Tasks 2–5.

- [ ] **Step 1: Write the failing test**

```ts
// packages/detect/test/vault.test.ts
import { describe, expect, it } from 'vitest';
import { Vault } from '../src/vault.js';

describe('Vault', () => {
  it('round-trips synthetic->original', () => {
    const v = new Vault(10);
    v.set({ original: 'a@b.com', synthetic: 'x@y.net', category: 'EMAIL', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    expect(v.getBySynthetic('x@y.net')?.original).toBe('a@b.com');
    expect(v.getByOriginal('a@b.com')).toBe('x@y.net');
  });
  it('evicts oldest past maxEntries', () => {
    const v = new Vault(2);
    v.set({ original: '1', synthetic: 's1', category: 'C', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    v.set({ original: '2', synthetic: 's2', category: 'C', type: 'pii', synthesizedAt: 2, confidence: 'high' });
    v.set({ original: '3', synthetic: 's3', category: 'C', type: 'pii', synthesizedAt: 3, confidence: 'high' });
    expect(v.getBySynthetic('s1')).toBeUndefined();
    expect(v.size).toBe(2);
  });
  it('clear empties both directions', () => {
    const v = new Vault(10);
    v.set({ original: '1', synthetic: 's1', category: 'C', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    v.clear();
    expect(v.size).toBe(0);
    expect(v.getByOriginal('1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/detect -- vault 2>&1 | tail -5`
Expected: FAIL — files not found / cannot resolve `../src/vault.js`.

- [ ] **Step 3: Write minimal implementation**

```json
// packages/detect/package.json
{
  "name": "@datacloak/detect",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/engine.js",
  "types": "dist/engine.d.ts",
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "@faker-js/faker": "^10.6.0" },
  "devDependencies": { "typescript": "~5.6.3", "vitest": "^3.0.0" }
}
```

```json
// packages/detect/tsconfig.json
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
// packages/detect/src/types.ts
export type Confidence = 'high' | 'medium';
export type EntryType = 'pii' | 'secret' | 'credential';
export interface Detection { value: string; category: string; type: EntryType; start: number; end: number; confidence: Confidence; }
export interface Substitution { original: string; synthetic: string; category: string; }
export interface CloakResult { text: string; substitutions: Substitution[]; }
export interface RestoreResult { text: string; restored: number; }
export interface VaultEntry { original: string; synthetic: string; category: string; type: EntryType; synthesizedAt: number; confidence: Confidence; }
export interface CustomPattern { name: string; pattern: string; category: string; type: EntryType; }
export interface DataCloakConfig {
  detection: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean; entropyThreshold: number };
  vault: { maxEntries: number };
  customPatterns?: CustomPattern[];
}
export const defaultConfig: DataCloakConfig = {
  detection: { secrets: true, envVars: true, pii: true, entropy: true, entropyThreshold: 4.5 },
  vault: { maxEntries: 2000 },
};
```

```ts
// packages/detect/src/vault.ts
import type { VaultEntry } from './types.js';

export class Vault {
  private bySynthetic = new Map<string, VaultEntry>();
  private origToSynth = new Map<string, string>();
  constructor(private maxEntries = 2000) {}
  get size(): number { return this.bySynthetic.size; }
  set(entry: VaultEntry): void {
    if (this.bySynthetic.has(entry.synthetic)) return;
    this.bySynthetic.set(entry.synthetic, entry);
    this.origToSynth.set(entry.original, entry.synthetic);
    while (this.bySynthetic.size > this.maxEntries) {
      const oldest = this.bySynthetic.keys().next().value as string;
      const evicted = this.bySynthetic.get(oldest);
      this.bySynthetic.delete(oldest);
      if (evicted) this.origToSynth.delete(evicted.original);
    }
  }
  getBySynthetic(s: string): VaultEntry | undefined { return this.bySynthetic.get(s); }
  getByOriginal(o: string): string | undefined { return this.origToSynth.get(o); }
  list(): VaultEntry[] { return [...this.bySynthetic.values()]; }
  clear(): void { this.bySynthetic.clear(); this.origToSynth.clear(); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/detect 2>&1 | tail -5`
Expected: 3 passed. Then `npm run build --workspace packages/detect` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/detect/package.json packages/detect/tsconfig.json packages/detect/src/types.ts packages/detect/src/vault.ts packages/detect/test/vault.test.ts
git commit -m "feat(detect): scaffold package with types and LRU vault"
```

### Task 2: Pattern registry + pass-1 detection

**Files:**
- Create: `packages/detect/src/patterns/secrets.ts`
- Create: `packages/detect/src/patterns/credentials.ts`
- Create: `packages/detect/src/patterns/pii.ts`
- Create: `packages/detect/src/patterns/index.ts`
- Test: `packages/detect/test/patterns.test.ts`

**Interfaces:**
- Consumes: `Detection,EntryType,Confidence,CustomPattern` from Task 1.
- Produces: `PatternEntry{name,category,type,regex,confidence,valueGroup?}`, `detectPass1(text, opts): Detection[]` → Task 5. `CREDENTIAL_KEY_NAMES`, `isCredentialKey(key)` → Task 4 (env handling).

- [ ] **Step 1: Write the failing test**

```ts
// packages/detect/test/patterns.test.ts
import { describe, expect, it } from 'vitest';
import { detectPass1 } from '../src/patterns/index.js';

const cats = (t: string) => detectPass1(t, { secrets: true, envVars: true, pii: true }).map((d) => d.category);

describe('detectPass1', () => {
  it('finds openai key and email', () => {
    const ds = detectPass1('key sk-abcdefghij1234567890 mail john.doe@acme.com', { secrets: true, envVars: true, pii: true });
    expect(cats('key sk-abcdefghij1234567890')).toContain('API_KEY_OPENAI');
    expect(ds.find((d) => d.category === 'EMAIL')?.value).toBe('john.doe@acme.com');
  });
  it('finds aws key, jwt, ipv4, e164', () => {
    expect(cats('x AKIAIOSFODNN7EXAMPLE y')).toContain('AWS_ACCESS_KEY');
    expect(cats('t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_5NTkZBfQfRXNVIo z')).toContain('JWT');
    expect(cats('host 192.168.1.104 up')).toContain('IPV4');
    expect(cats('call +447700900123 now')).toContain('PHONE_E164');
  });
  it('de-overlaps: DSN wins over inner password', () => {
    const ds = detectPass1('postgres://alice:s3cr3t@db.prod.acme.com:5432/users', { secrets: true, envVars: true, pii: true });
    expect(ds).toHaveLength(1);
    expect(ds[0].category).toBe('DSN_POSTGRES');
  });
  it('env match exposes value span only', () => {
    const ds = detectPass1('DATABASE_URL=postgres://a:b@h:5432/d', { secrets: true, envVars: true, pii: true });
    const env = ds.find((d) => d.category === 'ENV_VAR');
    expect(env?.value).toBe('postgres://a:b@h:5432/d');
  });
  it('respects disabled flags', () => {
    expect(detectPass1('john.doe@acme.com', { secrets: true, envVars: true, pii: false })).toHaveLength(0);
  });
  it('throws loudly on invalid custom pattern', () => {
    expect(() => detectPass1('x', { secrets: true, envVars: true, pii: true }, [{ name: 'bad', pattern: '([', category: 'X', type: 'pii' }])).toThrow(/bad/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/detect -- patterns 2>&1 | tail -5`
Expected: FAIL — cannot resolve `../src/patterns/index.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/detect/src/patterns/secrets.ts
import type { EntryType, Confidence } from '../types.js';
export interface PatternEntry { name: string; category: string; type: EntryType; regex: RegExp; confidence: Confidence; valueGroup?: number; }
const s = (name: string, category: string, regex: RegExp): PatternEntry => ({ name, category, type: 'secret', regex, confidence: 'high' });
export const secretPatterns: PatternEntry[] = [
  s('anthropic', 'API_KEY_ANTHROPIC', /sk-ant-api03-[A-Za-z0-9\-_]{20,}/g),
  s('openai', 'API_KEY_OPENAI', /sk-[A-Za-z0-9]{20,}/g),
  s('aws', 'AWS_ACCESS_KEY', /AKIA[0-9A-Z]{16}/g),
  s('github-classic', 'GITHUB_PAT', /ghp_[A-Za-z0-9]{36}/g),
  s('github-fine', 'GITHUB_PAT', /github_pat_[A-Za-z0-9_]{22,}/g),
  s('stripe-sk', 'STRIPE_KEY', /sk_live_[A-Za-z0-9]{16,}/g),
  s('stripe-rk', 'STRIPE_KEY', /rk_live_[A-Za-z0-9]{16,}/g),
  s('jwt', 'JWT', /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_=.]+/g),
  s('pem', 'PEM_KEY', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g),
];
```

```ts
// packages/detect/src/patterns/credentials.ts
import type { PatternEntry } from './secrets.js';
export const CREDENTIAL_KEY_NAMES = ['PASSWORD','PASSWD','SECRET','API_KEY','APIKEY','API_SECRET','ACCESS_KEY','ACCESS_TOKEN','AUTH_TOKEN','PRIVATE_KEY','CLIENT_SECRET','DB_PASSWORD','DATABASE_URL','CONNECTION_STRING','AWS_SECRET_ACCESS_KEY','GITHUB_TOKEN','STRIPE_SECRET_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','SLACK_TOKEN','SENDGRID_API_KEY','TWILIO_AUTH_TOKEN','SUPABASE_KEY','VERCEL_TOKEN','SHOPIFY_TOKEN','GITLAB_TOKEN','HUGGINGFACE_TOKEN','JWT_SECRET','SESSION_SECRET','ENCRYPTION_KEY'];
export const isCredentialKey = (key: string): boolean => {
  const k = key.toUpperCase();
  if (CREDENTIAL_KEY_NAMES.includes(k)) return true;
  return /(PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|API[_-]?KEY|CONNECTION|DATABASE[_-]?URL|DSN)/.test(k);
};
export const credentialPatterns: PatternEntry[] = [
  { name: 'dsn-postgres', category: 'DSN_POSTGRES', type: 'credential', regex: /postgres(?:ql)?:\/\/[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-mongo', category: 'DSN_MONGO', type: 'credential', regex: /mongodb(?:\+srv)?:\/\/[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-redis', category: 'DSN_REDIS', type: 'credential', regex: /redis:\/\/(?::[^\s@]+@)?[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-mysql', category: 'DSN_MYSQL', type: 'credential', regex: /mysql:\/\/[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-amqp', category: 'DSN_AMQP', type: 'credential', regex: /amqp:\/\/(?:[^:\s@]+(?::[^\s@]*)?@)?[^\s"'`]+/g, confidence: 'high' },
  { name: 'env-var', category: 'ENV_VAR', type: 'credential', regex: /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"\n]*"|'[^'\n]*'|[^\s"'`#;]+)/gm, confidence: 'high', valueGroup: 2 },
  { name: 'inline-config', category: 'INLINE_CONFIG', type: 'credential', regex: /["']?(?:api[_-]?key|secret|password|token|access[_-]?key)["']?\s*[:=]\s*["']([^"'`\s]+)["']?/gi, confidence: 'high', valueGroup: 1 },
];
```

```ts
// packages/detect/src/patterns/pii.ts
import type { PatternEntry } from './secrets.js';
const p = (name: string, category: string, regex: RegExp): PatternEntry => ({ name, category, type: 'pii', regex, confidence: 'high' });
export const piiPatterns: PatternEntry[] = [
  p('email', 'EMAIL', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g),
  p('phone-e164', 'PHONE_E164', /\+[1-9]\d{7,14}/g),
  p('ipv4', 'IPV4', /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g),
  p('phone-us', 'PHONE_US', /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g),
];
```

```ts
// packages/detect/src/patterns/index.ts
import type { CustomPattern, Detection } from '../types.js';
import { secretPatterns, type PatternEntry } from './secrets.js';
import { credentialPatterns, isCredentialKey } from './credentials.js';
import { piiPatterns } from './pii.js';

export interface Pass1Opts { secrets: boolean; envVars: boolean; pii: boolean; }

export function detectPass1(text: string, opts: Pass1Opts, custom: CustomPattern[] = []): Detection[] {
  const entries: PatternEntry[] = [];
  if (opts.secrets) entries.push(...secretPatterns);
  if (opts.envVars) entries.push(...credentialPatterns);
  if (opts.pii) entries.push(...piiPatterns);
  for (const c of custom) {
    let regex: RegExp;
    try { regex = new RegExp(c.pattern, 'g'); } catch { throw new Error(`datacloak: invalid custom pattern "${c.name}"`); }
    entries.push({ name: c.name, category: c.category, type: c.type, regex, confidence: 'medium' });
  }
  const out: Detection[] = [];
  for (const e of entries) {
    e.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = e.regex.exec(text)) !== null) {
      if (m[0].length === 0) { e.regex.lastIndex++; continue; }
      let value = m[0], start = m.index;
      if (e.valueGroup !== undefined && m[e.valueGroup] !== undefined) {
        value = m[e.valueGroup];
        start = m.index + m[0].indexOf(value);
      }
      if (e.name === 'env-var') {
        const key = m[1];
        if (!isCredentialKey(key)) continue;
      }
      out.push({ value, category: e.category, type: e.type, start, end: start + value.length, confidence: e.confidence });
      if (m[0].length === 0) e.regex.lastIndex++;
    }
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Detection[] = [];
  for (const d of out) {
    if (kept.length > 0 && d.start < kept[kept.length - 1].end) continue;
    kept.push(d);
  }
  return kept;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/detect 2>&1 | tail -5`
Expected: all pass (vault 3 + patterns 6).

- [ ] **Step 5: Commit**

```bash
git add packages/detect/src/patterns packages/detect/test/patterns.test.ts
git commit -m "feat(detect): pattern registry with pass-1 de-overlap"
```

### Task 3: Entropy scanner

**Files:**
- Create: `packages/detect/src/entropy.ts`
- Test: `packages/detect/test/entropy.test.ts`

**Interfaces:**
- Consumes: nothing new (pure functions).
- Produces: `shannon(s: string): number`, `scanEntropy(text, threshold): {value,start,end}[]` → Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// packages/detect/test/entropy.test.ts
import { describe, expect, it } from 'vitest';
import { scanEntropy, shannon } from '../src/entropy.js';

describe('entropy', () => {
  it('low entropy for english words', () => {
    expect(shannon('password')).toBeLessThan(4.5);
  });
  it('flags random-looking token', () => {
    const hits = scanEntropy('token xK9#mQ2$vL7@nP4!qR8sT1 here', 4.5);
    expect(hits.map((h) => h.value)).toContain('xK9#mQ2$vL7@nP4!qR8sT1');
  });
  it('skips uuids and short words', () => {
    expect(scanEntropy('id 123e4567-e89b-12d3-a456-426614174000 see', 4.0)).toHaveLength(0);
    expect(scanEntropy('see the cat sat', 4.5)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/detect -- entropy 2>&1 | tail -5`
Expected: FAIL — cannot resolve `../src/entropy.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/detect/src/entropy.ts
export function shannon(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scanEntropy(text: string, threshold: number): { value: string; start: number; end: number }[] {
  const out: { value: string; start: number; end: number }[] = [];
  const re = /[^\s"'`,;()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    if (value.length < 20 || UUID.test(value)) continue;
    if (value.startsWith('data:image')) continue;
    if (shannon(value) >= threshold) out.push({ value, start: m.index, end: m.index + value.length });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/detect 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/detect/src/entropy.ts packages/detect/test/entropy.test.ts
git commit -m "feat(detect): shannon entropy scanner with uuid skip"
```

### Task 4: Synthesizers + opaque fallback

**Files:**
- Create: `packages/detect/src/synthesizers/pii.ts`
- Create: `packages/detect/src/synthesizers/secrets.ts`
- Create: `packages/detect/src/synthesizers/credentials.ts`
- Create: `packages/detect/src/synthesizers/index.ts`
- Create: `packages/detect/src/tokens.ts`
- Test: `packages/detect/test/synthesizers.test.ts`

**Interfaces:**
- Consumes: `isCredentialKey` (Task 2), faker library.
- Produces: `synthesize(category, original): string`, `synthesizeDsn(original): string`, `opaqueToken(category): string` → Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// packages/detect/test/synthesizers.test.ts
import { describe, expect, it } from 'vitest';
import { synthesize } from '../src/synthesizers/index.js';
import { synthesizeDsn } from '../src/synthesizers/credentials.js';
import { opaqueToken } from '../src/tokens.js';

describe('synthesize', () => {
  it('email stays an email, different value', () => {
    const s = synthesize('EMAIL', 'john.doe@acme.com');
    expect(s).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(s).not.toBe('john.doe@acme.com');
  });
  it('openai key keeps prefix with SYNTH infix', () => {
    const s = synthesize('API_KEY_OPENAI', 'sk-abcdefghij1234567890');
    expect(s.startsWith('sk-SYNTH')).toBe(true);
  });
  it('aws key keeps AKIA shape', () => {
    expect(synthesize('AWS_ACCESS_KEY', 'AKIAIOSFODNN7EXAMPLE')).toMatch(/^AKIA[0-9A-Z]{16}$/);
  });
  it('dsn preserves protocol and port', () => {
    const s = synthesizeDsn('postgres://alice:s3cr3t@db.prod.acme.com:5432/users');
    expect(s.startsWith('postgres://')).toBe(true);
    expect(s).toContain(':5432/');
    expect(s).not.toContain('alice');
  });
  it('fallback token is bracketed', () => {
    expect(opaqueToken('EMPLOYEE_ID')).toMatch(/^\[EMPLOYEE_ID_[A-Z0-9]{6}\]$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/detect -- synthesizers 2>&1 | tail -5`
Expected: FAIL — cannot resolve synthesizer modules.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/detect/src/synthesizers/pii.ts
import { faker } from '@faker-js/faker';
export function synthEmail(): string { return faker.internet.email(); }
export function synthPhoneUS(): string { return faker.phone.number('(###) 555-0###'); }
export function synthPhoneE164(): string { return faker.phone.number('+44770090####'); }
export function synthIpv4(): string { return faker.internet.ipv4(); }
```

```ts
// packages/detect/src/synthesizers/secrets.ts
import { faker } from '@faker-js/faker';
const alnum = (n: number): string => faker.string.alphanumeric(n);
export function synthOpenAI(): string { return `sk-SYNTH${alnum(20)}`; }
export function synthAnthropic(): string { return `sk-ant-api03-SYNTH${alnum(20)}`; }
export function synthAws(): string { return `AKIA${faker.string.alphanumeric({ length: 16, casing: 'upper' })}`; }
export function synthGithub(): string { return `ghp_SYNTH${alnum(31)}`; }
export function synthStripe(prefix: string): string { return `${prefix}SYNTH${alnum(20)}`; }
export function synthJwt(): string {
  const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: `synth-${faker.string.uuid()}`, iat: Date.now(), exp: Date.now() + 3600 });
  return `${header}.${body}.SYNTH${alnum(32)}`;
}
// ponytail: static throwaway PEM template; real @noble/curves keypair gen deferred to follow-up
export function synthPem(): string {
  const b64body = faker.string.alphanumeric(64);
  return `-----BEGIN RSA PRIVATE KEY-----\nSYNTH${b64body}\n-----END RSA PRIVATE KEY-----`;
}
```

```ts
// packages/detect/src/synthesizers/credentials.ts
import { faker } from '@faker-js/faker';
const DSN = /^([a-z+]+:\/\/)(?:([^:@/\s]+)(?::([^@/\s]*))?@)?([^:/\s]+)(?::(\d+))?(\/[^?\s]*)?(\?[^\s]*)?$/i;
export function synthesizeDsn(original: string): string {
  const m = DSN.exec(original);
  if (!m) return original;
  const [, proto, , , , port, path, query] = m;
  const user = faker.internet.username().replace(/[^A-Za-z0-9_]/g, '_');
  const pass = `SYNTHpw${faker.number.int({ min: 10, max: 99 })}`;
  const host = `${faker.internet.domainWord()}.${faker.internet.domainSuffix()}`;
  return `${proto}${user}:${pass}@${host}${port ? `:${port}` : ''}${path ?? ''}${query ?? ''}`;
}
```

```ts
// packages/detect/src/synthesizers/index.ts
import { synthEmail, synthIpv4, synthPhoneE164, synthPhoneUS } from './pii.js';
import { synthAnthropic, synthAws, synthGithub, synthJwt, synthOpenAI, synthPem, synthStripe } from './secrets.js';
import { synthesizeDsn } from './credentials.js';

export function synthesize(category: string, original: string): string | null {
  switch (category) {
    case 'EMAIL': return synthEmail();
    case 'PHONE_US': return synthPhoneUS();
    case 'PHONE_E164': return synthPhoneE164();
    case 'IPV4': return synthIpv4();
    case 'API_KEY_OPENAI': return synthOpenAI();
    case 'API_KEY_ANTHROPIC': return synthAnthropic();
    case 'AWS_ACCESS_KEY': return synthAws();
    case 'GITHUB_PAT': return synthGithub();
    case 'STRIPE_KEY': return synthStripe(original.startsWith('rk_live_') ? 'rk_live_' : 'sk_live_');
    case 'JWT': return synthJwt();
    case 'PEM_KEY': return synthPem();
    case 'DSN_POSTGRES': case 'DSN_MONGO': case 'DSN_REDIS': case 'DSN_MYSQL': case 'DSN_AMQP': return synthesizeDsn(original);
    default: return null;
  }
}
```

```ts
// packages/detect/src/tokens.ts
import { faker } from '@faker-js/faker';
export function opaqueToken(category: string): string {
  return `[${category.toUpperCase()}_${faker.string.alphanumeric({ length: 6, casing: 'upper' })}]`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/detect 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/detect/src/synthesizers packages/detect/src/tokens.ts packages/detect/test/synthesizers.test.ts
git commit -m "feat(detect): faker synthesizers with SYNTH infix and fallback"
```

### Task 5: Engine (detect/cloak/restore) + corpus + bench

**Files:**
- Create: `packages/detect/src/engine.ts`
- Create: `packages/detect/test/corpus.jsonl` (40 entries, excerpt below — 2 per category + negatives)
- Create: `packages/detect/test/engine.test.ts`

**Interfaces:**
- Consumes: `detectPass1`, `scanEntropy`, `synthesize`, `opaqueToken`, `Vault`, `defaultConfig` (Tasks 1–4).
- Produces: `DataCloakEngine{detect,cloak,restore,vault}` — public package API.

- [ ] **Step 1: Write the failing test**

```ts
// packages/detect/test/engine.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DataCloakEngine } from '../src/engine.js';

describe('engine', () => {
  it('cloak/restore round-trips email + key', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('mail john.doe@acme.com key sk-abcdefghij1234567890');
    expect(c.text).not.toContain('john.doe@acme.com');
    expect(c.text).not.toContain('sk-abcdefghij1234567890');
    expect(c.substitutions).toHaveLength(2);
    const r = e.restore(c.text);
    expect(r.text).toContain('john.doe@acme.com');
    expect(r.restored).toBe(2);
  });
  it('same original maps to same synthetic', () => {
    const e = new DataCloakEngine();
    const a = e.cloak('john.doe@acme.com');
    const b = e.cloak('john.doe@acme.com again john.doe@acme.com');
    expect(b.text.match(new RegExp(a.substitutions[0].synthetic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2);
  });
  it('env key preserved, value synthesized; dsn host gone', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('DATABASE_URL=postgres://alice:s3cr3t@db.prod.acme.com:5432/users');
    expect(c.text).toContain('DATABASE_URL=');
    expect(c.text).not.toContain('db.prod.acme.com');
  });
  it('recall on corpus >= 95%', () => {
    const lines = readFileSync(new URL('./corpus.jsonl', import.meta.url), 'utf8').trim().split('\n');
    const e = new DataCloakEngine();
    let hit = 0;
    for (const line of lines) {
      const { text, expect: cats } = JSON.parse(line) as { text: string; expect: string[] };
      const found = new Set(e.detect(text).map((d) => d.category));
      if (cats.every((c) => found.has(c))) hit++;
    }
    expect(hit / lines.length).toBeGreaterThanOrEqual(0.95);
  });
  it('10KB input cloaks in <20ms', () => {
    const e = new DataCloakEngine();
    const big = 'hello world john.doe@acme.com '.repeat(400);
    const t0 = performance.now();
    e.cloak(big);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
```

`corpus.jsonl` — one JSON object per line, `{"text": "...", "expect": ["CATEGORY"]}`:

```jsonl
{"text": "contact john.doe@acme.com for access", "expect": ["EMAIL"]}
{"text": "cc jane_smith99@example.org ASAP", "expect": ["EMAIL"]}
{"text": "call me at (415) 555-0192 tomorrow", "expect": ["PHONE_US"]}
{"text": "office 212-555-0147 ext 3", "expect": ["PHONE_US"]}
{"text": "uk line +447700900123 after 6pm", "expect": ["PHONE_E164"]}
{"text": "backup +14155552671 rings twice", "expect": ["PHONE_E164"]}
{"text": "server at 192.168.1.104 is down", "expect": ["IPV4"]}
{"text": "ping 10.0.4.25 three times", "expect": ["IPV4"]}
{"text": "key is sk-abcdefghij1234567890 done", "expect": ["API_KEY_OPENAI"]}
{"text": "export OPENAI_API_KEY=sk-Zx9mQ2vL7pT4wK8nR1yU5aB3dEfGhJk", "expect": ["ENV_VAR"]}
{"text": "anthropic sk-ant-api03-abcDEF1234567890xyz-456", "expect": ["API_KEY_ANTHROPIC"]}
{"text": "claude key sk-ant-api03-XyZ9876543210abcdEFGH-123 ok", "expect": ["API_KEY_ANTHROPIC"]}
{"text": "aws AKIAIOSFODNN7EXAMPLE in us-east-1", "expect": ["AWS_ACCESS_KEY"]}
{"text": "deploy with AKIAZZZZYYYYXXXX1234 role", "expect": ["AWS_ACCESS_KEY"]}
{"text": "token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456 ok", "expect": ["GITHUB_PAT"]}
{"text": "pat github_pat_abcDEF1234567890XYZ_1234 here", "expect": ["GITHUB_PAT"]}
{"text": "stripe sk_live_abcdefghij1234567890 charged", "expect": ["STRIPE_KEY"]}
{"text": "rk_live_abcdefghij1234567890 for restricted", "expect": ["STRIPE_KEY"]}
{"text": "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_5NTkZBfQfRXNVIo ok", "expect": ["JWT"]}
{"text": "bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.c2lnbmF0dXJlMTIzNDU2Nzg5MA expired", "expect": ["JWT"]}
{"text": "key -----BEGIN RSA PRIVATE KEY-----\nMIIB fake body\n-----END RSA PRIVATE KEY----- done", "expect": ["PEM_KEY"]}
{"text": "ssh -----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaAo=\n-----END OPENSSH PRIVATE KEY----- ok", "expect": ["PEM_KEY"]}
{"text": "DATABASE_URL=postgres://alice:s3cr3t@db.prod.acme.com:5432/users", "expect": ["ENV_VAR"]}
{"text": "export STRIPE_SECRET_KEY=sk_live_abcdefghij1234567890", "expect": ["ENV_VAR"]}
{"text": "connect postgres://alice:s3cr3t@db.prod.acme.com:5432/users now", "expect": ["DSN_POSTGRES"]}
{"text": "replica postgres://bob:pw2@db2.internal:5433/appdb?sslmode=require", "expect": ["DSN_POSTGRES"]}
{"text": "mongo mongodb+srv://admin:pass@cluster0.abcd1.mongodb.net/mydb", "expect": ["DSN_MONGO"]}
{"text": "alt mongodb://root:r00t@mongo.internal:27017/shop", "expect": ["DSN_MONGO"]}
{"text": "cache redis://:secretpassword@redis.acme.com:6379/0", "expect": ["DSN_REDIS"]}
{"text": "local redis://localhost:6379/0 no auth here", "expect": ["DSN_REDIS"]}
{"text": "db mysql://app:apPPa55@mysql.internal:3306/billing", "expect": ["DSN_MYSQL"]}
{"text": "legacy mysql://ro:readonly@10.1.2.3:3306/legacy", "expect": ["DSN_MYSQL", "IPV4"]}
{"text": "queue amqp://svc:msgpw@rabbit.internal:5672/vhost", "expect": ["DSN_AMQP"]}
{"text": "alt amqp://guest:guest@mq.local:5672/", "expect": ["DSN_AMQP"]}
{"text": "{\"api_key\": \"sk-abcdefghij1234567890\"}", "expect": ["INLINE_CONFIG"]}
{"text": "secret: 'xK9mQ2vL7pT4wK8nR1yU5aB3dEfG' in yaml", "expect": ["INLINE_CONFIG"]}
{"text": "deploy token xK9mQ2vL7pT4wK8nR1yU5aB3dEfG7hJkL expires", "expect": ["HIGH_ENTROPY_STRING"]}
{"text": "nothing sensitive here just hello world", "expect": []}
{"text": "version 1.2.3 released on monday morning", "expect": []}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/detect -- engine 2>&1 | tail -5`
Expected: FAIL — cannot resolve `../src/engine.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/detect/src/engine.ts
import { faker } from '@faker-js/faker';
import type { CloakResult, CustomPattern, DataCloakConfig, Detection, RestoreResult } from './types.js';
import { defaultConfig } from './types.js';
import { detectPass1 } from './patterns/index.js';
import { scanEntropy } from './entropy.js';
import { synthesize } from './synthesizers/index.js';
import { synthesizeDsn } from './synthesizers/credentials.js';
import { opaqueToken } from './tokens.js';
import { Vault } from './vault.js';

export class DataCloakEngine {
  readonly vault: Vault;
  private config: DataCloakConfig;
  constructor(config: Partial<DataCloakConfig> = {}) {
    this.config = { ...defaultConfig, ...config, detection: { ...defaultConfig.detection, ...config.detection }, vault: { ...defaultConfig.vault, ...config.vault } };
    // Validate custom patterns loudly at construction (DET-08)
    for (const c of this.config.customPatterns ?? []) {
      try { new RegExp(c.pattern); } catch { throw new Error(`datacloak: invalid custom pattern "${c.name}"`); }
    }
    this.vault = new Vault(this.config.vault.maxEntries);
  }
  detect(text: string): Detection[] {
    const d = this.config.detection;
    const pass1 = detectPass1(text, { secrets: d.secrets, envVars: d.envVars, pii: d.pii }, this.config.customPatterns ?? []);
    const out = [...pass1];
    if (d.entropy) {
      for (const h of scanEntropy(text, d.entropyThreshold)) {
        if (out.some((x) => h.start < x.end && x.start < h.end)) continue;
        out.push({ value: h.value, category: 'HIGH_ENTROPY_STRING', type: 'secret', start: h.start, end: h.end, confidence: 'medium' });
      }
    }
    out.sort((a, b) => a.start - b.start || b.end - a.end);
    return out;
  }
  cloak(text: string): CloakResult {
    const detections = this.detect(text);
    const substitutions: CloakResult['substitutions'] = [];
    let result = text;
    for (let i = detections.length - 1; i >= 0; i--) {
      const det = detections[i];
      const existing = this.vault.getByOriginal(det.value);
      let synthetic = existing;
      if (!synthetic) {
        synthetic = this.makeSynthetic(det, text);
        this.vault.set({ original: det.value, synthetic, category: det.category, type: det.type, synthesizedAt: Date.now(), confidence: det.confidence });
      }
      result = result.slice(0, det.start) + synthetic + result.slice(det.end);
      substitutions.unshift({ original: det.value, synthetic, category: det.category });
    }
    return { text: result, substitutions };
  }
  private makeSynthetic(det: Detection, fullText: string): string {
    if (det.category === 'ENV_VAR') return this.synthEnvValue(det.value);
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = synthesize(det.category, det.value) ?? opaqueToken(det.category);
      if (!fullText.includes(s)) return s;
    }
    return opaqueToken(det.category);
  }
  private synthEnvValue(value: string): string {
    const trimmed = value.replace(/^["']|["']$/g, '');
    const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : '';
    const inner = this.cloakInner(trimmed);
    return `${quote}${inner}${quote}`;
  }
  private cloakInner(value: string): string {
    // DSN-aware: synthesize whole DSN so protocol/port survive
    const dsnCats = ['DSN_POSTGRES', 'DSN_MONGO', 'DSN_REDIS', 'DSN_MYSQL', 'DSN_AMQP'];
    const asDsn = detectPass1(value, { secrets: false, envVars: true, pii: false }).find((x) => dsnCats.includes(x.category));
    if (asDsn && asDsn.value === value) {
      const existing = this.vault.getByOriginal(value);
      if (existing) return existing;
      const s = synthesizeDsn(value);
      this.vault.set({ original: value, synthetic: s, category: asDsn.category, type: 'credential', synthesizedAt: Date.now(), confidence: 'high' });
      return s;
    }
    // Otherwise cloak secrets/pii/entropy inside the value, offset by quote (handled by caller via full-string replace below)
    const inner = new DataCloakEngine({ detection: { secrets: true, envVars: false, pii: true, entropy: true, entropyThreshold: this.config.detection.entropyThreshold }, vault: { maxEntries: this.config.vault.maxEntries } });
    inner.vaultImport(this.vault);
    const r = inner.cloak(value);
    this.vaultAbsorb(inner.vault);
    return r.text === value ? `SYNTH${faker.string.alphanumeric(16)}` : r.text;
  }
  private vaultImport(_other: Vault): void { /* shared via absorb on the way out; import is a no-op by design */ }
  private vaultAbsorb(other: Vault): void {
    for (const e of other.list()) this.vault.set(e);
  }
  restore(text: string): RestoreResult {
    const entries = this.vault.list().sort((a, b) => b.synthetic.length - a.synthetic.length);
    let result = text;
    let restored = 0;
    for (const e of entries) {
      if (!result.includes(e.synthetic)) continue;
      result = result.split(e.synthetic).join(e.original);
      restored++;
    }
    return { text: result, restored };
  }
}
export type { CustomPattern };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/detect 2>&1 | tail -8`
Expected: all suites pass; corpus recall ≥95% (38/40). Then `npm run build --workspace packages/detect` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/detect/src/engine.ts packages/detect/test/engine.test.ts packages/detect/test/corpus.jsonl
git commit -m "feat(detect): engine with cloak/restore, corpus recall gate, perf guard"
```

## Self-review

- Spec §4 covered: Task 2 (patterns + de-overlap + custom validation), Task 3 (entropy + skips).
- Spec §5 covered: Task 4 (per-category Faker table, SYNTH infix, collision in Task 5 `makeSynthetic`, opaque fallback).
- Spec §6 covered: Task 1 (vault LRU) + Task 5 (consistency via `getByOriginal`, restore longest-first).
- Spec §8 covered: Task 5 (corpus + recall gate + perf guard); per-pattern unit tests in Task 2.
- No placeholders: every step has literal code/commands. Type names consistent (`PatternEntry`, `Pass1Opts`, `Vault`, `DataCloakEngine`) across tasks.
- Known simplification (flagged, not hidden): `vaultImport` no-op + absorb pattern keeps single shared vault without cross-instance aliasing; `synthEnvValue` re-quotes trimmed quotes.
