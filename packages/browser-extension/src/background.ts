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
