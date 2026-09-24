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
