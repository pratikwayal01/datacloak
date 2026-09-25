import { describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  countsFromResponse,
  renderPopup,
  resolveTheme,
  summarize,
  vaultEntriesFromSession,
  DEFAULT_FLAGS,
  DEFAULT_UI_SETTINGS,
  type Mode,
  type PopupDeps,
  type ThemePref,
  type UiSettings,
  type VaultEntry,
} from '../src/popup.js';
import type { BgRequest, BgResponse } from '../src/protocol.js';

const ENTRIES: VaultEntry[] = [
  { synthetic: 'alice.synth@example.net', original: 'alice.real@acme.com', category: 'EMAIL' },
  { synthetic: 'sk-synth-0001', original: 'sk-live-abcdef123456', category: 'API_KEY' },
];

const skeleton = (): void => {
  document.body.innerHTML = `
    <button id="dc-mode-toggle"><span id="dc-mode-label">Auto</span></button>
    <div class="tabs">
      <button class="tab active" data-tab="vault">Vault</button>
      <button class="tab" data-tab="settings">Settings</button>
      <button class="tab" data-tab="dev">Dev</button>
      <button class="tab" data-tab="about">About</button>
    </div>
    <div class="panel active" id="panel-vault">
      <div id="stat-total"></div><div id="stat-session"></div><div id="stat-types"></div>
      <span id="vault-badge"></span>
      <input id="dc-search" type="text">
      <button class="cat-btn active" data-cat="all">All</button>
      <button class="cat-btn" data-cat="email">Email</button>
      <div id="dc-vault"><div id="dc-empty" style="display:none"></div></div>
      <button id="dc-clear">Clear</button>
      <button id="dc-copy-all">Copy map</button>
      <button id="dc-export">Export</button>
    </div>
    <div class="panel" id="panel-settings">
      <input type="checkbox" id="s-autodetect"><input type="checkbox" id="s-clipboard">
      <input type="checkbox" id="s-network"><input type="checkbox" id="s-blur">
      <input type="checkbox" id="s-notif">
      <button class="risk-btn" data-risk="low">Low</button>
      <button class="risk-btn" data-risk="medium">Med</button>
      <button class="risk-btn" data-risk="high">High</button>
      <select id="s-style"><option value="realistic">Realistic</option><option value="token">Token</option></select>
      <input id="s-allowlist-input" type="text"><button id="s-allowlist-add">Add</button>
      <div id="allowlist-tags"></div>
      <div class="footer"><button id="s-reset">Reset</button><button id="s-save">Save</button></div>
    </div>
    <div class="panel" id="panel-dev">
      <button class="dev-tab active" data-dtab="console">Console</button>
      <button class="dev-tab" data-dtab="network">Network</button>
      <button class="dev-tab" data-dtab="storage">Storage</button>
      <button class="dev-tab" data-dtab="patterns">Patterns</button>
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
      <button id="dev-clear-log">Clear</button><button id="dev-copy-log">Copy</button>
    </div>
    <div class="panel" id="panel-about"></div>
    <div id="toast"></div>`;
};

interface FakeState {
  mode: Mode; theme: ThemePref; ui: UiSettings; vault: VaultEntry[];
  flags: typeof DEFAULT_FLAGS;
  oplog: { ts: number; tabId: number; kind: string; ms: number; count: number; categories: string[] }[];
  estimate: { usage: number; quota: number } | null;
  sent: BgRequest[]; copied: string[];
  downloaded: { content: string; filename: string; mime: string }[];
  sysCb: (() => void) | null;
}

const fakeDeps = (over: Partial<FakeState & { systemLight: boolean }> = {}): { deps: PopupDeps; state: FakeState } => {
  const state: FakeState = {
    mode: 'auto', theme: 'system', ui: { ...DEFAULT_UI_SETTINGS }, vault: [...ENTRIES],
    flags: { ...DEFAULT_FLAGS },
    oplog: [{ ts: 1, tabId: 7, kind: 'cloak', ms: 3, count: 2, categories: ['EMAIL'] }],
    estimate: { usage: 1024, quota: 102400 },
    sent: [], copied: [], downloaded: [], sysCb: null,
    ...over,
  };
  let systemLight = over.systemLight ?? false;
  void systemLight;
  const deps: PopupDeps = {
    send: async (req) => {
      state.sent.push(req);
      if (req.kind === 'stats') {
        return { counts: { cloaked: 2, restored: 0 }, byCategory: { EMAIL: 1 }, oplog: state.oplog };
      }
      if (req.kind === 'settings.get') return { flags: { ...state.flags } };
      if (req.kind === 'settings.set') { state.flags = { ...req.flags }; return { flags: { ...state.flags } }; };
      return { text: '', count: 0, categories: [] } as BgResponse;
    },
    getVault: async () => [...state.vault],
    clearVault: async () => { state.vault = []; },
    getMode: async () => state.mode,
    setMode: async (m) => { state.mode = m; },
    getTheme: async () => state.theme,
    setTheme: async (t) => { state.theme = t; },
    systemIsLight: () => over.systemLight ?? false,
    onSystemThemeChange: (cb) => { state.sysCb = cb; },
    getUiSettings: async () => ({ ...state.ui }),
    setUiSettings: async (s) => { state.ui = { ...s }; },
    estimateStorage: async () => state.estimate,
    listStorage: async () => [['dc-settings', '{}']] as [string, string][],
    download: (content, filename, mime) => { state.downloaded.push({ content, filename, mime }); },
    copy: async (t) => { state.copied.push(t); },
    version: '1.0.0',
  };
  return { deps, state };
};

const pressEnter = (input: HTMLInputElement, cmd: string): void => {
  input.value = cmd;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

describe('theme resolution', () => {
  it('system+light→light, system+dark→dark, explicit prefs win', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
  it('applyTheme sets documentElement dataset + select persists dc-theme', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    await renderPopup(document, deps);
    expect(document.documentElement.dataset.theme).toBe('dark');
    const sel = document.getElementById('s-theme') as HTMLSelectElement;
    expect(sel.value).toBe('system');
    sel.value = 'light';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(state.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('system pref follows OS changes via listener', async () => {
    skeleton();
    const f = fakeDeps({ systemLight: false });
    await renderPopup(document, f.deps);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(f.state.sysCb).not.toBeNull();
    skeleton();
    const f2 = fakeDeps({ systemLight: true });
    await renderPopup(document, f2.deps);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('popup tabs + vault', () => {
  it('tabs switch panels', async () => {
    skeleton();
    const { deps } = fakeDeps();
    await renderPopup(document, deps);
    (document.querySelector('.tab[data-tab="settings"]') as HTMLElement).click();
    expect(document.getElementById('panel-settings')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('panel-vault')?.classList.contains('active')).toBe(false);
  });
  it('rows render chips; search + category filter narrow them', async () => {
    skeleton();
    const { deps } = fakeDeps();
    await renderPopup(document, deps);
    expect(document.querySelectorAll('#dc-vault .vault-row')).toHaveLength(2);
    expect(document.querySelector('.cat-chip')?.textContent).toBe('email');
    const search = document.getElementById('dc-search') as HTMLInputElement;
    search.value = 'sk-synth';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('#dc-vault .vault-row')).toHaveLength(1);
    expect(document.getElementById('stat-total')?.textContent).toBe('2');
    expect(document.getElementById('vault-badge')?.textContent).toBe('2');
  });
  it('copy buttons copy the synthetic, copy-map copies JSON map', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    await renderPopup(document, deps);
    (document.querySelector('#dc-vault .row-actions .icon-btn:last-child') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.copied[0]).toBe('alice.synth@example.net');
    (document.getElementById('dc-copy-all') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const map = JSON.parse(state.copied[1]) as Record<string, string>;
    expect(map['alice.synth@example.net']).toBe('alice.real@acme.com');
  });
  it('export downloads CSV via exporter integration', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    await renderPopup(document, deps);
    (document.getElementById('dc-export') as HTMLButtonElement).click();
    expect(state.downloaded).toHaveLength(1);
    const [dl] = state.downloaded;
    expect(dl.mime).toBe('text/csv');
    expect(dl.filename).toMatch(/datacloak-vault-.*\.csv/);
    expect(dl.content.split('\n')[0]).toBe('synthetic,original,category');
    expect(dl.content).toContain('alice.synth@example.net');
  });
  it('blur is default-on: peek reveals original blurred in row output only', async () => {
    skeleton();
    const { deps } = fakeDeps();
    await renderPopup(document, deps);
    expect((document.getElementById('s-blur') as HTMLInputElement).checked).toBe(true);
    // originals hidden before reveal
    expect(document.getElementById('dc-vault')?.textContent).not.toContain('alice.real@acme.com');
    (document.querySelector('#dc-vault .row-actions .icon-btn') as HTMLElement).click();
    const rowText = document.querySelector('#dc-vault .vault-row .synth-text')?.textContent ?? '';
    expect(rowText).toContain('alice.real@acme.com');
    expect(document.querySelector('#dc-vault .vault-row .blurred')).not.toBeNull();
  });
  it('console never prints originals', async () => {
    skeleton();
    const { deps } = fakeDeps();
    await renderPopup(document, deps);
    const input = document.getElementById('console-input') as HTMLInputElement;
    for (const cmd of ['help', 'vault.list', 'settings.dump', 'version', 'bogus']) pressEnter(input, cmd);
    const out = document.getElementById('console-out')?.textContent ?? '';
    expect(out).not.toContain('alice.real@acme.com');
    expect(out).not.toContain('sk-live-abcdef123456');
    expect(out).toMatch(/vault: 2 entries/);
    expect(out).toMatch(/unknown command/);
  });
  it('mode toggle flips auto/off and persists', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    await renderPopup(document, deps);
    (document.getElementById('dc-mode-toggle') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.mode).toBe('off');
    expect(document.getElementById('dc-mode-label')?.textContent).toBe('Off');
  });
  it('skips malformed vault:* keys, renders good rows, no throw', () => {
    const got = vaultEntriesFromSession({
      'vault:1': { vault: [['s1@x.net', 'o1@acme.com', 'EMAIL'], ['bad'], [1, 2, 3], 'nope', null] },
      'vault:2': 'garbage-string',
      other: { vault: [['s2@x.net', 'o2@acme.com', 'EMAIL']] },
    });
    expect(got).toEqual([{ synthetic: 's1@x.net', original: 'o1@acme.com', category: 'EMAIL' }]);
    expect(summarize(got)).toEqual({ count: 1, categories: ['EMAIL'] });
    expect(countsFromResponse({ text: 'plain', restored: 0 })).toEqual({ count: 0, categories: [] });
  });
});

describe('settings + dev panels', () => {
  it('pattern toggles call background settings.set', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    await renderPopup(document, deps);
    const first = document.querySelector('#patterns-list input') as HTMLInputElement;
    expect(first.checked).toBe(true);
    first.checked = false;
    first.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(state.sent.some((r) => r.kind === 'settings.set')).toBe(true);
    expect(state.flags.secrets).toBe(false);
  });
  it('sensitivity + allowlist + save persist ui settings', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    await renderPopup(document, deps);
    (document.querySelector('.risk-btn[data-risk="high"]') as HTMLElement).click();
    const input = document.getElementById('s-allowlist-input') as HTMLInputElement;
    input.value = 'example.com';
    (document.getElementById('s-allowlist-add') as HTMLButtonElement).click();
    (document.getElementById('s-save') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.ui.sensitivity).toBe('high');
    expect(state.ui.allowlist).toContain('example.com');
  });
  it('network panel renders oplog with honest label; empty state otherwise', async () => {
    skeleton();
    const { deps } = fakeDeps();
    await renderPopup(document, deps);
    const list = document.getElementById('network-list')?.textContent ?? '';
    expect(list).toContain('Background operation log');
    expect(list).toContain('CLOAK');
    expect(list).toContain('3ms');

    skeleton();
    const empty = fakeDeps({ oplog: [] });
    await renderPopup(document, empty.deps);
    expect(document.getElementById('network-list')?.textContent).toContain('No operations recorded yet.');
  });
  it('storage estimate failure shows n/a, success shows bytes', async () => {
    skeleton();
    await renderPopup(document, fakeDeps().deps);
    expect(document.getElementById('storage-pct')?.textContent).toBe('1%');
    skeleton();
    await renderPopup(document, fakeDeps({ estimate: null }).deps);
    expect(document.getElementById('storage-pct')?.textContent).toBe('n/a');
    expect(document.getElementById('storage-used')?.textContent).toBe('n/a');
  });
  it('reset restores defaults and repaints every control, no duplicate listeners', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    state.ui = { ...state.ui, clipboard: true, network: false, blur: false, notif: false, sensitivity: 'high', style: 'token', allowlist: ['x.io'] };
    state.theme = 'dark';
    await renderPopup(document, deps);
    expect((document.getElementById('s-clipboard') as HTMLInputElement).checked).toBe(true);
    (document.getElementById('s-reset') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    for (const [id, val] of [['s-autodetect', true], ['s-clipboard', false], ['s-network', true], ['s-blur', true], ['s-notif', true]] as const) {
      expect((document.getElementById(id) as HTMLInputElement).checked).toBe(val);
    }
    expect((document.getElementById('s-style') as HTMLSelectElement).value).toBe('realistic');
    expect((document.getElementById('s-theme') as HTMLSelectElement).value).toBe('system');
    expect(document.querySelector('.risk-btn[data-risk="low"]')?.className).toContain('active-low');
    expect(document.getElementById('allowlist-tags')?.children).toHaveLength(0);
    expect(state.ui).toEqual({ autodetect: true, clipboard: false, network: true, blur: true, notif: true, sensitivity: 'low', style: 'realistic', allowlist: [] });
    // toggle once after reset → single state flip (no stacked listeners)
    const blur = document.getElementById('s-blur') as HTMLInputElement;
    blur.checked = false;
    blur.dispatchEvent(new Event('change', { bubbles: true }));
    (document.getElementById('s-save') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.ui.blur).toBe(false);
  });
  it('clear vault empties rows + badge', async () => {
    skeleton();
    const { deps, state } = fakeDeps();
    await renderPopup(document, deps);
    (document.getElementById('dc-clear') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.vault).toEqual([]);
    expect(document.getElementById('vault-badge')?.textContent).toBe('0');
  });
});
