import { describe, expect, it, vi } from 'vitest';
import { renderPopup, upsertCustomSite, type PopupDeps } from '../src/popup.js';
import { toOriginPattern } from '../src/site-store.js';
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
      <div class="setting-desc" id="sites-active">This site: (unknown)</div>
      <div id="sites-list"></div>
      <div class="allowlist-wrap">
        <div class="allowlist-input-row">
          <input class="allowlist-input" id="s-sites-input" type="text" placeholder="duck.ai or http://nas:3000">
          <button class="btn-sm accent" id="s-sites-add" type="button">Add</button>
        </div>
      </div>
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
  it('works with no sites backend (mock-safe)', async () => {    skeleton();
    const { deps } = fakeDeps({ getSites: undefined, addSite: undefined, toggleSite: undefined, removeSite: undefined });
    await expect(renderPopup(document, deps)).resolves.toBeUndefined();
  });
  it('add via static input creates custom site + appears in list', async () => {
    skeleton();
    const added: string[] = [];
    const base = [
      { host: 'claude.ai', enabled: true, builtin: true, active: true },
    ] as { host: string; enabled: boolean; builtin: boolean; active: boolean }[];
    const { deps, calls } = fakeDeps({
      getSites: async () => ({
        sites: [...base, ...added.map((host) => ({ host, enabled: true, builtin: false, active: false }))],
        activeHost: 'claude.ai',
      }),
      addSite: async (input: string) => { calls.add.push(input); added.push(input); return { ok: true }; },
    });
    await renderPopup(document, deps);
    const input = document.getElementById('s-sites-input') as HTMLInputElement;
    input.value = 'newsite.example';
    (document.getElementById('s-sites-add') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.add).toEqual(['newsite.example']);
    expect(document.getElementById('sites-list')?.textContent).toContain('newsite.example');
  });
  it('allowlist entries migrate into sites as disabled unique rows', async () => {
    skeleton();
    const { deps } = fakeDeps({
      getUiSettings: async () => ({
        autodetect: true, clipboard: false, network: true, blur: true, notif: true,
        sensitivity: 'low', style: 'realistic',
        allowlist: ['example.com', 'example.com ', 'claude.ai'],
      }),
    });
    await renderPopup(document, deps);
    const list = document.getElementById('sites-list') as HTMLElement;
    const rows = [...list.querySelectorAll('.setting-row')];
    const migrated = rows.filter((r) => r.textContent?.includes('example.com'));
    expect(migrated).toHaveLength(1);
    expect((migrated[0].querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    // builtin overlap stays a single row
    expect(rows.filter((r) => r.textContent?.includes('claude.ai'))).toHaveLength(1);
  });
  it('exactly one sites add-input row in DOM (no JS duplicate)', async () => {
    skeleton();
    const { deps } = fakeDeps();
    await renderPopup(document, deps);
    expect(document.querySelectorAll('#s-sites-add')).toHaveLength(1);
    expect(document.querySelectorAll('#s-sites-input')).toHaveLength(1);
  });
  it('toggle fallback preserves scheme through to the permission pattern', () => {
    const user = upsertCustomSite({ custom: [], disabled: [] }, 'example.com:8443', true, 'https');
    expect(user.custom).toEqual([{ host: 'example.com:8443', enabled: true, scheme: 'https' }]);
    const [entry] = user.custom;
    expect(toOriginPattern(entry.host, entry.scheme)).toBe('https://example.com:8443/*');
    // No scheme → colon rule still applies, nothing stored.
    const bare = upsertCustomSite({ custom: [], disabled: [] }, 'nas:3000', true);
    expect(bare.custom).toEqual([{ host: 'nas:3000', enabled: true }]);
    expect(toOriginPattern(bare.custom[0].host, bare.custom[0].scheme)).toBe('http://nas:3000/*');
  });
});
