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
      <div id="s-profile-wrap"><select id="s-profile"></select><button id="s-profile-del">×</button><input id="s-profile-name" type="text"><button id="s-profile-add" type="button">Add</button></div>
      <div id="patterns-list"></div>
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
    if (req.kind === 'stats') return { counts: { cloaked: 0, restored: 0 }, byCategory: {}, oplog: [], lifetime: { cloaked: 0, restored: 0 } };
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
  getUiSettings: async () => ({ autodetect: true, clipboard: false, network: true, blur: true, notif: true, review: false, pageBadge: true, tourSeen: false, sensitivity: 'low', style: 'realistic', allowlist: [] }),
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

describe('popup profiles', () => {
  interface Prof { id: string; name: string; rows: CustomPattern[]; secrets: boolean }
  const profDeps = (state: { activeId: string; profiles: Prof[] }, store: { patterns: CustomPattern[] }) => {
    const base = fakeDeps(store);
    const active = (): Prof => state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0];
    const shape = () => ({ activeId: state.activeId, profiles: state.profiles.map((p) => ({ id: p.id, name: p.name, patterns: p.rows.length })) });
    return {
      ...base,
      send: (async (req: Parameters<PopupDeps['send']>[0]) => {
        if (req.kind === 'profiles.get') return shape();
        if (req.kind === 'profiles.add') {
          if (state.profiles.some((p) => p.name === req.name)) return { ...shape(), error: 'exists' };
          const id = `p${state.profiles.length + 1}`;
          state.profiles.push({ id, name: req.name, rows: [], secrets: true });
          state.activeId = id;
          return shape();
        }
        if (req.kind === 'profiles.switch') {
          if (!state.profiles.some((p) => p.id === req.id)) return { ...shape(), error: 'Unknown' };
          state.activeId = req.id;
          return shape();
        }
        if (req.kind === 'profiles.delete') {
          if (state.profiles.length <= 1) return { ...shape(), error: 'last profile' };
          state.profiles = state.profiles.filter((p) => p.id !== req.id);
          if (state.activeId === req.id) state.activeId = state.profiles[0].id;
          return shape();
        }
        if (req.kind === 'patterns.get') return { patterns: active().rows };
        if (req.kind === 'patterns.set') {
          active().rows = req.patterns;
          return { patterns: active().rows };
        }
        if (req.kind === 'settings.get') return { flags: { secrets: active().secrets, envVars: true, pii: true, entropy: true } };
        return base.send(req);
      }) as PopupDeps['send'],
    } as PopupDeps;
  };
  const sel = (): HTMLSelectElement => document.getElementById('s-profile') as HTMLSelectElement;
  const rowValues = (): string[] =>
    [...document.querySelectorAll('#custom-list input')].map((i) => (i as HTMLInputElement).value);

  it('paints profiles with counts and switches reload rows', async () => {
    skeleton();
    const state = {
      activeId: 'p1',
      profiles: [
        { id: 'p1', name: 'Default', rows: [{ name: 'Ramesh', kind: 'name' }] as CustomPattern[], secrets: true },
        { id: 'p2', name: 'Work', rows: [] as CustomPattern[], secrets: false },
      ],
    };
    await renderPopup(document, profDeps(state, { patterns: [] }));
    await flush();
    expect(sel().options.length).toBe(2);
    expect(sel().selectedOptions[0].textContent).toBe('Default (1)');
    expect(rowValues()).toEqual(['Ramesh']);
    sel().value = 'p2';
    sel().dispatchEvent(new Event('change'));
    await flush();
    expect(rowValues()).toEqual([]);
    expect(document.getElementById('toast')?.textContent).toMatch(/switched/);
  });

  it('add creates and selects; delete confirms and guards the last', async () => {
    skeleton();
    const state = {
      activeId: 'p1',
      profiles: [{ id: 'p1', name: 'Default', rows: [] as CustomPattern[], secrets: true }],
    };
    await renderPopup(document, profDeps(state, { patterns: [] }));
    await flush();
    (document.getElementById('s-profile-name') as HTMLInputElement).value = 'Client X';
    document.getElementById('s-profile-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(sel().selectedOptions[0].textContent).toBe('Client X (0)');
    expect(document.getElementById('toast')?.textContent).toMatch(/added/);
    document.getElementById('s-profile-del')?.click();
    await flush();
    expect(document.querySelector('.dc-confirm')?.textContent).toContain('Client X');
    (document.querySelectorAll('.dc-confirm button')[1] as HTMLButtonElement).click();
    await flush();
    expect(sel().options.length).toBe(1);
    document.getElementById('s-profile-del')?.click();
    await flush();
    (document.querySelectorAll('.dc-confirm button')[1] as HTMLButtonElement).click();
    await flush();
    expect(document.getElementById('toast')?.textContent).toMatch(/last profile/);
    expect(sel().options.length).toBe(1);
  });
});
