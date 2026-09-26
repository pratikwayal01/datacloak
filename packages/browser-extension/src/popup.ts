import { toCsv } from './exporters.js';
import { runConsoleCmd } from './console-cmd.js';
import { SITE_SELECTORS } from './sites.js';
import { isEnabled, parseHost, requestSite, removeSite, type Scheme, type UserSites } from './site-store.js';
import type { BgRequest, BgResponse } from './protocol.js';

export interface VaultEntry { synthetic: string; original: string; category: string; }
export type Mode = 'auto' | 'off';

export interface DetectorFlags { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean }
export const DEFAULT_FLAGS: DetectorFlags = { secrets: true, envVars: true, pii: true, entropy: true };

// ── Theme (persisted pref + OS-resolved output) ──
export type ThemePref = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export const THEME_KEY = 'dc-theme';

export function resolveTheme(pref: ThemePref, systemIsLight: boolean): ResolvedTheme {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemIsLight ? 'light' : 'dark';
}

export function applyTheme(doc: Document, theme: ResolvedTheme): void {
  doc.documentElement.dataset.theme = theme;
}

// ── UI settings (chrome.storage.sync `dc-settings`) ──
export interface UiSettings {
  autodetect: boolean; clipboard: boolean; network: boolean;
  blur: boolean; notif: boolean;
  sensitivity: 'low' | 'medium' | 'high'; style: string; allowlist: string[];
}
export const DEFAULT_UI_SETTINGS: UiSettings = {
  autodetect: true, clipboard: false, network: true,
  blur: true, notif: true,
  sensitivity: 'low', style: 'realistic', allowlist: [],
};

// Same count/categories shape background returns for cloak responses.
export function countsFromResponse(res: BgResponse): { count: number; categories: string[] } {
  if (!('count' in res)) return { count: 0, categories: [] };
  return { count: res.count, categories: res.categories };
}

export function summarize(entries: VaultEntry[]): { count: number; categories: string[] } {
  return { count: entries.length, categories: [...new Set(entries.map((e) => e.category))] };
}

// Shape-guarded: one malformed vault:* key must not throw the whole popup.
export function vaultEntriesFromSession(all: Record<string, unknown>): VaultEntry[] {
  const out: VaultEntry[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('vault:')) continue;
    if (typeof v !== 'object' || v === null) continue;
    const rows = (v as { vault?: unknown }).vault;
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== 3 || !r.every((s) => typeof s === 'string')) continue;
      const [synthetic, original, category] = r as [string, string, string];
      out.push({ synthetic, original, category });
    }
  }
  return out;
}

export interface SiteRow { host: string; enabled: boolean; builtin: boolean; active: boolean; scheme?: Scheme }

export interface PopupDeps {
  send: (req: BgRequest) => Promise<BgResponse>;
  getVault: () => Promise<VaultEntry[]>;
  clearVault: () => Promise<void>;
  getMode: () => Promise<Mode>;
  setMode: (m: Mode) => Promise<void>;
  getTheme: () => Promise<ThemePref>;
  setTheme: (t: ThemePref) => Promise<void>;
  systemIsLight: () => boolean;
  onSystemThemeChange: (cb: () => void) => void;
  getUiSettings: () => Promise<UiSettings>;
  setUiSettings: (s: UiSettings) => Promise<void>;
  estimateStorage: () => Promise<{ usage: number; quota: number } | null>;
  listStorage: () => Promise<[string, string][]>;
  download: (content: string, filename: string, mime: string) => void;
  copy: (text: string) => Promise<void>;
  version: string;
  getSites?: () => Promise<{ sites: SiteRow[]; activeHost: string | null }>;
  addSite?: (input: string) => Promise<{ ok: boolean; error?: string }>;
  toggleSite?: (host: string, enabled: boolean, scheme?: Scheme) => Promise<boolean>;
  removeSite?: (host: string, scheme?: Scheme) => Promise<void>;
}

const toast = (doc: Document, msg: string): void => {
  const el = doc.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
};

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

async function readFlags(deps: PopupDeps): Promise<DetectorFlags> {
  try {
    const res = await deps.send({ kind: 'settings.get' });
    if ('flags' in res) return res.flags as DetectorFlags;
  } catch { /* offline/mock-safe */ }
  return { ...DEFAULT_FLAGS };
}

export async function renderPopup(doc: Document, deps: PopupDeps): Promise<void> {
  const need = ['dc-mode-toggle', 'dc-vault', 'dc-export', 'dc-copy-all', 'dc-clear', 'dc-search',
    'stat-total', 'stat-session', 'stat-types', 'vault-badge', 'dc-empty',
    'console-out', 'console-input', 'network-list', 'storage-table',
    'storage-pct', 'storage-bar', 'storage-used', 'storage-quota', 'patterns-list'];
  for (const id of need) if (!doc.getElementById(id)) throw new Error(`popup skeleton missing #${id}`);

  // ── Theme ──
  let themePref: ThemePref = 'system';
  try { themePref = await deps.getTheme(); } catch { /* default */ }
  applyTheme(doc, resolveTheme(themePref, deps.systemIsLight()));
  deps.onSystemThemeChange(() => {
    if (themePref === 'system') applyTheme(doc, resolveTheme('system', deps.systemIsLight()));
  });
  const applyPref = async (p: ThemePref): Promise<void> => {
    themePref = p;
    applyTheme(doc, resolveTheme(p, deps.systemIsLight()));
    try { await deps.setTheme(p); } catch { /* mock-safe */ }
  };

  // ── Tabs ──
  doc.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      doc.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      doc.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      doc.getElementById(`panel-${(btn as HTMLElement).dataset.tab}`)?.classList.add('active');
    });
  });
  doc.querySelectorAll('.dev-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      doc.querySelectorAll('.dev-tab').forEach((t) => t.classList.remove('active'));
      doc.querySelectorAll('.dev-panel-inner').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      doc.getElementById(`dpanel-${(btn as HTMLElement).dataset.dtab}`)?.classList.add('active');
    });
  });

  // ── Mode toggle ──
  let mode: Mode = 'auto';
  try { mode = await deps.getMode(); } catch { /* default */ }
  const pill = doc.getElementById('dc-mode-toggle') as HTMLButtonElement;
  const modeLabel = doc.getElementById('dc-mode-label') ?? pill;
  const paintMode = (): void => {
    pill.classList.toggle('off', mode === 'off');
    modeLabel.textContent = mode === 'auto' ? 'Auto' : 'Off';
  };
  paintMode();
  pill.addEventListener('click', () => {
    mode = mode === 'auto' ? 'off' : 'auto';
    paintMode();
    deps.setMode(mode).catch(() => {});
    toast(doc, mode === 'auto' ? 'DataCloak enabled' : 'DataCloak paused');
  });

  // ── Settings state ──
  let ui: UiSettings = { ...DEFAULT_UI_SETTINGS };
  try { ui = { ...DEFAULT_UI_SETTINGS, ...(await deps.getUiSettings()) }; } catch { /* defaults */ }
  let flags = await readFlags(deps);

  // ── Vault ──
  let entries: VaultEntry[] = [];
  try { entries = await deps.getVault(); } catch { /* empty */ }
  const revealed = new Set<number>();
  let activeCat = 'all';
  let query = '';

  const stats = (): void => {
    const { count, categories } = summarize(entries);
    (doc.getElementById('stat-total') as HTMLElement).textContent = String(count);
    (doc.getElementById('stat-session') as HTMLElement).textContent = String(count);
    (doc.getElementById('stat-types') as HTMLElement).textContent = String(categories.length);
    (doc.getElementById('vault-badge') as HTMLElement).textContent = String(count);
  };

  const renderVault = (): void => {
    const vault = doc.getElementById('dc-vault') as HTMLElement;
    const empty = doc.getElementById('dc-empty') as HTMLElement;
    vault.querySelectorAll('.vault-row').forEach((n) => n.remove());
    const filtered = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) =>
        (activeCat === 'all' || e.category.toLowerCase() === activeCat) &&
        (!query || e.synthetic.toLowerCase().includes(query) || e.category.toLowerCase().includes(query)));
    empty.style.display = filtered.length === 0 ? '' : 'none';
    for (const { e, i } of filtered) {
      const row = doc.createElement('div');
      row.className = 'vault-row';
      const chip = doc.createElement('span');
      chip.className = `cat-chip ${e.category.toLowerCase()}`;
      chip.textContent = e.category.toLowerCase();
      const text = doc.createElement('span');
      text.className = 'synth-text';
      text.title = e.synthetic;
      const isOut = revealed.has(i);
      // Reveal shows the original in the row output only — never clipboard/console.
      text.textContent = isOut ? e.original : e.synthetic;
      if (isOut && ui.blur) {
        const b = doc.createElement('span');
        b.className = 'blurred';
        b.textContent = e.original;
        text.replaceChildren(b);
        text.addEventListener('click', () => b.style.filter = b.style.filter ? '' : 'none');
      }
      const peek = doc.createElement('button');
      peek.className = 'icon-btn' + (isOut ? ' reveal-active' : '');
      peek.type = 'button';
      peek.title = isOut ? 'Hide original' : 'Peek original';
      peek.textContent = '◉';
      peek.addEventListener('click', () => {
        if (revealed.has(i)) revealed.delete(i); else revealed.add(i);
        renderVault();
      });
      const copyBtn = doc.createElement('button');
      copyBtn.className = 'icon-btn';
      copyBtn.type = 'button';
      copyBtn.title = 'Copy synthetic';
      copyBtn.textContent = '⧉';
      copyBtn.addEventListener('click', () => {
        deps.copy(e.synthetic).then(() => toast(doc, 'Copied to clipboard')).catch(() => {});
      });
      const actions = doc.createElement('div');
      actions.className = 'row-actions';
      actions.append(peek, copyBtn);
      row.append(chip, text, actions);
      vault.appendChild(row);
    }
    stats();
  };
  renderVault();

  (doc.getElementById('dc-search') as HTMLInputElement).addEventListener('input', (ev) => {
    query = (ev.target as HTMLInputElement).value.toLowerCase();
    renderVault();
  });
  doc.querySelectorAll('.cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      doc.querySelectorAll('.cat-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeCat = (btn as HTMLElement).dataset.cat ?? 'all';
      renderVault();
    });
  });
  (doc.getElementById('dc-clear') as HTMLButtonElement).addEventListener('click', () => {
    deps.clearVault().then(() => {
      entries = [];
      revealed.clear();
      renderVault();
      toast(doc, 'Vault cleared');
    }).catch(() => {});
  });
  (doc.getElementById('dc-copy-all') as HTMLButtonElement).addEventListener('click', () => {
    const map = Object.fromEntries(entries.map((e) => [e.synthetic, e.original]));
    deps.copy(JSON.stringify(map, null, 2)).then(() => toast(doc, 'Copied to clipboard')).catch(() => {});
  });
  (doc.getElementById('dc-export') as HTMLButtonElement).addEventListener('click', () => {
    deps.download(toCsv(entries), `datacloak-vault-${Date.now()}.csv`, 'text/csv');
    toast(doc, 'Exported vault CSV');
  });

  // ── Settings panel: listeners bound once, paintSettings renders all from state ──
  const paintRisk = (): void => {
    doc.querySelectorAll('.risk-btn').forEach((b) => {
      (b as HTMLElement).className = 'risk-btn' +
        ((b as HTMLElement).dataset.risk === ui.sensitivity ? ` active-${ui.sensitivity}` : '');
    });
  };
  const paintSettings = (): void => {
    for (const [id, val] of [
      ['s-autodetect', ui.autodetect], ['s-clipboard', ui.clipboard], ['s-network', ui.network],
      ['s-blur', ui.blur], ['s-notif', ui.notif],
    ] as const) {
      const el = doc.getElementById(id) as HTMLInputElement | null;
      if (el) el.checked = val;
    }
    paintRisk();
    const style = doc.getElementById('s-style') as HTMLSelectElement | null;
    if (style) style.value = ui.style;
    const theme = doc.getElementById('s-theme') as HTMLSelectElement | null;
    if (theme) theme.value = themePref;
    renderAllowlist();
  };
  // ponytail: one-time bind guarded by dataset.bound; paintSettings owns all state→DOM
  const bindCheck = (id: string, onChange: (v: boolean) => void): void => {
    const el = doc.getElementById(id) as HTMLInputElement | null;
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('change', () => onChange(el.checked));
  };
  bindCheck('s-autodetect', (v) => { ui.autodetect = v; });
  bindCheck('s-clipboard', (v) => { ui.clipboard = v; });
  bindCheck('s-network', (v) => { ui.network = v; });
  bindCheck('s-blur', (v) => { ui.blur = v; renderVault(); });
  bindCheck('s-notif', (v) => { ui.notif = v; });
  doc.querySelectorAll('.risk-btn').forEach((btn) => {
    if ((btn as HTMLElement).dataset.bound) return;
    (btn as HTMLElement).dataset.bound = '1';
    btn.addEventListener('click', () => {
      ui.sensitivity = ((btn as HTMLElement).dataset.risk ?? 'low') as UiSettings['sensitivity'];
      paintRisk();
    });
  });

  const styleSel = doc.getElementById('s-style') as HTMLSelectElement | null;
  if (styleSel && !styleSel.dataset.bound) {
    styleSel.dataset.bound = '1';
    styleSel.addEventListener('change', () => { ui.style = styleSel.value; });
  }

  // Theme control — after the replacement-style row (real HTML), or
  // before the settings footer as fallback. popup.html itself untouched.
  const styleRow = styleSel?.closest('.setting-row');
  const footer = doc.getElementById('s-save')?.closest('.footer');
  if (!doc.getElementById('s-theme') && (styleRow ?? footer)) {
    const row = doc.createElement('div');
    row.className = 'setting-row';
    const info = doc.createElement('div');
    info.className = 'setting-info';
    const name = doc.createElement('div');
    name.className = 'setting-name';
    name.textContent = 'Theme';
    const desc = doc.createElement('div');
    desc.className = 'setting-desc';
    desc.textContent = 'Interface brightness (System follows OS)';
    info.append(name, desc);
    const sel = doc.createElement('select');
    sel.className = 'setting-select';
    sel.id = 's-theme';
    for (const v of ['system', 'dark', 'light'] as ThemePref[]) {
      const opt = doc.createElement('option');
      opt.value = v;
      opt.textContent = v[0].toUpperCase() + v.slice(1);
      sel.appendChild(opt);
    }
    sel.value = themePref;
    sel.addEventListener('change', () => { void applyPref(sel.value as ThemePref); });
    row.append(info, sel);
    if (styleRow) styleRow.after(row);
    else footer?.before(row);
  }

  const renderAllowlist = (): void => {
    const tags = doc.getElementById('allowlist-tags');
    if (!tags) return;
    tags.replaceChildren();
    for (const domain of ui.allowlist) {
      const tag = doc.createElement('span');
      tag.className = 'allowlist-tag';
      tag.textContent = `${domain} `;
      const x = doc.createElement('button');
      x.type = 'button';
      x.title = 'Remove';
      x.textContent = '×';
      x.addEventListener('click', () => {
        ui.allowlist = ui.allowlist.filter((d) => d !== domain);
        renderAllowlist();
      });
      tag.appendChild(x);
      tags.appendChild(tag);
    }
  };
  renderAllowlist();
  paintSettings();
  const allowAdd = doc.getElementById('s-allowlist-add');
  if (allowAdd && !(allowAdd as HTMLElement).dataset.bound) {
    (allowAdd as HTMLElement).dataset.bound = '1';
    allowAdd.addEventListener('click', () => {
      const input = doc.getElementById('s-allowlist-input') as HTMLInputElement | null;
      const val = input?.value.trim() ?? '';
      if (!val || ui.allowlist.includes(val)) return;
      ui.allowlist = [...ui.allowlist, val];
      if (input) input.value = '';
      renderAllowlist();
    });
  }
  // ── Sites section (settings tab; dynamic so test skeletons work, reuses
  // static #sites-* markup from popup.html when present) ──
  if (deps.getSites) {
    const ensureSitesSection = (): { list: HTMLElement; active: HTMLElement } | null => {
      let list = doc.getElementById('sites-list') as HTMLElement | null;
      let active = doc.getElementById('sites-active') as HTMLElement | null;
      if (list && active) return { list, active };
      const settingsBody = doc.querySelector('#panel-settings .settings-body') ?? doc.getElementById('panel-settings');
      if (!settingsBody) return null;
      const label = doc.createElement('div');
      label.className = 'settings-group-label';
      label.style.marginTop = '6px';
      label.textContent = 'Sites';
      active = active ?? doc.createElement('div');
      active.id = 'sites-active';
      active.className = 'setting-desc';
      list = list ?? doc.createElement('div');
      list.id = 'sites-list';
      const inputRow = doc.createElement('div');
      inputRow.className = 'allowlist-input-row';
      const input = doc.createElement('input');
      input.className = 'allowlist-input';
      input.id = 's-sites-input';
      input.type = 'text';
      input.placeholder = 'duck.ai or http://nas:3000';
      const add = doc.createElement('button');
      add.className = 'btn-sm accent';
      add.id = 's-sites-add';
      add.type = 'button';
      add.textContent = 'Add';
      inputRow.append(input, add);
      const wrap = doc.createElement('div');
      wrap.className = 'allowlist-wrap';
      wrap.append(inputRow);
      const footer = doc.getElementById('s-save')?.closest('.footer');
      (footer ?? settingsBody).before(label, active, list, wrap);
      return { list, active };
    };
    const section = ensureSitesSection();
    if (section) {
      const paintSites = async (): Promise<void> => {
        let sites: SiteRow[] = [];
        let activeHost: string | null = null;
        try {
          ({ sites, activeHost } = await deps.getSites!());
        } catch { /* stays empty */ }
        section.active.textContent = activeHost ? `This site: ${activeHost}` : 'This site: (unknown)';
        section.list.replaceChildren();
        for (const s of sites) {
          const row = doc.createElement('div');
          row.className = 'setting-row';
          const info = doc.createElement('div');
          info.className = 'setting-info';
          const name = doc.createElement('div');
          name.className = 'setting-name';
          name.textContent = s.host;
          const desc = doc.createElement('div');
          desc.className = 'setting-desc';
          desc.textContent = `${s.builtin ? 'Built-in' : 'Custom'}${s.active ? ' · current site' : ''}`;
          info.append(name, desc);
          const right = doc.createElement('div');
          right.style.display = 'flex';
          right.style.gap = '6px';
          right.style.alignItems = 'center';
          const wrap = doc.createElement('label');
          wrap.className = 'toggle-wrap';
          const input = doc.createElement('input');
          input.type = 'checkbox';
          input.checked = s.enabled;
          input.setAttribute('aria-label', `Enable DataCloak on ${s.host}`);
          input.addEventListener('change', () => {
            void deps.toggleSite!(s.host, input.checked, s.scheme).then((ok) => {
              if (ok) { toast(doc, `${s.host} ${input.checked ? 'enabled' : 'disabled'}`); void paintSites(); }
              else { input.checked = !input.checked; toast(doc, 'Permission denied'); }
            }).catch(() => { input.checked = !input.checked; });
          });
          const track = doc.createElement('span');
          track.className = 'toggle-track';
          wrap.append(input, track);
          right.appendChild(wrap);
          if (!s.builtin) {
            const rm = doc.createElement('button');
            rm.type = 'button';
            rm.className = 'btn-sm';
            rm.dataset.remove = s.host;
            rm.title = `Remove ${s.host}`;
            rm.textContent = '×';
            rm.addEventListener('click', () => {
              void deps.removeSite!(s.host, s.scheme).then(() => void paintSites()).catch(() => {});
            });
            right.appendChild(rm);
          }
          row.append(info, right);
          section.list.appendChild(row);
        }
      };
      await paintSites();
      const addBtn = doc.getElementById('s-sites-add');
      if (addBtn && !(addBtn as HTMLElement).dataset.bound) {
        (addBtn as HTMLElement).dataset.bound = '1';
        addBtn.addEventListener('click', () => {
          const input = doc.getElementById('s-sites-input') as HTMLInputElement | null;
          const val = input?.value.trim() ?? '';
          if (!val) return;
          void deps.addSite!(val).then((r) => {
            if (r.ok) { if (input) input.value = ''; void paintSites(); }
            else toast(doc, r.error ?? 'Could not add site');
          }).catch(() => {});
        });
      }
    }
  }

  doc.getElementById('s-save')?.addEventListener('click', () => {
    deps.setUiSettings({ ...ui }).then(() => toast(doc, 'Settings saved')).catch(() => {});
  });
  doc.getElementById('s-reset')?.addEventListener('click', () => {
    ui = { ...DEFAULT_UI_SETTINGS };
    void applyPref('system');
    paintSettings();
    renderVault();
    deps.setUiSettings({ ...ui }).catch(() => {});
    toast(doc, 'Reset to defaults');
  });

  // ── Patterns tab (detector flags → background settings.set) ──
  const patternDefs: [keyof DetectorFlags, string][] = [
    ['secrets', 'Secrets'], ['envVars', 'Env vars'], ['pii', 'PII'], ['entropy', 'Entropy'],
  ];
  const renderPatterns = (): void => {
    const list = doc.getElementById('patterns-list') as HTMLElement;
    list.replaceChildren();
    for (const [key, label] of patternDefs) {
      const row = doc.createElement('div');
      row.className = 'pattern-row';
      const lab = doc.createElement('span');
      lab.className = 'pattern-label';
      lab.textContent = label;
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.checked = flags[key];
      input.setAttribute('aria-label', `${label} pattern`);
      input.addEventListener('change', () => {
        flags = { ...flags, [key]: input.checked };
        deps.send({ kind: 'settings.set', flags }).then(() => {
          toast(doc, `${label} pattern ${input.checked ? 'enabled' : 'disabled'}`);
        }).catch(() => { input.checked = !input.checked; });
      });
      const wrap = doc.createElement('label');
      wrap.className = 'toggle-wrap pattern-toggle';
      const track = doc.createElement('span');
      track.className = 'toggle-track';
      wrap.append(input, track);
      row.append(lab, wrap);
      list.appendChild(row);
    }
  };
  renderPatterns();

  // ── Console (runConsoleCmd; originals never logged) ──
  const out = doc.getElementById('console-out') as HTMLElement;
  const addLog = (level: string, msg: string): void => {
    const line = doc.createElement('div');
    line.className = 'log-line';
    const time = doc.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date().toLocaleTimeString('en-GB');
    const body = doc.createElement('span');
    body.className = `log-${level}`;
    body.textContent = msg;
    line.append(time, body);
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  };
  (doc.getElementById('console-input') as HTMLInputElement).addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key !== 'Enter') return;
    const input = ev.target as HTMLInputElement;
    const cmd = input.value.trim();
    if (!cmd) return;
    addLog('data', `> ${cmd}`);
    try {
      addLog('info', runConsoleCmd(cmd, { version: deps.version, vaultCount: entries.length, settings: { ...flags } }));
    } catch {
      addLog('error', 'command failed');
    }
    input.value = '';
  });
  doc.getElementById('dev-clear-log')?.addEventListener('click', () => { out.replaceChildren(); });
  doc.getElementById('dev-copy-log')?.addEventListener('click', () => {
    deps.copy(out.textContent ?? '').then(() => toast(doc, 'Copied to clipboard')).catch(() => {});
  });

  // ── Network panel — background oplog, honestly labeled ──
  const renderNetwork = async (): Promise<void> => {
    const list = doc.getElementById('network-list') as HTMLElement;
    list.replaceChildren();
    const label = doc.createElement('div');
    label.className = 'section-label';
    label.textContent = 'Background operation log';
    list.appendChild(label);
    let rows: { kind: string; ms: number; count: number; categories: string[]; ts: number }[] = [];
    try {
      const res = await deps.send({ kind: 'stats' });
      if ('oplog' in res) rows = res.oplog;
    } catch { /* stays empty */ }
    if (rows.length === 0) {
      const p = doc.createElement('div');
      p.className = 'section-label';
      p.textContent = 'No operations recorded yet.';
      list.appendChild(p);
      return;
    }
    for (const r of rows.slice(-50).reverse()) {
      const row = doc.createElement('div');
      row.className = 'net-row';
      const method = doc.createElement('span');
      method.className = `net-method ${r.kind === 'cloak' ? 'POST' : 'GET'}`;
      method.textContent = r.kind.toUpperCase();
      const url = doc.createElement('span');
      url.className = 'net-url';
      url.textContent = `${r.count} item(s)${r.categories.length ? ` · ${r.categories.join(', ')}` : ''}`;
      const status = doc.createElement('span');
      status.className = 'net-status ok';
      status.textContent = String(r.count);
      const ms = doc.createElement('span');
      ms.className = 'net-time';
      ms.textContent = `${r.ms}ms`;
      row.append(method, url, status, ms);
      list.appendChild(row);
    }
  };
  await renderNetwork();

  // ── Storage panel — estimate() mock-safe, 'n/a' on failure ──
  try {
    const est = await deps.estimateStorage();
    const used = est ? fmtBytes(est.usage) : 'n/a';
    const pct = est && est.quota ? Math.min(100, Math.round((est.usage / est.quota) * 100)) : 0;
    (doc.getElementById('storage-pct') as HTMLElement).textContent = est ? `${pct}%` : 'n/a';
    (doc.getElementById('storage-bar') as HTMLElement).style.width = `${pct}%`;
    (doc.getElementById('storage-used') as HTMLElement).textContent = used;
    (doc.getElementById('storage-quota') as HTMLElement).textContent =
      est ? `/ ${fmtBytes(est.quota)}` : '';
  } catch {
    (doc.getElementById('storage-pct') as HTMLElement).textContent = 'n/a';
    (doc.getElementById('storage-used') as HTMLElement).textContent = 'n/a';
  }
  try {
    const rows = await deps.listStorage();
    const tbody = doc.querySelector('#storage-table tbody') as HTMLTableSectionElement | null;
    tbody?.replaceChildren();
    for (const [k, v] of rows) {
      const tr = doc.createElement('tr');
      const tdK = doc.createElement('td');
      tdK.textContent = k;
      const tdV = doc.createElement('td');
      tdV.textContent = v;
      tr.append(tdK, tdV);
      tbody?.appendChild(tr);
    }
  } catch { /* table stays empty */ }
}

// Production wiring (no-op under test — chrome undefined there)
declare const chrome: {
  runtime: {
    sendMessage: (msg: BgRequest) => Promise<BgResponse>;
    getManifest?: () => { version?: string };
  };
  storage: {
    sync: { get(k: string | null): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void> };
    session: { get(k: string | null): Promise<Record<string, unknown>>; remove(k: string): Promise<void> };
  };
  tabs: { query: (q: { active: boolean; currentWindow: boolean }) => Promise<{ url?: string }[]> };
  permissions: { request: (p: { origins: string[] }) => Promise<boolean>; remove: (p: { origins: string[] }) => Promise<boolean> };
  scripting: {
    registerContentScript: (s: { id: string; matches: string[]; js: string[] }) => Promise<void>;
    unregisterContentScripts: (f: { ids: string[] }) => Promise<void>;
  };
} | undefined;

function prodDeps(): PopupDeps {
  const syncGet = async <T>(key: string, fallback: T): Promise<T> => {
    try {
      const got = await chrome!.storage.sync.get(key);
      return (got[key] as T) ?? fallback;
    } catch { return fallback; }
  };
  return {
    send: (req) => chrome!.runtime.sendMessage(req),
    getVault: async () => vaultEntriesFromSession(await chrome!.storage.session.get(null)),
    clearVault: async () => {
      const all = await chrome!.storage.session.get(null);
      await Promise.all(Object.keys(all).filter((k) => k.startsWith('vault:'))
        .map((k) => chrome!.storage.session.remove(k)));
    },
    getMode: () => syncGet<Mode>('dc-mode', 'auto'),
    setMode: async (m) => { await chrome!.storage.sync.set({ 'dc-mode': m }); },
    getTheme: () => syncGet<ThemePref>(THEME_KEY, 'system'),
    setTheme: async (t) => { await chrome!.storage.sync.set({ [THEME_KEY]: t }); },
    systemIsLight: () => matchMedia('(prefers-color-scheme: light)').matches,
    onSystemThemeChange: (cb) => {
      try {
        matchMedia('(prefers-color-scheme: light)').addEventListener('change', cb);
      } catch { /* older chrome */ }
    },
    getUiSettings: async () => ({ ...DEFAULT_UI_SETTINGS, ...((await syncGet('dc-settings', {})) as Partial<UiSettings>) }),
    setUiSettings: async (s) => { await chrome!.storage.sync.set({ 'dc-settings': s }); },
    estimateStorage: async () => {
      try {
        const est = await navigator.storage.estimate();
        return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
      } catch { return null; }
    },
    listStorage: async () => {
      const [a, b] = await Promise.all([
        chrome!.storage.sync.get(null).catch(() => ({})),
        chrome!.storage.session.get(null).catch(() => ({})),
      ]);
      const rows: [string, string][] = [];
      for (const [k, v] of [...Object.entries(a), ...Object.entries(b)]) {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        rows.push([k, s.length > 80 ? `${s.slice(0, 80)}…` : s]);
      }
      return rows;
    },
    download: (content, filename, mime) => {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    copy: async (text) => { await navigator.clipboard.writeText(text); },
    version: (() => { try { return chrome!.runtime.getManifest?.().version ?? '1.0.0'; } catch { return '1.0.0'; } })(),
    ...prodSites(),
  };
}

export function upsertCustomSite(user: UserSites, host: string, enabled: boolean, scheme?: Scheme): UserSites {
  const idx = user.custom.findIndex((c) => c.host === host);
  if (idx >= 0) return { ...user, custom: user.custom.map((c, i) => i === idx ? { ...c, enabled } : c) };
  return { ...user, custom: [...user.custom, { host, enabled, ...(scheme ? { scheme } : {}) }] };
}

const SITES_KEY = 'dc-sites';
const BUILTINS = Object.keys(SITE_SELECTORS);

// Scheme threads from parseHost into requestSite/removeSite: bare host:port
// defaults http, remote https-with-port needs the explicit scheme.
function prodSites(): Pick<PopupDeps, 'getSites' | 'addSite' | 'toggleSite' | 'removeSite'> {
  const chromeish = {
    permissions: {
      request: (p: { origins: string[] }) => chrome!.permissions.request(p),
      remove: (p: { origins: string[] }) => chrome!.permissions.remove(p),
    },
    scripting: {
      registerContentScript: (s: { id: string; matches: string[]; js: string[] }) => chrome!.scripting.registerContentScript(s),
      unregisterContentScripts: (f: { ids: string[] }) => chrome!.scripting.unregisterContentScripts(f),
    },
  };
  const loadSites = async (): Promise<UserSites> => {
    try {
      const got = await chrome!.storage.sync.get(SITES_KEY);
      const v = got[SITES_KEY] as UserSites | undefined;
      if (v && Array.isArray(v.custom) && Array.isArray(v.disabled)) return v;
    } catch { /* defaults */ }
    return { custom: [], disabled: [] };
  };
  const saveSites = async (u: UserSites): Promise<void> => {
    await chrome!.storage.sync.set({ [SITES_KEY]: u });
  };
  const activeHost = async (): Promise<string | null> => {
    try {
      const [tab] = await chrome!.tabs.query({ active: true, currentWindow: true });
      return parseHost(tab?.url ?? '')?.host ?? null;
    } catch { return null; }
  };
  return {
    getSites: async () => {
      const user = await loadSites();
      const host = await activeHost();
      const sites: SiteRow[] = [
        ...BUILTINS.map((h) => ({
          host: h, enabled: isEnabled(h, SITE_SELECTORS, user), builtin: true, active: h === host,
        })),
        ...user.custom.map((c) => ({
          host: c.host, enabled: c.enabled, builtin: false, active: c.host === host, scheme: c.scheme,
        })),
      ].filter((s, i, arr) => arr.findIndex((x) => x.host === s.host) === i);
      return { sites, activeHost: host };
    },
    addSite: async (input) => {
      const parsed = parseHost(input);
      if (!parsed) return { ok: false, error: 'Unrecognized host — try duck.ai or http://nas:3000' };
      const { host, scheme } = parsed;
      // Thread scheme only when the input stated it explicitly; bare
      // host:port keeps the colon-rule http default (see site-store).
      const explicit = input.includes('://') ? scheme : undefined;
      const user = await loadSites();
      if (!(host in SITE_SELECTORS) && !user.custom.some((c) => c.host === host)) {
        if (!await requestSite(host, chromeish, explicit)) return { ok: false, error: 'Permission denied' };
        user.custom.push({ host, enabled: true, ...(explicit ? { scheme: explicit } : {}) });
      } else {
        user.disabled = user.disabled.filter((d) => d !== host);
        user.custom = user.custom.map((c) => c.host === host ? { ...c, enabled: true } : c);
        const known = user.custom.find((c) => c.host === host)?.scheme ?? explicit;
        if (!await requestSite(host, chromeish, known)) return { ok: false, error: 'Permission denied' };
      }
      await saveSites(user);
      return { ok: true };
    },
    toggleSite: async (host, enabled, scheme) => {
      let user = await loadSites();
      if (enabled) {
        if (!await requestSite(host, chromeish, scheme)) return false;
      } else {
        await removeSite(host, chromeish, scheme);
      }
      const isBuiltin = host in SITE_SELECTORS;
      if (isBuiltin) {
        user = { ...user, disabled: enabled ? user.disabled.filter((d) => d !== host) : [...new Set([...user.disabled, host])] };
      } else {
        user = upsertCustomSite(user, host, enabled, scheme);
      }
      await saveSites(user);
      return true;
    },
    removeSite: async (host, scheme) => {
      await removeSite(host, chromeish, scheme);
      const user = await loadSites();
      await saveSites({ custom: user.custom.filter((c) => c.host !== host), disabled: user.disabled.filter((d) => d !== host) });
    },
  };
}

if (typeof chrome !== 'undefined' && chrome?.storage && chrome?.runtime) {
  document.addEventListener('DOMContentLoaded', () => {
    void renderPopup(document, prodDeps());
  });
}
