import { describe, expect, it, vi } from 'vitest';
import {
  buildAuditJson,
  countsFromResponse,
  renderPopup,
  summarize,
  type Mode,
  type PopupStorage,
  type VaultEntry,
} from '../src/popup.js';
import type { BgRequest, BgResponse } from '../src/protocol.js';

const ENTRIES: VaultEntry[] = [
  { synthetic: 'alice.synth@example.net', original: 'alice.real@acme.com', category: 'EMAIL' },
  { synthetic: 'sk-synth-0001', original: 'sk-live-abcdef123456', category: 'API_KEY' },
];

const fakeStorage = (mode: Mode = 'auto', vault: VaultEntry[] = ENTRIES): PopupStorage => {
  let m = mode;
  return {
    getMode: async () => m,
    setMode: async (next) => { m = next; },
    getVault: async () => vault,
  };
};

const skeleton = (): void => {
  document.body.innerHTML = `
    <button id="dc-mode-toggle"></button>
    <div id="dc-counts"></div>
    <div id="dc-vault"></div>
    <button id="dc-export">export</button>`;
};

describe('popup message shapes', () => {
  it('extracts counts from a CloakResponse via mocked send', async () => {
    const send = vi.fn(async (req: BgRequest): Promise<BgResponse> => {
      expect(req).toEqual({ kind: 'cloak', text: 'call alice.real@acme.com' });
      return { text: 'call alice.synth@example.net', count: 1, categories: ['EMAIL'] };
    });
    const res = await send({ kind: 'cloak', text: 'call alice.real@acme.com' });
    expect(countsFromResponse(res)).toEqual({ count: 1, categories: ['EMAIL'] });
    expect(countsFromResponse({ text: 'plain', restored: 0 })).toEqual({ count: 0, categories: [] });
  });
  it('summarize derives the same count/categories shape as background', () => {
    expect(summarize(ENTRIES)).toEqual({ count: 2, categories: ['EMAIL', 'API_KEY'] });
    expect(summarize([])).toEqual({ count: 0, categories: [] });
  });
});

describe('popup vault rendering', () => {
  it('blurs originals, click reveals and re-blurs', async () => {
    skeleton();
    await renderPopup(document, { storage: fakeStorage(), onExport: () => {} });
    const rows = document.querySelectorAll('#dc-vault .dc-row');
    expect(rows).toHaveLength(2);
    const orig = rows[0].querySelector('.dc-original') as HTMLElement;
    expect(orig.classList.contains('dc-blurred')).toBe(true);
    expect(orig.textContent).not.toContain('alice.real@acme.com');
    expect(rows[0].querySelector('.dc-synth')?.textContent).toBe('alice.synth@example.net');
    expect(rows[0].querySelector('.dc-cat')?.textContent).toBe('EMAIL');
    orig.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(orig.classList.contains('dc-blurred')).toBe(false);
    expect(orig.textContent).toBe('alice.real@acme.com');
    orig.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(orig.classList.contains('dc-blurred')).toBe(true);
    expect(orig.textContent).not.toContain('alice.real@acme.com');
  });
  it('shows counts and empty-state text', async () => {
    skeleton();
    await renderPopup(document, { storage: fakeStorage('auto', []), onExport: () => {} });
    expect(document.getElementById('dc-counts')?.textContent).toContain('0');
    expect(document.getElementById('dc-vault')?.textContent).toMatch(/nothing cloaked/i);
  });
});

describe('popup controls', () => {
  it('mode toggle flips auto/review and persists', async () => {
    skeleton();
    const storage = fakeStorage('auto');
    await renderPopup(document, { storage, onExport: () => {} });
    const btn = document.getElementById('dc-mode-toggle') as HTMLButtonElement;
    expect(btn.textContent).toMatch(/auto/i);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(await storage.getMode()).toBe('review');
    expect(btn.textContent).toMatch(/review/i);
  });
  it('export button hands valid audit JSON to onExport', async () => {
    skeleton();
    const onExport = vi.fn();
    await renderPopup(document, { storage: fakeStorage(), onExport });
    (document.getElementById('dc-export') as HTMLButtonElement).click();
    expect(onExport).toHaveBeenCalledTimes(1);
    const [json, filename] = onExport.mock.calls[0] as [string, string];
    expect(filename).toMatch(/datacloak-audit.*\.json/);
    const strip = (j: string): unknown[] =>
      (JSON.parse(j) as Record<string, unknown>[]).map(({ exportedAt: _t, ...rest }) => rest);
    expect(strip(json)).toEqual(strip(buildAuditJson(ENTRIES)));
    expect(JSON.parse(json)).toHaveLength(2);
  });
});
