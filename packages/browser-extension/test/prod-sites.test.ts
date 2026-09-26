import { describe, expect, it, vi, afterEach } from 'vitest';
import { prodSites } from '../src/popup.js';

const g = globalThis as unknown as { chrome?: unknown };

interface ChromeMocks {
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  store: Record<string, unknown>;
}

const setChrome = (): ChromeMocks => {
  const m: ChromeMocks = {
    contains: vi.fn(async () => false),
    request: vi.fn(async () => true),
    register: vi.fn(async () => {}),
    store: {},
  };
  g.chrome = {
    permissions: {
      contains: m.contains,
      request: m.request,
      remove: vi.fn(async () => true),
    },
    scripting: {
      registerContentScripts: m.register,
      unregisterContentScripts: vi.fn(async () => {}),
    },
    storage: { sync: {
      get: vi.fn(async () => ({ 'dc-sites': m.store['dc-sites'] })),
      set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(m.store, o); }),
    } },
    tabs: { query: vi.fn(async () => []) },
  };
  return m;
};

afterEach(() => { delete g.chrome; });

const flush = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 10)); };

describe('prodSites add', () => {
  it('persists the site before the grant dialog resolves', async () => {
    const m = setChrome();
    let release!: (v: boolean) => void;
    m.request.mockImplementationOnce(() => new Promise<boolean>((res) => { release = res; }));
    const p = prodSites().addSite('duck.ai');
    await flush();
    // Native prompt still open — but the site is already stored.
    const saved = m.store['dc-sites'] as { custom: { host: string; enabled: boolean }[] };
    expect(saved.custom).toEqual([{ host: 'duck.ai', enabled: true }]);
    release(true);
    const r = await p;
    expect(r.ok).toBe(true);
  });

  it('denied grant leaves a disabled entry for toggle-retry', async () => {
    const m = setChrome();
    m.request.mockResolvedValueOnce(false);
    const r = await prodSites().addSite('duck.ai');
    expect(r.ok).toBe(false);
    const saved = m.store['dc-sites'] as { custom: { host: string; enabled: boolean }[] };
    expect(saved.custom).toEqual([{ host: 'duck.ai', enabled: false }]);
  });

  it('getSites re-registers orphaned enabled sites', async () => {
    const m = setChrome();
    m.store['dc-sites'] = { custom: [{ host: 'duck.ai', enabled: true }], disabled: [] };
    m.contains.mockResolvedValueOnce(true);
    const { sites } = await prodSites().getSites();
    expect(m.register).toHaveBeenCalledWith([{ id: 'dc-duck.ai', matches: ['https://duck.ai/*'], js: ['dist/content.js'] }]);
    expect(sites.some((s) => s.host === 'duck.ai')).toBe(true);
  });
});
