import { DataCloakEngine, defaultConfig } from '@pratikw/detect';
import type { BgRequest, BgResponse, StatsResponse } from './protocol.js';
import { decryptVault, encryptVault, loadOrCreateDek, MAX_ENTRIES, pruneStore, type StoredEntry, type StoredVault } from './vault-store.js';

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
}

export interface OpEntry {
  ts: number;
  tabId: number;
  kind: string;
  ms: number;
  count: number;
  categories: string[];
}

const DEFAULT_FLAGS: DetectorFlags = { secrets: true, envVars: true, pii: true, entropy: true };
const OPLOG_CAP = 100;

const engines = new Map<number, DataCloakEngine>();
const oplog: OpEntry[] = [];
let memoryFlags: DetectorFlags | undefined;

const defaultSync: SyncStore = {
  getFlags: async () => memoryFlags,
  setFlags: async (f) => { memoryFlags = f; },
};

export function __dropEnginesForTest(): void {
  engines.clear();
  oplog.length = 0;
  memoryFlags = undefined;
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

export async function handleRequest(tabId: number, req: BgRequest, store: MemoryStore, sync: SyncStore = defaultSync, vault?: VaultCtx): Promise<BgResponse> {
  if (req.kind === 'stats') return stats();
  if (req.kind === 'settings.get') return { flags: (await sync.getFlags()) ?? { ...DEFAULT_FLAGS } };
  if (req.kind === 'settings.set') {
    await sync.setFlags(req.flags);
    engines.clear();
    return { flags: req.flags };
  }
  const engine = await engineFor(tabId, store, sync, vault);
  if (req.kind === 'cloak') {
    const start = Date.now();
    const r = engine.cloak(req.text);
    const categories = [...new Set(r.substitutions.map((s) => s.category))];
    record({ ts: Date.now(), tabId, kind: 'cloak', ms: Date.now() - start, count: r.substitutions.length, categories: r.substitutions.map((s) => s.category) });
    await persist(tabId, store);
    if (vault?.origin) {
      try {
        await persistToVault(vault.backend, vault.origin, r.substitutions.map((s) => ({ synthetic: s.synthetic, original: s.original, category: s.category })));
      } catch { /* persistent vault is best-effort; session persist above already landed */ }
    }
    return { text: r.text, count: r.substitutions.length, categories };
  }
  const start = Date.now();
  const r = engine.restore(req.text);
  record({ ts: Date.now(), tabId, kind: 'restore', ms: Date.now() - start, count: r.restored, categories: [] });
  const hits = engine.vault.list()
    .filter((e) => req.text.includes(e.synthetic))
    .map((e) => ({ synthetic: e.synthetic, original: e.original }));
  return { text: r.text, restored: r.restored, hits };
}

// Production wiring (no-op under test — chrome undefined there)
declare const chrome: {
  runtime: { onMessage: { addListener: (fn: (msg: BgRequest, sender: { tab?: { id?: number; url?: string } }) => Promise<BgResponse>) => void } };
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
    void store.removeTab(tabId);
  });
}
