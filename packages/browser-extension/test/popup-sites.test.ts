import { describe, expect, it, vi } from 'vitest';
import { renderPopup, type PopupDeps } from '../src/popup.js';
import type { BgResponse } from '../src/protocol.js';

const skeleton = (): void => {
  document.body.innerHTML = `
    <button id="dc-mode-toggle"><span id="dc-mode-label">Auto</span></button>
    <div class="tabs">
      <button class="tab active" data-tab="vault">Vault</button>
      <button class="tab" data-tab="settings">Settings</button>
    </div>
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

const fakeDeps = (over: Partial<PopupDeps> = {}): { deps: PopupDeps; calls: { toggle: [string, boolean][]; add: string[]; remove: string[] } } => {
  const calls: { toggle: [string, boolean][]; add: string[]; remove: string[] } = { toggle: [], add: [], remove: [] };
  const deps: PopupDeps = {
    send: async (req) => {
      if (req.kind === 'stats') return { counts: { cloaked: 0, restored: 0 }, byCategory: {}, oplog: [] };
      if (req.kind === 'settings.get') return { flags: { secrets: true, envVars: true, pii: true, entropy: true } };
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
    getSites: async () => ({
      sites: [
        { host: 'claude.ai', enabled: true, builtin: true, active: true },
        { host: 'duck.ai', enabled: false, builtin: false, active: false },
      ],
      activeHost: 'claude.ai',
    }),
    addSite: async (input: string) => { calls.add.push(input); return { ok: true }; },
    toggleSite: async (host: string, enabled: boolean) => { calls.toggle.push([host, enabled]); return true; },
    removeSite: async (host: string) => { calls.remove.push(host); },
    ...over,
  };
  return { deps, calls };
};

describe('popup sites section', () => {
  it('shows active-origin state', async () => {
    skeleton();
    const { deps } = fakeDeps();
    await renderPopup(document, deps);
    const section = document.getElementById('sites-list')?.textContent ?? '';
    expect(section).toContain('claude.ai');
    expect(document.getElementById('sites-active')?.textContent).toContain('claude.ai');
  });
  it('toggle calls through to deps', async () => {
    skeleton();
    const { deps, calls } = fakeDeps();
    await renderPopup(document, deps);
    const toggle = document.querySelector('#sites-list input[type="checkbox"]') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.toggle).toEqual([['claude.ai', false]]);
  });
  it('add + remove call through to deps', async () => {
    skeleton();
    const { deps, calls } = fakeDeps();
    await renderPopup(document, deps);
    const input = document.getElementById('s-sites-input') as HTMLInputElement;
    input.value = 'duck.ai';
    (document.getElementById('s-sites-add') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.add).toEqual(['duck.ai']);
    const rm = document.querySelector('#sites-list button[data-remove]') as HTMLButtonElement;
    rm.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.remove.length).toBe(1);
  });
  it('works with no sites backend (mock-safe)', async () => {
    skeleton();
    const { deps } = fakeDeps({ getSites: undefined, addSite: undefined, toggleSite: undefined, removeSite: undefined });
    await expect(renderPopup(document, deps)).resolves.toBeUndefined();
  });
});
