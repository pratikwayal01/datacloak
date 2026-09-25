import { DataCloakEngine, defaultConfig } from '@pratikw/detect';
import type { BgRequest, BgResponse, StatsResponse } from './protocol.js';

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

async function engineFor(tabId: number, store: MemoryStore, sync: SyncStore): Promise<DataCloakEngine> {
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

export async function handleRequest(tabId: number, req: BgRequest, store: MemoryStore, sync: SyncStore = defaultSync): Promise<BgResponse> {
  if (req.kind === 'stats') return stats();
  if (req.kind === 'settings.get') return { flags: (await sync.getFlags()) ?? { ...DEFAULT_FLAGS } };
  if (req.kind === 'settings.set') {
    await sync.setFlags(req.flags);
    engines.clear();
    return { flags: req.flags };
  }
  const engine = await engineFor(tabId, store, sync);
  if (req.kind === 'cloak') {
    const start = Date.now();
    const r = engine.cloak(req.text);
    const categories = [...new Set(r.substitutions.map((s) => s.category))];
    record({ ts: Date.now(), tabId, kind: 'cloak', ms: Date.now() - start, count: r.substitutions.length, categories: r.substitutions.map((s) => s.category) });
    await persist(tabId, store);
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
  runtime: { onMessage: { addListener: (fn: (msg: BgRequest, sender: { tab?: { id?: number } }) => Promise<BgResponse>) => void } };
  storage: {
    session: { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void>; remove: (k: string) => Promise<void> };
    sync: { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void> };
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
  chrome.runtime.onMessage.addListener(async (msg, sender) => {
    const tabId = sender.tab?.id ?? 0;
    return handleRequest(tabId, msg, store, sync);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    engines.delete(tabId);
    void store.removeTab(tabId);
  });
}
