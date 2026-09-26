import { describe, expect, it, vi } from 'vitest';
import { parseConfirmQuery, runConfirmPage, type ConfirmDeps } from '../src/confirm.js';
import type { CustomPattern } from '@pratikw/detect';
import type { UserSites } from '../src/site-store.js';
import type { BgResponse } from '../src/protocol.js';

const skeleton = (): void => {
  document.body.innerHTML = `
    <h1 id="cf-title">Confirm</h1><p id="cf-desc"></p>
    <button id="cf-cancel" type="button">Cancel</button>
    <button id="cf-confirm" type="button">Remove</button>
    <div id="cf-status"></div>`;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mockDeps = (store: { patterns: CustomPattern[]; sites: UserSites }, granted = true): ConfirmDeps & { closed: () => boolean } => {
  let isClosed = false;
  return {
    send: async (req) => {
      if (req.kind === 'patterns.get') return { patterns: store.patterns };
      if (req.kind === 'patterns.set') { store.patterns = req.patterns; return { patterns: store.patterns }; }
      return { text: '', count: 0, categories: [] } as BgResponse;
    },
    close: () => { isClosed = true; },
    closed: () => isClosed,
    chromeish: {
      permissions: { request: vi.fn(async () => granted), remove: async () => true },
      scripting: { registerContentScripts: vi.fn(async () => {}), unregisterContentScripts: async () => {} },
    },
    sites: {
      load: async () => store.sites,
      save: async (u) => { store.sites = u; },
    },
  };
};

describe('parseConfirmQuery', () => {
  it('parses remove-pattern', () => {
    expect(parseConfirmQuery('?action=remove-pattern&name=EMP')).toEqual({ action: 'remove-pattern', name: 'EMP' });
  });
  it('parses allow-site with scheme', () => {
    expect(parseConfirmQuery('?action=allow-site&host=nas%3A3000&scheme=http')).toEqual({ action: 'allow-site', host: 'nas:3000', scheme: 'http' });
  });
  it('rejects bad host and unknown action', () => {
    expect(parseConfirmQuery('?action=allow-site&host=***')).toHaveProperty('error');
    expect(parseConfirmQuery('?action=nope')).toHaveProperty('error');
    expect(parseConfirmQuery('?action=remove-pattern&name=')).toHaveProperty('error');
  });
});

describe('confirm page remove-pattern', () => {
  it('confirm deletes the entity', async () => {
    skeleton();
    const store = {
      patterns: [{ name: 'EMP', pattern: 'EMP-[0-9]+', category: 'E', type: 'pii' as const }],
      sites: { custom: [], disabled: [] },
    };
    const deps = mockDeps(store);
    await runConfirmPage(document, '?action=remove-pattern&name=EMP', deps);
    expect(document.getElementById('cf-title')?.textContent).toContain('EMP');
    (document.getElementById('cf-confirm') as HTMLButtonElement).click();
    await flush();
    expect(store.patterns).toEqual([]);
    expect(document.getElementById('cf-status')?.textContent).toMatch(/removed/);
  });
  it('cancel closes without deleting', async () => {
    skeleton();
    const store = {
      patterns: [{ name: 'EMP', pattern: 'EMP-[0-9]+', category: 'E', type: 'pii' as const }],
      sites: { custom: [], disabled: [] },
    };
    const deps = mockDeps(store);
    await runConfirmPage(document, '?action=remove-pattern&name=EMP', deps);
    (document.getElementById('cf-cancel') as HTMLButtonElement).click();
    expect(deps.closed()).toBe(true);
    expect(store.patterns).toHaveLength(1);
  });
  it('bad query shows error, no confirm', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[], sites: { custom: [], disabled: [] } };
    await runConfirmPage(document, '?action=nope', mockDeps(store));
    expect(document.getElementById('cf-status')?.textContent).toMatch(/unknown action/);
    expect(document.getElementById('cf-confirm')).toBeNull();
  });
});

describe('confirm page allow-site', () => {
  it('allow grants, registers and saves', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[], sites: { custom: [], disabled: [] } };
    const deps = mockDeps(store, true);
    await runConfirmPage(document, '?action=allow-site&host=duck.ai&scheme=', deps);
    expect(document.getElementById('cf-title')?.textContent).toContain('duck.ai');
    (document.getElementById('cf-confirm') as HTMLButtonElement).click();
    await flush();
    expect(deps.chromeish.permissions.request).toHaveBeenCalledWith({ origins: ['https://duck.ai/*'] });
    expect(store.sites.custom).toEqual([{ host: 'duck.ai', enabled: true }]);
    expect(document.getElementById('cf-status')?.textContent).toMatch(/added/);
  });
  it('denied grant saves nothing', async () => {
    skeleton();
    const request = vi.fn(async () => false);
    const store = { patterns: [] as CustomPattern[], sites: { custom: [], disabled: [] } };
    const deps = { ...mockDeps(store), chromeish: { permissions: { request, remove: async () => true }, scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {} } } };
    await runConfirmPage(document, '?action=allow-site&host=duck.ai&scheme=', deps);
    (document.getElementById('cf-confirm') as HTMLButtonElement).click();
    await flush();
    expect(store.sites.custom).toEqual([]);
    expect(document.getElementById('cf-status')?.textContent).toMatch(/denied/);
    expect(deps.closed()).toBe(false);
  });
});
