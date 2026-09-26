import { describe, expect, it } from 'vitest';
import { literalPattern, renderPopup, type PopupDeps } from '../src/popup.js';
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
      <textarea id="c-name"></textarea><textarea id="c-pattern"></textarea>
      <input id="c-category" type="text">
      <select id="c-type"><option value="pii">pii</option><option value="secret">secret</option></select>
      <input id="c-synth" type="text">
      <button id="c-add" type="button">Add</button>
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
      try { new RegExp(req.patterns[0]?.pattern ?? ''); } catch { return { patterns: store.patterns, error: 'not a valid regex' }; }
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
  getUiSettings: async () => ({ autodetect: true, clipboard: false, network: true, blur: true, notif: true, sensitivity: 'low', style: 'realistic', allowlist: [] }),
  setUiSettings: async () => {},
  estimateStorage: async () => null,
  listStorage: async () => [],
  download: () => {},
  copy: async () => {},
  version: '1.0.0',
  ...over,
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('popup custom entities', () => {
  it('lists saved patterns', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Employee ID', pattern: 'EMP-[0-9]{6}', category: 'EMPLOYEE_ID', type: 'pii' as const }] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    expect(document.getElementById('custom-list')?.textContent).toContain('Employee ID');
  });
  it('add saves and clears inputs', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLInputElement).value = 'Ticket';
    (document.getElementById('c-pattern') as HTMLInputElement).value = 'TCK-[0-9]+';
    (document.getElementById('c-category') as HTMLInputElement).value = 'TICKET';
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(store.patterns).toHaveLength(1);
    expect(store.patterns[0].category).toBe('TICKET');
    expect((document.getElementById('c-name') as HTMLInputElement).value).toBe('');
    expect(document.getElementById('custom-list')?.textContent).toContain('Ticket');
  });
  it('invalid regex surfaces error toast', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLInputElement).value = 'Bad';
    (document.getElementById('c-pattern') as HTMLInputElement).value = '([a-z';
    (document.getElementById('c-category') as HTMLInputElement).value = 'X';
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(store.patterns).toHaveLength(0);
    expect(document.getElementById('toast')?.textContent).toMatch(/regex/);
  });
});

describe('popup custom entities save paths', () => {
  it('Enter in a single-line custom input submits', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLTextAreaElement).value = 'Ticket';
    (document.getElementById('c-pattern') as HTMLTextAreaElement).value = 'TCK-[0-9]+';
    (document.getElementById('c-category') as HTMLInputElement).value = 'TICKET';
    document.getElementById('c-synth')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(store.patterns).toHaveLength(1);
  });
  it('Ctrl+Enter submits from a textarea, plain Enter does not', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLTextAreaElement).value = 'Ticket';
    document.getElementById('c-name')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(store.patterns).toHaveLength(0);
    const ctrl = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(ctrl, 'ctrlKey', { value: true });
    document.getElementById('c-name')?.dispatchEvent(ctrl);
    await flush();
    expect(store.patterns).toHaveLength(1);
  });
  it('footer Save flushes a filled custom row', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLInputElement).value = 'Ticket';
    (document.getElementById('c-pattern') as HTMLInputElement).value = 'TCK-[0-9]+';
    (document.getElementById('c-category') as HTMLInputElement).value = 'TICKET';
    document.getElementById('s-save')?.dispatchEvent(new Event('click'));
    await flush();
    expect(store.patterns).toHaveLength(1);
  });
});

describe('popup custom entity remove', () => {
  it('remove asks same-page confirm, then deletes', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Ramesh', pattern: 'ramesh', category: 'PERSON_NAME', type: 'pii' as const }] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    const btn = [...document.querySelectorAll('#custom-list button')].find((b) => b.textContent === 'Remove') as HTMLButtonElement;
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

describe('popup custom validation', () => {
  it('empty value and regex rings both and saves nothing', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-category') as HTMLInputElement).value = 'X';
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(document.getElementById('c-name')?.classList.contains('invalid')).toBe(true);
    expect(document.getElementById('c-pattern')?.classList.contains('invalid')).toBe(true);
    expect(document.getElementById('toast')?.textContent).toMatch(/value or a regex/);
    expect(store.patterns).toHaveLength(0);
  });

  it('bare value saves as a case-insensitive literal', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLTextAreaElement).value = 'Ramesh';
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(store.patterns).toHaveLength(1);
    const [p] = store.patterns;
    expect(p.literal).toBe(true);
    expect(p.category).toBe('RAMESH');
    for (const v of ['Ramesh', 'ramesh', 'RAMESH', 'rAmEsH']) {
      expect(new RegExp(`^${p.pattern}$`).test(v)).toBe(true);
    }
    expect(document.getElementById('toast')?.textContent).toMatch(/Ramesh added/);
    // Row shows the value as typed, not the compiled matcher.
    expect(document.querySelector('.site-desc')?.textContent).toBe('Ramesh · RAMESH');
  });

  it('literalPattern escapes specials and expands letter case', () => {
    expect(literalPattern('EMP-001234')).toBe('[Ee][Mm][Pp]-001234');
    const re = new RegExp(`^${literalPattern('a.c')}$`);
    expect(re.test('A.C')).toBe(true);
    expect(re.test('AxC')).toBe(false);
  });

  it('one value per line becomes one entry each', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLInputElement).value = 'Ramesh\nEMP-001234';
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(store.patterns).toHaveLength(2);
    expect(store.patterns.map((p) => p.name)).toEqual(['Ramesh', 'EMP-001234']);
    expect(document.getElementById('toast')?.textContent).toMatch(/2 values added/);
  });

  it('regex mode labels the entry and escapes nothing', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLInputElement).value = 'Employee ID';
    (document.getElementById('c-pattern') as HTMLInputElement).value = 'EMP-[0-9]{6}';
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(store.patterns).toEqual([
      expect.objectContaining({ name: 'Employee ID', pattern: 'EMP-[0-9]{6}', category: 'EMPLOYEE_ID' }),
    ]);
  });

  it('category stays sticky for batch entry', async () => {
    skeleton();
    const store = { patterns: [] as CustomPattern[] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    (document.getElementById('c-name') as HTMLInputElement).value = 'Ramesh';
    (document.getElementById('c-category') as HTMLInputElement).value = 'PERSON_NAME';
    document.getElementById('c-add')?.dispatchEvent(new Event('click'));
    await flush();
    expect(store.patterns[0].category).toBe('PERSON_NAME');
    expect((document.getElementById('c-category') as HTMLInputElement).value).toBe('PERSON_NAME');
    expect((document.getElementById('c-name') as HTMLInputElement).value).toBe('');
  });

  it('saved rows show pattern, fake and category', async () => {
    skeleton();
    const store = { patterns: [{ name: 'Ramesh', pattern: 'ramesh', category: 'PERSON_NAME', type: 'pii' as const, synthesizer: 'X-{{string.numeric(4)}}' }] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    expect(document.querySelector('.site-desc')?.textContent).toBe('ramesh → X-{{string.numeric(4)}} · PERSON_NAME');
  });
});
