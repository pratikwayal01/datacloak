import { DataCloakEngine, defaultConfig, expandEntityPattern, inferEntityKind, isEntityKind } from '@pratikw/detect';
import type { CustomPattern, EntityKind } from '@pratikw/detect';
import type { BgRequest, BgResponse, StatsResponse } from './protocol.js';
import { decryptVault, encryptVault, loadOrCreateDek, MAX_ENTRIES, migrateSession, pruneStore, type StoredEntry, type StoredVault } from './vault-store.js';

export interface MemoryStore {
  getTab(tabId: number): Promise<{ vault: [string, string, string][] } | undefined>;
  setTab(tabId: number, data: { vault: [string, string, string][] }): Promise<void>;
  removeTab(tabId: number): Promise<void>;
}

export interface DetectorFlags {
  secrets: boolean;
  envVars: boolean;
  pii: boolean;
  entropy: boolean;
}

export interface SyncStore {
  getFlags(): Promise<DetectorFlags | undefined>;
  setFlags(flags: DetectorFlags): Promise<void>;
  getPatterns(): Promise<CustomPattern[] | undefined>;
  setPatterns(patterns: CustomPattern[]): Promise<void>;
}

export interface OpEntry {
  ts: number;
  tabId: number;
  kind: string;
  ms: number;
  count: number;
  categories: string[];
  origin?: string;
}

const DEFAULT_FLAGS: DetectorFlags = { secrets: true, envVars: true, pii: true, entropy: true };
const OPLOG_CAP = 100;

const engines = new Map<number, DataCloakEngine>();
// Last cloak per tab for the full-page diff view. Last-1 only, no history.
const lastCloak = new Map<number, { original: string; cloaked: string; subs: { original: string; synthetic: string; category: string; start: number; end: number }[]; ts: number }>();
const oplog: OpEntry[] = [];
let memoryFlags: DetectorFlags | undefined;
let memoryPatterns: CustomPattern[] | undefined;

const defaultSync: SyncStore = {
  getFlags: async () => memoryFlags,
  setFlags: async (f) => { memoryFlags = f; },
  getPatterns: async () => memoryPatterns,
  setPatterns: async (p) => { memoryPatterns = p; },
};

export function __dropEnginesForTest(): void {  engines.clear();
  oplog.length = 0;
  memoryFlags = undefined;
  memoryPatterns = undefined;
}

// ── Vault v2: origin-scoped persistent vault (see vault-store.ts) ──
// Origin is derived from sender.tab.url in prod wiring — never message body.
export interface VaultBackend {
  load(): Promise<StoredVault>;
  save(v: StoredVault): Promise<void>;
}

export function memoryVaultBackend(init: StoredVault = { origins: {} }): VaultBackend {
  let state: StoredVault = init;
  return {
    load: async () => state,
    save: async (v) => { state = v; },
  };
}

// URL.host strips scheme-default ports, lowercases — matches site-store host keys.
export function originFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host.toLowerCase() || null;
  } catch {
    return null;
  }
}

export interface LocalBlob {
  get: (k: string) => Promise<Record<string, unknown>>;
  set: (o: Record<string, unknown>) => Promise<void>;
  remove: (k: string) => Promise<void>;
}

// Per-origin encrypted blobs (`dc-vault-v2:<origin>`) + plaintext updatedAt meta.
// One bad origin blob fails closed without nuking the rest.
export function chromeVaultBackend(local: LocalBlob): VaultBackend {
  const META = 'dc-vault-v2-meta';
  const blobKey = (o: string): string => `dc-vault-v2:${o}`;
  let cache: StoredVault | null = null;
  const known = new Set<string>();
  return {
    load: async () => {
      if (cache) return cache;
      const key = await loadOrCreateDek();
      const meta = ((await local.get(META))[META] as Record<string, number> | undefined) ?? {};
      const origins: StoredVault['origins'] = {};
      for (const [o, updatedAt] of Object.entries(meta)) {
        try {
          const blob = ((await local.get(blobKey(o)))[blobKey(o)]) as string | undefined;
          if (!blob) continue;
          origins[o] = { updatedAt, entries: await decryptVault(blob, key) };
          known.add(o);
        } catch { /* skip bad origin */ }
      }
      cache = { origins };
      return cache;
    },
    save: async (v) => {
      cache = v;
      const key = await loadOrCreateDek();
      const meta: Record<string, number> = {};
      for (const [o, val] of Object.entries(v.origins)) {
        meta[o] = val.updatedAt;
        await local.set({ [blobKey(o)]: await encryptVault(val.entries, key) });
        known.add(o);
      }
      for (const o of [...known]) {
        if (!(o in v.origins)) { await local.remove(blobKey(o)); known.delete(o); }
      }
      await local.set({ [META]: meta });
    },
  };
}

let vaultWrites = 0;

export async function persistToVault(
  backend: VaultBackend,
  origin: string,
  fresh: StoredEntry[],
  now: number = Date.now(),
): Promise<void> {
  if (fresh.length === 0) return;
  const store = await backend.load();
  const prev = store.origins[origin];
  // ponytail: chronological append — LRU prune keeps newest, out-of-order writes weaken it.
  const entries = [...(prev?.entries ?? []), ...fresh].slice(-MAX_ENTRIES);
  const origins = { ...store.origins, [origin]: { updatedAt: now, entries } };
  vaultWrites += 1;
  await backend.save(vaultWrites % 10 === 0 ? pruneStore({ origins }, now) : { origins });
}

export async function startupPrune(backend: VaultBackend, now: number = Date.now()): Promise<void> {
  await backend.save(pruneStore(await backend.load(), now));
}

export interface VaultCtx { backend: VaultBackend; origin?: string }

export function __resetVaultWritesForTest(): void {
  vaultWrites = 0;
}

async function engineFor(tabId: number, store: MemoryStore, sync: SyncStore, vault?: VaultCtx): Promise<DataCloakEngine> {
  const hit = engines.get(tabId);
  if (hit) return hit;
  const flags = (await sync.getFlags()) ?? DEFAULT_FLAGS;
  const engine = new DataCloakEngine({
    detection: { ...defaultConfig.detection, secrets: flags.secrets, envVars: flags.envVars, pii: flags.pii, entropy: flags.entropy },
    customPatterns: (await sync.getPatterns()) ?? [],
  });
  const saved = await store.getTab(tabId);
  for (const [synthetic, original, category] of saved?.vault ?? []) {
    engine.vault.set({ original, synthetic, category, type: 'pii', synthesizedAt: Date.now(), confidence: 'high' });
  }
  // Origin vault rehydrates engines whose tab session is gone (restart/prune).
  if (vault?.origin) {
    try {
      for (const e of (await vault.backend.load()).origins[vault.origin]?.entries ?? []) {
        engine.vault.set({ original: e.original, synthetic: e.synthetic, category: e.category, type: 'pii', synthesizedAt: Date.now(), confidence: 'high' });
      }
    } catch { /* corrupt vault must not break cloak */ }
    // One-time first-run migration: session vault has entries but the
    // derived origin namespace is empty/absent — seed it so the origin
    // store catches up; afterwards session writes flow normally.
    if ((saved?.vault?.length ?? 0) > 0) {
      try {
        const stored = await vault.backend.load();
        if (!stored.origins[vault.origin]?.entries?.length) {
          await persistToVault(vault.backend, vault.origin, migrateSession(saved!.vault));
        }
      } catch { /* migration is best-effort */ }
    }
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

function record(entry: OpEntry): void {
  oplog.push(entry);
  if (oplog.length > OPLOG_CAP) oplog.splice(0, oplog.length - OPLOG_CAP);
}

function stats(): StatsResponse {
  let cloaked = 0;
  let restored = 0;
  const byCategory: Record<string, number> = {};
  for (const e of oplog) {
    if (e.kind === 'cloak') {
      cloaked += e.count;
      for (const c of e.categories) byCategory[c] = (byCategory[c] ?? 0) + 1;
    } else if (e.kind === 'restore') {
      restored += e.count;
    }
  }
  return { counts: { cloaked, restored }, byCategory, oplog: [...oplog] };
}

const PATTERN_TYPES = new Set(['pii', 'secret', 'credential']);

/** Validate user custom patterns. Returns error message, or null when valid (fills default type). */
export function validatePatterns(patterns: CustomPattern[]): string | null {
  if (!Array.isArray(patterns) || patterns.length > 50) return 'patterns must be a list of at most 50';
  for (const p of patterns) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) return 'each pattern needs a name';
    if (p.kind !== undefined) {
      // Typed entity row (value + kind): expand to a full pattern in place.
      if (!isEntityKind(p.kind)) return `pattern "${p.name}" has bad kind ${String(p.kind)}`;
      const expanded = expandEntityPattern(p.name.trim(), p.kind);
      p.pattern = expanded.pattern;
      p.category = expanded.category;
      p.type = expanded.type;
    } else if (typeof p.pattern !== 'string' || !p.pattern) {
      // Diff-capture sends name-only rows: infer the kind centrally so the
      // popup keeps zero engine imports. Explicit bad kinds still rejected above.
      if (typeof p.name !== 'string' || !p.name.trim()) return 'each pattern needs a name';
      const inferred = inferEntityKind(p.name.trim());
      const expanded = expandEntityPattern(p.name.trim(), inferred);
      p.kind = inferred;
      p.pattern = expanded.pattern;
      p.category = expanded.category;
      p.type = expanded.type;
    }
    if (typeof p.pattern !== 'string' || !p.pattern) return `pattern "${p.name}" needs a regex`;
    try { new RegExp(p.pattern); } catch { return `pattern "${p.name}" is not a valid regex`; }
    if (typeof p.category !== 'string' || !p.category.trim()) return `pattern "${p.name}" needs a category`;
    if (p.type === undefined) p.type = 'pii';
    else if (!PATTERN_TYPES.has(p.type)) return `pattern "${p.name}" has bad type ${p.type}`;
    if (p.synthesizer !== undefined && typeof p.synthesizer !== 'string') return `pattern "${p.name}" has bad synthesizer`;
  }
  return null;
}

// ── Context-menu capture ("Add to DataCloak") ──
// Pure against SyncStore: saves the selection as a kind-inferred row.
// Direct save, no confirm — the row is visible next popup open.
export async function addSelectedEntity(
  selectionText: string,
  sync: SyncStore,
): Promise<{ added: boolean; kind?: EntityKind; reason?: 'empty' | 'too-long' | 'duplicate' | 'invalid' }> {
  const value = selectionText.trim();
  if (!value) return { added: false, reason: 'empty' };
  if ([...value].length > 200) return { added: false, reason: 'too-long' };
  const kind = inferEntityKind(value);
  const existing = (await sync.getPatterns()) ?? [];
  if (existing.some((p) => p.name === value)) return { added: false, reason: 'duplicate' };
  const next = [...existing, expandEntityPattern(value, kind)];
  if (validatePatterns(next)) return { added: false, reason: 'invalid' };
  await sync.setPatterns(next);
  engines.clear();
  return { added: true, kind };
}

export async function handleRequest(tabId: number, req: BgRequest, store: MemoryStore, sync: SyncStore = defaultSync, vault?: VaultCtx): Promise<BgResponse> {  if (req.kind === 'stats') return stats();
  if (req.kind === 'settings.get') return { flags: (await sync.getFlags()) ?? { ...DEFAULT_FLAGS } };
  if (req.kind === 'settings.set') {
    await sync.setFlags(req.flags);
    engines.clear();
    return { flags: req.flags };
  }
  if (req.kind === 'patterns.get') return { patterns: (await sync.getPatterns()) ?? [] };  if (req.kind === 'patterns.set') {
    const error = validatePatterns(req.patterns);
    if (error) return { patterns: (await sync.getPatterns()) ?? [], error };
    try {
      await sync.setPatterns(req.patterns);
    } catch (e: unknown) {
      return { patterns: (await sync.getPatterns()) ?? [], error: `save failed: ${(e as Error)?.message ?? e}` };
    }
    engines.clear();
    return { patterns: req.patterns };
  }
  if (req.kind === 'lastCloak.get') return { record: lastCloak.get(tabId) ?? null };
  const engine = await engineFor(tabId, store, sync, vault);
  if (req.kind === 'cloak') {
    const start = Date.now();
    const r = engine.cloak(req.text);
    const categories = [...new Set(r.substitutions.map((s) => s.category))];
    record({ ts: Date.now(), tabId, kind: 'cloak', ms: Date.now() - start, count: r.substitutions.length, categories: r.substitutions.map((s) => s.category), origin: vault?.origin });
    lastCloak.set(tabId, {
      original: req.text,
      cloaked: r.text,
      subs: r.substitutions.map((s) => ({ original: s.original, synthetic: s.synthetic, category: s.category, start: s.start, end: s.end })),
      ts: Date.now(),
    });
    await persist(tabId, store);
    if (vault?.origin) {
      try {
        await persistToVault(vault.backend, vault.origin, r.substitutions.map((s) => ({ synthetic: s.synthetic, original: s.original, category: s.category })));
      } catch { /* persistent vault is best-effort; session persist above already landed */ }
    }
    return { text: r.text, count: r.substitutions.length, categories };
  }
  const start = Date.now();
  let r = engine.restore(req.text);
  if (r.restored === 0 && vault?.origin) {
    // Redirect/new-tab case: the tab engine never saw the cloak, but the
    // origin store may have it. Additive only — entries whose original OR
    // synthetic the tab already knows are never overwritten.
    try {
      const originEntries = (await vault.backend.load()).origins[vault.origin]?.entries ?? [];
      let topped = false;
      for (const oe of originEntries) {
        if (!engine.vault.getByOriginal(oe.original) && !engine.vault.getBySynthetic(oe.synthetic)) {
          engine.vault.set({ original: oe.original, synthetic: oe.synthetic, category: oe.category, type: 'pii', synthesizedAt: Date.now(), confidence: 'high' });
          topped = true;
        }
      }
      if (topped) r = engine.restore(req.text);
    } catch { /* fallback is best-effort */ }
  }
  record({ ts: Date.now(), tabId, kind: 'restore', ms: Date.now() - start, count: r.restored, categories: [], origin: vault?.origin });
  // Recased hits: expose one hit per distinct found form so the content
  // script locates each span exactly (LLMs recase fakes mid-reply).
  // Originals stay verbatim — never reshaped to the found case.
  const loweredReq = req.text.toLowerCase();
  const seen = new Set<string>();
  const hits: { synthetic: string; original: string }[] = [];
  for (const e of engine.vault.list()) {
    if (!e.synthetic) continue;
    const needle = e.synthetic.toLowerCase();
    let from = 0;
    for (;;) {
      const at = loweredReq.indexOf(needle, from);
      if (at < 0) break;
      const found = req.text.slice(at, at + e.synthetic.length);
      if (!seen.has(found)) {
        seen.add(found);
        hits.push({ synthetic: found, original: e.original });
      }
      from = at + e.synthetic.length;
    }
  }
  return { text: r.text, restored: r.restored, hits };
}

// Production wiring (no-op under test — chrome undefined there)
declare const chrome: {
  runtime: {
    onMessage: { addListener: (fn: (msg: BgRequest, sender: { tab?: { id?: number; url?: string } }) => Promise<BgResponse>) => void };
    onInstalled?: { addListener: (fn: () => void) => void };
    setUninstallURL?: (url: string) => void;
  };
  contextMenus?: {
    create: (o: { id: string; title: string; contexts: string[] }) => void;
    remove: (id: string) => unknown;
    onClicked: { addListener: (fn: (info: { menuItemId: string; selectionText?: string }) => void) => void };
  };
  storage: {
    session: { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void>; remove: (k: string) => Promise<void> };
    sync: { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void> };
    local: { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void>; remove: (k: string) => Promise<void> };
  };
  tabs: { onRemoved: { addListener: (fn: (tabId: number) => void) => void } };
} | undefined;

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  const store: MemoryStore = {
    getTab: async (t) => (await chrome.storage.session.get(`vault:${t}`))[`vault:${t}`] as { vault: [string, string, string][] } | undefined,
    setTab: async (t, d) => { await chrome.storage.session.set({ [`vault:${t}`]: d }); },
    removeTab: async (t) => { await chrome.storage.session.remove(`vault:${t}`); },
  };
  const sync: SyncStore = {
    getFlags: async () => (await chrome.storage.sync.get('dc-flags'))['dc-flags'] as DetectorFlags | undefined,
    setFlags: async (f) => { await chrome.storage.sync.set({ 'dc-flags': f }); },
    getPatterns: async () => (await chrome.storage.sync.get('dc-patterns'))['dc-patterns'] as CustomPattern[] | undefined,
    setPatterns: async (p) => { await chrome.storage.sync.set({ 'dc-patterns': p }); },
  };
  // Encrypted origin vault in chrome.storage.local; startup prune is the
  // TTL guarantee (no chrome.alarms — service-worker lifecycle makes it unreliable).
  const vaultBackend = chromeVaultBackend(chrome.storage.local);
  void startupPrune(vaultBackend).catch(() => {});
  chrome.runtime.onMessage.addListener(async (msg, sender) => {
    const tabId = sender.tab?.id ?? 0;
    // Origin from sender tab URL — never trust message body for namespacing.
    const origin = originFromUrl(sender.tab?.url) ?? undefined;
    return handleRequest(tabId, msg, store, sync, origin ? { backend: vaultBackend, origin } : undefined);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    engines.delete(tabId);
    lastCloak.delete(tabId);
    void store.removeTab(tabId);
  });
  // Uninstall feedback goes to a new GitHub issue.
  try { chrome.runtime.setUninstallURL?.('https://github.com/pratikwayal01/datacloak/issues/new?template=uninstall-feedback.yml'); } catch { /* older chrome */ }
  // Selection capture: idempotent setup (module re-runs per SW start;
  // onInstalled refires on reload/update within one lifetime — flag guards it).
  let menuWired = false;
  const setupSelectionMenu = (): void => {
    try {
      const menus = chrome?.contextMenus;
      if (!menus || menuWired) return;
      menuWired = true;
      try { void Promise.resolve(menus.remove('dc-add')).catch(() => {}); } catch { /* not yet created */ }
      menus.create({ id: 'dc-add', title: 'Add to DataCloak', contexts: ['selection'] });
      menus.onClicked.addListener((info) => {
        if (info.menuItemId !== 'dc-add' || !info.selectionText) return;
        void addSelectedEntity(info.selectionText, sync).catch(() => {});
      });
    } catch { /* older chrome */ }
  };
  setupSelectionMenu();
  try { chrome.runtime.onInstalled?.addListener(setupSelectionMenu); } catch { /* older chrome */ }
}
