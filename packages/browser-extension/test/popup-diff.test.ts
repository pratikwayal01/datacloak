import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPopup, type PopupDeps } from '../src/popup.js';
import type { BgResponse } from '../src/protocol.js';
import type { CustomPattern, VaultEntry } from '@pratikw/detect';

const skeleton = (withDiff: boolean): void => {
  document.body.innerHTML = `
    <button id="dc-mode-toggle"><span id="dc-mode-label">Auto</span></button>
    <div id="stat-total"></div><div id="stat-session"></div><div id="stat-types"></div>
    <span id="vault-badge"></span>
    <input id="dc-search" type="text">
    <div id="dc-vault"><div id="dc-empty" style="display:none"></div></div>
    <button id="dc-clear">Clear</button>
    <button id="dc-copy-all">Copy map</button>
    <button id="dc-export">Export</button>
    <div id="console-out"></div><input id="console-input" type="text">
    <div id="network-list"></div>
    <span id="storage-pct"></span><div id="storage-bar"></div>
    <span id="storage-used"></span><span id="storage-quota"></span>
    <table id="storage-table"><tbody></tbody></table>
    <div id="patterns-list"></div>
    <div id="custom-list"></div>
    <button class="tab active" data-tab="vault" type="button">V</button>
    <button class="tab" data-tab="settings" type="button">S</button>
    <div class="panel active" id="panel-vault"></div>
    <div class="panel" id="panel-settings"></div>
    <button id="fp-fold" type="button" style="display:none">fold</button>
    <div class="fp-brand" id="fp-logo" title="Fold sidebar" role="button" tabindex="0"><svg></svg><div><div class="fp-name">DataCloak</div></div></div>
    ${withDiff ? '<div id="diff-wrap"></div>' : ''}
    <div id="toast"></div>`;
};

interface Store { patterns: CustomPattern[]; record: unknown; sets: unknown[][]; vault?: VaultEntry[]; copied?: string[] }

const fakeDeps = (store: Store): PopupDeps => ({
  send: async (req) => {
    if (req.kind === 'stats') return { counts: { cloaked: 0, restored: 0 }, byCategory: {}, oplog: [] };
    if (req.kind === 'settings.get') return { flags: { secrets: true, envVars: true, pii: true, entropy: true } };
    if (req.kind === 'patterns.get') return { patterns: store.patterns };
    if (req.kind === 'patterns.set') {
      store.sets.push(req.patterns);
      store.patterns = req.patterns;
      return { patterns: store.patterns };
    }
    if (req.kind === 'lastCloak.get') return { record: store.record } as unknown as BgResponse;
    return { text: '', count: 0, categories: [] } as BgResponse;
  },
  getVault: async () => [...(store.vault ?? [])],
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
  copy: async (t: string) => { (store.copied ??= []).push(t); },
  version: '1.0.0',
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

const record = {
  original: 'mail ramesh end',
  cloaked: 'mail XQZTMB end',
  subs: [{ original: 'ramesh', synthetic: 'XQZTMB', category: 'PERSON_NAME', start: 5, end: 11 }],
  ts: 1,
};

describe('popup diff view', () => {
  it('fullPage renders side-by-side panels with marks', async () => {
    skeleton(true);
    const store: Store = { patterns: [], record, sets: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    const panels = document.querySelectorAll('#diff-wrap .diff-panel');
    expect(panels).toHaveLength(2);
    expect(panels[0].querySelector('mark')?.textContent).toBe('ramesh');
    expect(panels[1].querySelector('mark')?.textContent).toBe('XQZTMB');
    expect(document.querySelector('#diff-wrap .diff-sub')?.textContent).toContain('PERSON_NAME');
  });

  it('per-sub Add merges into stored rows', async () => {
    skeleton(true);
    const store: Store = { patterns: [{ name: 'EMP-1', kind: 'employee_id' } as CustomPattern], record, sets: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    (document.querySelector('#diff-wrap .diff-sub button') as HTMLButtonElement).click();
    await flush();
    expect(store.sets).toHaveLength(1);
    const sent = store.sets[0] as { name: string }[];
    expect(sent.map((p) => p.name)).toEqual(['EMP-1', 'ramesh']);
    expect(document.getElementById('toast')?.textContent).toMatch(/added to custom entities/);
  });

  it('empty state on null record', async () => {
    skeleton(true);
    const store: Store = { patterns: [], record: null, sets: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    expect(document.getElementById('diff-wrap')?.textContent).toContain('Nothing cloaked in this tab yet');
    expect(document.querySelectorAll('#diff-wrap .diff-panel')).toHaveLength(0);
  });

  it('popup mode leaves diff-wrap untouched', async () => {
    skeleton(true);
    const store: Store = { patterns: [], record, sets: [] };
    await renderPopup(document, fakeDeps(store));
    await flush();
    expect(document.getElementById('diff-wrap')?.childNodes).toHaveLength(0);
  });
});

describe('fullpage vault table', () => {
  const tableSkeleton = (): void => {
    document.body.innerHTML = `
    <button id="dc-mode-toggle"><span id="dc-mode-label">Auto</span></button>
    <div id="stat-total"></div><div id="stat-session"></div><div id="stat-types"></div>
    <span id="vault-badge"></span>
    <input id="dc-search" type="text">
    <div id="console-out"></div><input id="console-input" type="text">
    <div id="network-list"></div>
    <span id="storage-pct"></span><div id="storage-bar"></div>
    <span id="storage-used"></span><span id="storage-quota"></span>
    <table id="storage-table"><tbody></tbody></table>
    <div id="patterns-list"></div>
    <div id="custom-list"></div>
    <button id="dc-clear">Clear</button>
    <button id="dc-copy-all">Copy map</button>
    <button id="dc-export">Export</button>
    <table id="vault-table"><thead><tr><th>Type</th><th>Original</th><th>Synthetic</th><th>Actions</th></tr></thead>
    <tbody id="vault-table-body"></tbody></table>
    <div id="dc-empty" style="display:none"></div>
    <div id="toast"></div>`;
  };
  const entry: VaultEntry = { original: 'ramesh', synthetic: 'XQZTMB', category: 'PERSON_NAME', type: 'pii', synthesizedAt: 1, confidence: 'high' };

  it('renders real table rows with blurred originals', async () => {
    tableSkeleton();
    const store: Store = { patterns: [], record: null, sets: [], vault: [entry], copied: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    const rows = document.querySelectorAll('#vault-table-body tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll('td')).toHaveLength(4);
    expect(rows[0].textContent).toContain('person_name');
    // Blurred until peeked — plaintext original never in the open.
    expect(rows[0].querySelector('.blurred')?.textContent).toBe('ramesh');
    expect(document.getElementById('dc-empty')?.style.display).toBe('none');
  });

  it('peek reveals, copy takes the synthetic', async () => {
    tableSkeleton();
    const store: Store = { patterns: [], record: null, sets: [], vault: [entry], copied: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    const btns = document.querySelectorAll('#vault-table-body .icon-btn');
    (btns[1] as HTMLButtonElement).click();
    await flush();
    expect(store.copied).toEqual(['XQZTMB']);
    (btns[0] as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector('#vault-table-body td.mono')?.textContent).toContain('ramesh');
  });

  it('empty vault shows the empty hint', async () => {
    tableSkeleton();
    const store: Store = { patterns: [], record: null, sets: [], vault: [], copied: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    expect(document.querySelectorAll('#vault-table-body tr')).toHaveLength(0);
    expect(document.getElementById('dc-empty')?.style.display).not.toBe('none');
  });
});

describe('fullpage shell memory', () => {
  it('fold toggles the sidebar and persists', async () => {
    localStorage.clear();
    skeleton(true);
    const store: Store = { patterns: [], record: null, sets: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    expect(document.body.classList.contains('fp-folded')).toBe(false);
    (document.getElementById('fp-logo') as HTMLElement).click();
    expect(document.body.classList.contains('fp-folded')).toBe(true);
    expect(localStorage.getItem('fp-folded')).toBe('1');

    skeleton(true);
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    expect(document.body.classList.contains('fp-folded')).toBe(true);
    localStorage.clear();
    document.body.classList.remove('fp-folded');
  });

  it('restores the last panel on reload, popup always opens Vault', async () => {
    localStorage.clear();
    skeleton(true);
    const store: Store = { patterns: [], record: null, sets: [] };
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    [...document.querySelectorAll('.tab')].find((t) => (t as HTMLElement).dataset.tab === 'settings')!.dispatchEvent(new Event('click'));
    expect(localStorage.getItem('fp-panel')).toBe('settings');

    skeleton(true);
    await renderPopup(document, fakeDeps(store), { fullPage: true });
    await flush();
    expect(document.getElementById('panel-settings')?.classList.contains('active')).toBe(true);

    skeleton(true);
    await renderPopup(document, fakeDeps(store));
    await flush();
    expect(document.getElementById('panel-vault')?.classList.contains('active')).toBe(true);
    localStorage.clear();
  });
});

describe('fullpage shell static contract', () => {
  const html = (): string => readFileSync(join(process.cwd(), 'fullpage.html'), 'utf8');
  it('nav uses inline SVG (no CDN), about mirrors popup', () => {
    const h = html();
    expect(h).not.toMatch(/cdnjs|cloudflare|tabler-icons/);
    expect(h.match(/<button class="tab(?: active)?"/g)?.length).toBe(4);
    expect(h).toContain('fp-nav-label');
    expect(h).toContain('about-hero');
    expect(h).toContain('id="fp-logo"');
    expect(h).toContain('dist/popup.js');
    expect(h).not.toContain('popup.css');
  });
});
