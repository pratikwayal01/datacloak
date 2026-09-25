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
});
