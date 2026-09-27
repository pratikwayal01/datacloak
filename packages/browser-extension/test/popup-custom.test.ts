import { describe, expect, it, vi } from 'vitest';
import { renderPopup, type PopupDeps } from '../src/popup.js';
import type { BgResponse } from '../src/protocol.js';
import type { CustomPattern } from '@pratikw/detect';

const skeleton = (): void => {
  document.body.innerHTML = `
    <button id="dc-mode-toggle"><span id="dc-mode-label">Auto</span></button>
    <div class="panel active" id="panel-vault">
      <div id="stat-total"></div><div id="stat-session"></div><div id="stat-types"></div>
      <span id="vault-badge"></span>
      <input id="dc-search" type="text">
      <button class="cat-btn active" data-cat="all">All</button>
      <div id="dc-vault"><div id="dc-empty" style="display:none"></div></div>
      <button id="dc-clear">Clear</button>
      <button id="dc-copy-all">Copy map</button>
      <button id="dc-export">Export</button>
    </div>
    <div class="panel" id="panel-settings">
      <div class="setting-desc" id="sites-active"></div>
      <div id="sites-list"></div>
      <div id="custom-list"></div>
      <button id="c-add" type="button">+ Add entity</button>
      <div class="footer"><button id="s-fullpage">Full</button><button id="s-reset">Reset</button><button id="s-save">Save</button></div>
    </div>
    <div class="panel" id="panel-dev">
      <div class="dev-panel-inner active" id="dpanel-console">
        <div id="console-out"></div>
        <input id="console-input" type="text">
      </div>
      <div class="dev-panel-inner" id="dpanel-network"><div id="network-list"></div></div>
      <div class="dev-panel-inner" id="dpanel-storage">
        <span id="storage-pct"></span><div id="storage-bar"></div>
        <span id="storage-used"></span><span id="storage-quota"></span>
        <table id="storage-table"><tbody></tbody></table>
      </div>
      <div class="dev-panel-inner" id="dpanel-patterns"><div id="patterns-list"></div></div>
    </div>
    <div class="panel" id="panel-about"></div>
    <div id="toast"></div>`;
};

const fakeDeps = (store: { patterns: CustomPattern[] }, over: Partial<PopupDeps> = {}): PopupDeps => ({
  send: async (req) => {
    if (req.kind === 'stats') return { counts: { cloaked: 0, restored: 0 }, byCategory: {}, oplog: [] };
    if (req.kind === 'settings.get') return { flags: { secrets: true, envVars: true, pii: true, entropy: true } };
    if (req.kind === 'patterns.get') return { patterns: store.patterns };
    if (req.kind === 'patterns.set') {
      for (const p of req.patterns) {
        if (p.kind) continue;
        try { new RegExp(p.pattern ?? ''); } catch { return { patterns: store.patterns, error: 'not a valid regex' }; }
      }
      store.patterns = req.patterns;
      return { patterns: store.patterns };
    }
    return { text: '', count: 0, categories: [] } as BgResponse;
  },
  getVault: async () => [],
  clearVault: async () => {},
  getMode: async () => 'auto',
  setMode: async () => {},
  getTheme: async () => 'system',
  setTheme: async () => {},
  systemIsLight: () => false,
  onSystemThemeChange: () => {},
  getUiSettings: async () => ({ autodetect: true, clipboard: false, network: true, blur: true, notif: true, review: false, pageBadge: true, sensitivity: 'low', style: 'realistic', allowlist: [] }),
  setUiSettings: async () => {},
  estimateStorage: async () => null,
  listStorage: async () => [],
  download: () => {},
  copy: () => {},
  version: '1.0.0',
  ...over,
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const rows = (): { input: HTMLInputElement; sel: HTMLSelectElement }[] =>
  [...document.querySelectorAll('#custom-list .allowlist-input-row')].map((w) => ({
    input: w.querySelector('input') as HTMLInputElement,
    sel: w.querySelector('select') as HTMLSelectElement,
  }));

describe('popup custom entity rows', () => {
  it('paints stored kind entries as value+type rows', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Ramesh', pattern: '[Rr][Aa][Mm][Ee][Ss][Hh]', category: 'PERSON_NAME', type: 'pii' as const, kind: 'name' as const }] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0].input.value).toBe('Ramesh');
    expect(r[0].sel.value).toBe('name');
  });

  it('add appends an empty row defaulting to Name', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    expect(document.getElementById('custom-list')?.textContent).toContain('No custom entities yet');
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0].input.value).toBe('');
    expect(r[0].sel.value).toBe('name');
  });

  it('filling a row saves value+kind', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    const [r] = rows();
    r.input.value = 'EMP-001234';
    r.input.dispatchEvent(new Event('change'));
    r.sel.value = 'employee_id';
    r.sel.dispatchEvent(new Event('change'));
    await flush();
    expect(store.patterns).toEqual([{ name: 'EMP-001234', kind: 'employee_id' }]);
  });

  it('clearing a row deletes it without persisting empties', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Ramesh', pattern: 'x', category: 'PERSON_NAME', type: 'pii' as const, kind: 'name' as const }] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    expect(rows()).toHaveLength(1);
    const [r] = rows();
    r.input.value = '';
    r.input.dispatchEvent(new Event('change'));
    await flush();
    expect(rows()).toHaveLength(0);
    expect(store.patterns).toEqual([]);
  });

  it('× asks same-page confirm, then removes', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Ramesh', pattern: 'x', category: 'PERSON_NAME', type: 'pii' as const, kind: 'name' as const }] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    const btn = document.querySelector('#custom-list button[aria-label="Remove Ramesh"]') as HTMLButtonElement;
    btn.click();
    await flush();
    expect(store.patterns).toHaveLength(1);
    expect(document.querySelector('.dc-confirm')?.textContent).toContain('Ramesh');
    (document.querySelectorAll('.dc-confirm button')[1] as HTMLButtonElement).click();
    await flush();
    expect(store.patterns).toHaveLength(0);
    expect(document.getElementById('custom-list')?.textContent).toContain('No custom entities yet');
  });
});

describe('popup custom migration', () => {
  it('legacy literal entries upgrade to name kind', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Ramesh', pattern: '[Rr][Aa][Mm][Ee][Ss][Hh]', category: 'RAMESH', type: 'pii' as const, literal: true }] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    expect(store.patterns).toEqual([{ name: 'Ramesh', kind: 'name' }]);
    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0].sel.value).toBe('name');
  });

  it('legacy regex entries drop with a console warn', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Ticket', pattern: 'TCK-[0-9]+', category: 'TICKET', type: 'pii' as const }] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await renderPopup(document, fakeDeps(store));
      await flush();
      expect(store.patterns).toEqual([]);
      expect(document.getElementById('custom-list')?.textContent).toContain('No custom entities yet');
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dropped legacy custom patterns.*Ticket/));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('popup full page', () => {
  it('footer button opens full-page settings', async () => {
    skeleton();
    let opened = 0;
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store, { openFullPage: async () => { opened += 1; } }));
    await flush();
    document.getElementById('s-fullpage')?.dispatchEvent(new Event('click'));
    await flush();
    expect(opened).toBe(1);
  });
});
