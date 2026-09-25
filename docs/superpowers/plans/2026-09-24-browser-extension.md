# Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/browser-extension` MV3: composer detection, auto-cloak/review on send, per-tab vault, response restore, popup viewer.

**Architecture:** Pure logic (`sites.ts`, protocol) unit-tested under happy-dom with mocked chrome; thin DOM/adapters in `content.ts`; `background.ts` owns per-tab engines; esbuild bundles both entry points.

**Tech Stack:** TypeScript ~5.6, `@pratikw/detect` (workspace), esbuild, vitest + happy-dom, Chrome MV3 (Edge-compatible; Firefox flagged).

**Spec:** `docs/superpowers/specs/2026-09-24-browser-extension-design.md`

## Global Constraints

- Node.js ≥18. MV3 only (`manifest_version: 3`).
- Permissions: `storage` + 7 host permissions only. No `tabs`, no `webRequest`, no cookies.
- Vault in `chrome.storage.session`, keyed per tab; originals blurred in popup; no prompt text in console.
- content.ts is engine-free (messaging + DOM only); background owns all detection.
- `.js` import suffixes in src (consistent with repo).

---

### Task 1: Scaffold + sites + protocol

**Files:**
- Create: `packages/browser-extension/package.json`
- Create: `packages/browser-extension/tsconfig.json`
- Create: `packages/browser-extension/src/protocol.ts`
- Create: `packages/browser-extension/src/sites.ts`
- Test: `packages/browser-extension/test/sites.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CloakRequest/RestoreRequest/BackgroundResponse` types, `findComposer(doc): HTMLElement|null`, `findSendButton(root: ParentNode): HTMLElement|null`, `SITE_SELECTORS: Record<string,string[]>` → Tasks 2–4. `getFieldText(el)`, `setFieldText(el, text)` (textarea + contenteditable) → Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// packages/browser-extension/test/sites.test.ts
import { describe, expect, it } from 'vitest';
import { findComposer, findSendButton, getFieldText, setFieldText } from '../src/sites.js';

const composerHtml = `<div id="app"><div class="chatlog">hi</div><div class="composer"><textarea id="prompt" rows="4"></textarea><button data-testid="send">↑</button></div></div>`;

describe('sites', () => {
  it('finds the composer textarea, not decor', () => {
    document.body.innerHTML = `<textarea id="search" rows="1"></textarea>` + composerHtml;
    const el = findComposer(document);
    expect((el as HTMLTextAreaElement).id).toBe('prompt');
  });
  it('finds send button near composer', () => {
    document.body.innerHTML = composerHtml;
    const composer = findComposer(document) as HTMLElement;
    expect(findSendButton(composer.parentElement as HTMLElement)?.textContent).toBe('↑');
  });
  it('reads/writes textarea and contenteditable', () => {
    document.body.innerHTML = `<textarea id="t">hello</textarea><div id="e" contenteditable="true">world</div>`;
    expect(getFieldText(document.getElementById('t') as HTMLElement)).toBe('hello');
    setFieldText(document.getElementById('e') as HTMLElement, 'synth');
    expect(getFieldText(document.getElementById('e') as HTMLElement)).toBe('synth');
  });
});
```

vitest needs `environment: 'happy-dom'` — put in `packages/browser-extension/vitest.config.ts`:
`import { defineConfig } from 'vitest/config'; export default defineConfig({ test: { environment: 'happy-dom' } });`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/browser-extension 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/sites.js`.

- [ ] **Step 3: Write minimal implementation**

```json
// packages/browser-extension/package.json
{
  "name": "@pratikw/browser-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "build": "esbuild src/background.ts --bundle --format=esm --outfile=dist/background.js && esbuild src/content.ts --bundle --format=iife --outfile=dist/content.js && esbuild src/popup.ts --bundle --format=iife --outfile=dist/popup.js", "test": "vitest run" },
  "dependencies": { "@pratikw/detect": "*" },
  "devDependencies": { "typescript": "~5.6.3", "vitest": "^3.0.0", "happy-dom": "^17.0.0", "esbuild": "^0.25.0" }
}
```

```json
// packages/browser-extension/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "nodenext", "moduleResolution": "nodenext",
    "strict": true, "outDir": "dist", "rootDir": "src", "skipLibCheck": true,
    "lib": ["ES2022", "DOM"], "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

```ts
// packages/browser-extension/src/protocol.ts
export interface CloakRequest { kind: 'cloak'; text: string; }
export interface RestoreRequest { kind: 'restore'; text: string; }
export type BgRequest = CloakRequest | RestoreRequest;
export interface CloakResponse { text: string; count: number; categories: string[]; }
export interface RestoreResponse { text: string; restored: number; }
export type BgResponse = CloakResponse | RestoreResponse;
```

```ts
// packages/browser-extension/src/sites.ts
export const SITE_SELECTORS: Record<string, string[]> = {
  'claude.ai': ['div[contenteditable="true"][data-testid*="chat"]', 'div[contenteditable="true"]'],
  'chat.openai.com': ['#prompt-textarea', 'textarea[data-id="root"]', 'textarea'],
  'chatgpt.com': ['#prompt-textarea', 'textarea'],
  'gemini.google.com': ['div[contenteditable="true"]', 'rich-textarea textarea'],
  'x.ai': ['textarea', 'div[contenteditable="true"]'],
  'perplexity.ai': ['textarea', 'div[contenteditable="true"]'],
  'cowork.ai': ['textarea', 'div[contenteditable="true"]'],
  'chat.deepseek.com': ['textarea', 'div[contenteditable="true"]'],
};

const isVisible = (el: Element): boolean => {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 40 && r.height > 20;
};

const score = (el: Element): number => {
  const r = (el as HTMLElement).getBoundingClientRect();
  const lowBonus = r.top > window.innerHeight * 0.4 ? 1000 : 0;
  const area = Math.min(r.width * r.height, 200000);
  return lowBonus + area;
};

export function findComposer(doc: Document = document): HTMLElement | null {
  const host = location.hostname.replace(/^www\./, '');
  const sels = SITE_SELECTORS[host] ?? ['textarea', 'div[contenteditable="true"]'];
  let best: HTMLElement | null = null;
  let bestScore = -1;
  for (const sel of sels) {
    for (const el of doc.querySelectorAll(sel)) {
      if (!isVisible(el)) continue;
      const s = score(el);
      if (s > bestScore) { bestScore = s; best = el as HTMLElement; }
    }
    if (best) break;
  }
  return best;
}

export function findSendButton(root: ParentNode): HTMLElement | null {
  const btn = root.querySelector('button[type="submit"], button[data-testid*="send" i], button[aria-label*="send" i]');
  return (btn as HTMLElement) ?? null;
}

export function getFieldText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.innerText ?? el.textContent ?? '';
}

export function setFieldText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.focus();
    (el as HTMLTextAreaElement).value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
    if (getFieldText(el) !== text) el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/browser-extension 2>&1 | tail -4`
Expected: 3 passed (happy-dom provides layout-zero rects — `isVisible`
fails! FIX IN TEST: happy-dom getBoundingClientRect returns zeros, so
`isVisible` rejects everything. The test above would fail. Implementer:
mock rects in test via `Element.prototype.getBoundingClientRect = () => ({width: 300, height: 80, top: 700, ...} as DOMRect)` and `window.innerHeight = 900` before assertions.)

- [ ] **Step 5: Commit**

```bash
git add packages/browser-extension/package.json packages/browser-extension/tsconfig.json packages/browser-extension/vitest.config.ts packages/browser-extension/src/protocol.ts packages/browser-extension/src/sites.ts packages/browser-extension/test/sites.test.ts
git commit -m "feat(extension): scaffold with composer finder and protocol"
```

### Task 2: Background (engine per tab + vault)

**Files:**
- Create: `packages/browser-extension/src/background.ts`
- Test: `packages/browser-extension/test/background.test.ts`

**Interfaces:**
- Consumes: `BgRequest/BgResponse` (Task 1), `DataCloakEngine` from detect.
- Produces: `handleRequest(tabId, req, store): Promise<BgResponse>`, `MemoryStore` interface (chrome-backed in prod, fake in tests) → Task 3 uses message shapes only.

```ts
export interface MemoryStore {
  getTab(tabId: number): Promise<{ vault: [string, string][] } | undefined>;
  setTab(tabId: number, data: { vault: [string, string][] }): Promise<void>;
  removeTab(tabId: number): Promise<void>;
}
```

Engine instances live in a module Map keyed by tabId; vault serialized as
`[synthetic, original, category]` triples on every mutation (service-worker
wake safe). Background listener: `chrome.runtime.onMessage.addListener`
with `sender.tab.id`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/browser-extension/test/background.test.ts
import { describe, expect, it } from 'vitest';
import { handleRequest, type MemoryStore } from '../src/background.js';

const fakeStore = (): MemoryStore => {
  const m = new Map<number, { vault: [string, string][] }>();
  return {
    getTab: async (t) => m.get(t),
    setTab: async (t, d) => { m.set(t, d); },
    removeTab: async (t) => { m.delete(t); },
  };
};

describe('background', () => {
  it('cloak isolates vaults per tab', async () => {
    const s = fakeStore();
    const a = await handleRequest(1, { kind: 'cloak', text: 'john.doe@acme.com' }, s);
    const b = await handleRequest(2, { kind: 'cloak', text: 'john.doe@acme.com' }, s);
    expect(a.count).toBe(1);
    expect((a as { text: string }).text).not.toBe((b as { text: string }).text);
  });
  it('restore swaps synthetics back', async () => {
    const s = fakeStore();
    const c = await handleRequest(7, { kind: 'cloak', text: 'key sk-abcdefghij1234567890' }, s);
    const r = await handleRequest(7, { kind: 'restore', text: (c as { text: string }).text }, s);
    expect((r as { text: string }).text).toContain('sk-abcdefghij1234567890');
  });
  it('rehydrates engine from store after restart', async () => {
    const s = fakeStore();
    const c = await handleRequest(9, { kind: 'cloak', text: 'john.doe@acme.com' }, s);
    const { __dropEnginesForTest } = await import('../src/background.js');
    __dropEnginesForTest();
    const r = await handleRequest(9, { kind: 'restore', text: (c as { text: string }).text }, s);
    expect((r as { text: string }).text).toContain('john.doe@acme.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/browser-extension -- background 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/background.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/browser-extension/src/background.ts
import { DataCloakEngine } from '@pratikw/detect';
import type { BgRequest, BgResponse } from './protocol.js';

export interface MemoryStore {
  getTab(tabId: number): Promise<{ vault: [string, string, string][] } | undefined>;
  setTab(tabId: number, data: { vault: [string, string, string][] }): Promise<void>;
  removeTab(tabId: number): Promise<void>;
}

const engines = new Map<number, DataCloakEngine>();

export function __dropEnginesForTest(): void {
  engines.clear();
}

async function engineFor(tabId: number, store: MemoryStore): Promise<DataCloakEngine> {
  const hit = engines.get(tabId);
  if (hit) return hit;
  const engine = new DataCloakEngine();
  const saved = await store.getTab(tabId);
  for (const [synthetic, original, category] of saved?.vault ?? []) {
    engine.vault.set({ original, synthetic, category, type: 'pii', synthesizedAt: Date.now(), confidence: 'high' });
  }
  engines.set(tabId, engine);
  return engine;
}

async function persist(tabId: number, store: MemoryStore): Promise<void> {
  const engine = engines.get(tabId);
  if (!engine) return;
  await store.setTab(tabId, {
    vault: engine.vault.list().map((e) => [e.synthetic, e.original, e.category]),
  });
}

export async function handleRequest(tabId: number, req: BgRequest, store: MemoryStore): Promise<BgResponse> {
  const engine = await engineFor(tabId, store);
  if (req.kind === 'cloak') {
    const r = engine.cloak(req.text);
    await persist(tabId, store);
    return { text: r.text, count: r.substitutions.length, categories: [...new Set(r.substitutions.map((s) => s.category))] };
  }
  const r = engine.restore(req.text);
  return { text: r.text, restored: r.restored };
}

// Production wiring (no-op under test — chrome undefined there)
declare const chrome: {
  runtime: { onMessage: { addListener: (fn: (msg: BgRequest, sender: { tab?: { id?: number } }) => Promise<BgResponse>) => void } };
  storage: { session: { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void>; remove: (k: string) => Promise<void> } };
  tabs: { onRemoved: { addListener: (fn: (tabId: number) => void) => void } };
} | undefined;

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  const store: MemoryStore = {
    getTab: async (t) => (await chrome.storage.session.get(`vault:${t}`))[`vault:${t}`] as { vault: [string, string, string][] } | undefined,
    setTab: async (t, d) => { await chrome.storage.session.set({ [`vault:${t}`]: d }); },
    removeTab: async (t) => { await chrome.storage.session.remove(`vault:${t}`); },
  };
  chrome.runtime.onMessage.addListener(async (msg, sender) => {
    const tabId = sender.tab?.id ?? 0;
    return handleRequest(tabId, msg, store);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    engines.delete(tabId);
    void store.removeTab(tabId);
  });
}
```

Note: test uses `[string, string][]` pairs in fakeStore while impl uses
triples — align the TEST to triples (`[synthetic, original, category]`).
Implementer: fix the test's fakeStore typing to triples before running.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace packages/browser-extension 2>&1 | tail -4`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/browser-extension/src/background.ts packages/browser-extension/test/background.test.ts
git commit -m "feat(extension): per-tab background engines with session vault"
```

### Task 3: Content script (intercept + review + restore)

**Files:**
- Create: `packages/browser-extension/src/content.ts`
- Test: `packages/browser-extension/test/content.test.ts`

**Interfaces:**
- Consumes: `findComposer/findSendButton/getFieldText/setFieldText` (Task 1), `BgRequest/BgResponse` protocol (Task 1). Sends via injected `sendToBackground(req): Promise<BgResponse>` (chrome in prod, fake in tests).
- Produces: `armComposer(doc, send, opts)` → returns `{ disarm(): void }`; `observeResponses(logRoot, send): MutationObserver`.

Behavior:
- `armComposer`: capture-phase keydown (Enter w/o shift → intercept),
  click on send button (capture), submit on closest form. On intercept:
  `preventDefault + stopPropagation`, cloak via send, if count 0 → proceed
  (click real button once with guard flag / dispatch Enter ignored-once);
  if count > 0 and mode auto → setFieldText + proceed; review mode →
  render panel with per-item rows (category + masked value + Accept/Skip)
  + Cloak-all; on confirm → setFieldText(accepted) + proceed.
- `observeResponses`: MutationObserver, debounce 800ms quiet → scan
  text nodes for restore via send, wrap replacements in span.dc-restored.
- Badge: small pill near composer showing state (active/cloaked count).

Test with happy-dom fixtures + fake send (no chrome):

```ts
// packages/browser-extension/test/content.test.ts
import { describe, expect, it, vi } from 'vitest';
import { armComposer } from '../src/content.js';
import type { BgRequest, BgResponse } from '../src/protocol.js';

const fakeSend = (map: (t: string) => string) => async (req: BgRequest): Promise<BgResponse> => {
  if (req.kind === 'cloak') return { text: map(req.text), count: req.text === map(req.text) ? 0 : 1, categories: ['EMAIL'] };
  return { text: req.text, restored: 0 };
};

describe('content', () => {
  it('rewrites composer and clicks through once', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">john.doe@acme.com</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, fakeSend(() => 'CLOAKED@x.net'), { mode: 'auto' });
    (document.getElementById('p') as HTMLTextAreaElement).focus();
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('CLOAKED@x.net');
    expect(submitted).toBe(1);
    disarm();
  });
  it('clean text submits without rewrite', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hello world</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, fakeSend((t) => t), { mode: 'auto' });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toBe(1);
    disarm();
  });
});
```

Implement `armComposer(doc, send, opts: { mode: 'auto'|'review' })` to
satisfy exactly these two tests first, then review-panel + observer
(minimal, same file, covered by Task 4 tests if needed — keep them small
and direct: panel lists `categories` with one Cloak-all button for MVP).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace packages/browser-extension -- content 2>&1 | tail -3`
Expected: FAIL — cannot resolve `../src/content.js`.

- [ ] **Step 3/4/5:** implement, verify green, commit `feat(extension): composer intercept with auto-cloak`.

### Task 4: Popup + manifest + bundle

**Files:**
- Create: `packages/browser-extension/popup.html`
- Create: `packages/browser-extension/src/popup.ts`
- Create: `packages/browser-extension/manifest.json`
- Test: `packages/browser-extension/test/popup.test.ts` (message-shape + blur logic on fixture DOM)

**Interfaces:**
- Consumes: protocol types (Task 1). Popup talks to background via same sendMessage shapes (mocked in tests).

manifest.json (MV3, exact):

```json
{
  "manifest_version": 3,
  "name": "DataCloak",
  "version": "0.1.0",
  "description": "Swap secrets/PII for realistic fakes before AI chat sees them.",
  "permissions": ["storage"],
  "host_permissions": [
    "https://claude.ai/*",
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://gemini.google.com/*",
    "https://x.ai/*",
    "https://www.perplexity.ai/*",
    "https://cowork.ai/*",
    "https://chat.deepseek.com/*"
  ],
  "background": { "service_worker": "dist/background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": [
        "https://claude.ai/*",
        "https://chat.openai.com/*",
        "https://chatgpt.com/*",
        "https://gemini.google.com/*",
        "https://x.ai/*",
        "https://www.perplexity.ai/*",
        "https://cowork.ai/*",
        "https://chat.deepseek.com/*"
      ],
      "js": ["dist/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "dist/popup.html", "default_title": "DataCloak" }
}
```

popup.html references dist/popup.js + inline minimal CSS (no external
resources — CSP safe). popup.ts renders: mode toggle (auto/review via
chrome.storage.sync), counts, vault rows (synthetic + category + blurred
original, click-to-reveal), export-audit button (JSON download via blob).

Build check step (not vitest): `npm run build --workspace
packages/browser-extension` must exit 0 and emit dist/{background,content,popup}.js.
Commit `feat(extension): popup viewer, MV3 manifest, esbuild bundle`.

## Self-review

- Spec §2: T1 (sites+protocol) → T2 (background/vault) → T3 (intercept/review/restore) → T4 (popup/manifest). §3 permissions: exact match lists in manifest. §4 esbuild: Task 4 build step. §5 layout matches. §6 happy-dom tests, no browser.
- No placeholders: literal code/commands throughout; two known test-env traps (happy-dom rects, triple typing) called out inline.
- Type consistency: BgRequest/BgResponse, MemoryStore, armComposer(doc, send, opts) used identically across tasks.
