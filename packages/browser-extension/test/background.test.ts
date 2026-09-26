import { describe, expect, it } from 'vitest';
import { handleRequest, type MemoryStore } from '../src/background.js';

const fakeStore = (): MemoryStore => {
  const m = new Map<number, { vault: [string, string, string][] }>();
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
    const hits = (r as { hits?: { synthetic: string; original: string }[] }).hits ?? [];
    expect(hits.some((h) => h.original === 'sk-abcdefghij1234567890')).toBe(true);
  });
  it('oplog records cloak with ms>=0', async () => {
    const s = fakeStore();
    const { __dropEnginesForTest } = await import('../src/background.js');
    __dropEnginesForTest();
    await handleRequest(21, { kind: 'cloak', text: 'john.doe@acme.com' }, s);
    const stats = await handleRequest(21, { kind: 'stats' }, s) as { oplog: { ts: number; tabId: number; kind: string; ms: number; count: number; categories: string[] }[] };
    expect(stats.oplog.length).toBe(1);
    expect(stats.oplog[0].kind).toBe('cloak');
    expect(stats.oplog[0].tabId).toBe(21);
    expect(stats.oplog[0].ms).toBeGreaterThanOrEqual(0);
    expect(stats.oplog[0].count).toBe(1);
  });
  it('stats aggregates cloak/restore counts and categories', async () => {
    const s = fakeStore();
    const { __dropEnginesForTest } = await import('../src/background.js');
    __dropEnginesForTest();
    const c = await handleRequest(22, { kind: 'cloak', text: 'john.doe@acme.com' }, s);
    await handleRequest(22, { kind: 'restore', text: (c as { text: string }).text }, s);
    const stats = await handleRequest(22, { kind: 'stats' }, s) as { counts: { cloaked: number; restored: number }; byCategory: Record<string, number> };
    expect(stats.counts.cloaked).toBe(1);
    expect(stats.counts.restored).toBe(1);
    expect(stats.byCategory['EMAIL']).toBe(1);
  });
  it('settings round-trip persists flags', async () => {
    const s = fakeStore();
    const flags = { secrets: false, envVars: true, pii: true, entropy: false };
    const set = await handleRequest(23, { kind: 'settings.set', flags }, s) as { flags: typeof flags };
    expect(set.flags).toEqual(flags);
    const get = await handleRequest(23, { kind: 'settings.get' }, s) as { flags: typeof flags };
    expect(get.flags).toEqual(flags);
  });
  it('oplog cap evicts oldest', async () => {
    const s = fakeStore();
    const { __dropEnginesForTest } = await import('../src/background.js');
    __dropEnginesForTest();
    for (let i = 0; i < 105; i++) {
      await handleRequest(24, { kind: 'cloak', text: `user${i}.doe@acme.com` }, s);
    }
    const stats = await handleRequest(24, { kind: 'stats' }, s) as { oplog: { ts: number }[] };
    expect(stats.oplog.length).toBe(100);
  });
  it('rehydrates engine from store after restart', async () => {
    const s = fakeStore();
    const c = await handleRequest(9, { kind: 'cloak', text: 'john.doe@acme.com' }, s);
    const { __dropEnginesForTest } = await import('../src/background.js');
    __dropEnginesForTest();
    const r = await handleRequest(9, { kind: 'restore', text: (c as { text: string }).text }, s);
    expect((r as { text: string }).text).toContain('john.doe@acme.com');
  });
  it('origin vault persists across restart with empty session store', async () => {
    const { __dropEnginesForTest, memoryVaultBackend } = await import('../src/background.js');
    __dropEnginesForTest();
    const backend = memoryVaultBackend();
    const s1 = fakeStore();
    const c = await handleRequest(31, { kind: 'cloak', text: 'john.doe@acme.com' }, s1, undefined, { backend, origin: 'claude.ai' });
    const cloaked = (c as { text: string }).text;
    expect(cloaked).not.toContain('john.doe@acme.com');
    __dropEnginesForTest();
    // Fresh session (tab state gone) — origin vault must rehydrate the engine.
    const r = await handleRequest(31, { kind: 'restore', text: cloaked }, fakeStore(), undefined, { backend, origin: 'claude.ai' });
    expect((r as { text: string }).text).toContain('john.doe@acme.com');
  });
  it('startup prune drops expired origins', async () => {
    const { memoryVaultBackend, startupPrune } = await import('../src/background.js');
    const backend = memoryVaultBackend({
      origins: {
        fresh: { updatedAt: Date.now(), entries: [{ synthetic: 's', original: 'o', category: 'EMAIL' }] },
        stale: { updatedAt: Date.now() - 8 * 864e5, entries: [{ synthetic: 'x', original: 'y', category: 'EMAIL' }] },
      },
    });
    await startupPrune(backend, Date.now());
    const after = await backend.load();
    expect(after.origins['fresh']).toBeDefined();
    expect(after.origins['stale']).toBeUndefined();
  });
  it('first-run migrates session vault into empty origin namespace', async () => {
    const { __dropEnginesForTest, memoryVaultBackend } = await import('../src/background.js');
    __dropEnginesForTest();
    const backend = memoryVaultBackend();
    const s = fakeStore();
    await s.setTab(61, { vault: [['SYN-old', 'john.doe@acme.com', 'EMAIL']] });
    __dropEnginesForTest();
    await handleRequest(61, { kind: 'cloak', text: 'hello world' }, s, undefined, { backend, origin: 'mig.test' });
    const entries = (await backend.load()).origins['mig.test']?.entries ?? [];
    expect(entries.some((e) => e.original === 'john.doe@acme.com')).toBe(true);
  });
  it('originFromUrl derives vault host from sender tab url, never message body', async () => {
    const { originFromUrl } = await import('../src/background.js');
    expect(originFromUrl('https://claude.ai/chat/123')).toBe('claude.ai');
    expect(originFromUrl('http://nas:3000/x')).toBe('nas:3000');
    expect(originFromUrl('not a url')).toBeNull();
    expect(originFromUrl(undefined)).toBeNull();
  });
  it('prunes on every 10th vault write', async () => {
    const { __dropEnginesForTest, __resetVaultWritesForTest, memoryVaultBackend } = await import('../src/background.js');
    __dropEnginesForTest();
    __resetVaultWritesForTest();
    const backend = memoryVaultBackend({
      origins: { stale: { updatedAt: Date.now() - 8 * 864e5, entries: [{ synthetic: 'x', original: 'y', category: 'EMAIL' }] } },
    });
    const s = fakeStore();
    for (let i = 0; i < 9; i++) {
      await handleRequest(50 + i, { kind: 'cloak', text: 'john.doe@acme.com' }, s, undefined, { backend, origin: 'a.io' });
    }
    expect((await backend.load()).origins['stale']).toBeDefined();
    await handleRequest(59, { kind: 'cloak', text: 'john.doe@acme.com' }, s, undefined, { backend, origin: 'a.io' });
    expect((await backend.load()).origins['stale']).toBeUndefined();
  });
});