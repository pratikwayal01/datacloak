import type { BgRequest, BgResponse } from './protocol.js';
import type { CustomPattern } from '@pratikw/detect';
import { ensureSiteAccess, loadUserSites, type Chromeish, type Scheme, type SitesStorage, type UserSites } from './site-store.js';
import { SITE_SELECTORS } from './sites.js';

export type ConfirmSend = (req: BgRequest) => Promise<BgResponse>;

export interface ConfirmDeps {
  send: ConfirmSend;
  close: () => void;
  chromeish: Chromeish;
  sites: SitesStorage;
}

export type ConfirmQuery =
  | { action: 'remove-pattern'; name: string }
  | { action: 'allow-site'; host: string; scheme: Scheme | undefined };

export function parseConfirmQuery(search: string): ConfirmQuery | { error: string } {
  const q = new URLSearchParams(search);
  const action = q.get('action');
  if (action === 'remove-pattern') {
    const name = (q.get('name') ?? '').trim();
    if (!name) return { error: 'missing entity name' };
    return { action, name };
  }
  if (action === 'allow-site') {
    const host = (q.get('host') ?? '').trim().toLowerCase();
    if (!/^[a-z0-9.:-]{1,253}$/.test(host)) return { error: 'bad host' };
    const scheme = q.get('scheme') === 'http' ? 'http' : q.get('scheme') === 'https' ? 'https' : undefined;
    return { action, host, scheme };
  }
  return { error: 'unknown action' };
}

export async function runConfirmPage(doc: Document, search: string, deps: ConfirmDeps): Promise<void> {
  const status = (msg: string): void => {
    const el = doc.getElementById('cf-status');
    if (el) el.textContent = msg;
  };
  const confirmBtn = doc.getElementById('cf-confirm') as HTMLButtonElement | null;
  if (!confirmBtn) { status('page broken: missing confirm button'); return; }
  confirmBtn.addEventListener('click', () => void onConfirm());
  (doc.getElementById('cf-cancel') as HTMLButtonElement | null)?.addEventListener('click', deps.close);

  const setCopy = (title: string, desc: string, cta: string): void => {
    const t = doc.getElementById('cf-title');
    if (t) t.textContent = title;
    const d = doc.getElementById('cf-desc');
    if (d) d.textContent = desc;
    confirmBtn.textContent = cta;
  };

  const parsed = parseConfirmQuery(search);
  if ('error' in parsed) {
    status(parsed.error);
    confirmBtn.remove();
    return;
  }
  if (parsed.action === 'remove-pattern') {
    setCopy(`Remove "${parsed.name}"?`, 'This custom entity stops cloaking immediately. Past messages keep their fakes; the vault still restores them.', 'Remove');
  } else {
    setCopy(
      `Allow access to ${parsed.host}?`,
      'DataCloak will cloak what you type and restore replies for display. The vault stays on this device. Chrome shows its own grant dialog next — that one is the browser\u2019s and cannot be skipped.',
      'Allow',
    );
  }
  const onConfirm = async (): Promise<void> => {
    try {
      if (parsed.action === 'remove-pattern') await doRemove(parsed.name);
      else await doAllow(parsed.host, parsed.scheme);
    } catch (e: unknown) {
      status(`Failed: ${(e as Error)?.message ?? e}`);
    }
  };

  async function doRemove(name: string): Promise<void> {
    const got = await deps.send({ kind: 'patterns.get' });
    const current = 'patterns' in got && Array.isArray(got.patterns) ? (got.patterns as CustomPattern[]) : [];
    const res = await deps.send({ kind: 'patterns.set', patterns: current.filter((c) => c.name !== name) });
    if ('error' in res && res.error) { status(res.error); return; }
    status(`"${name}" removed. Closing…`);
    setTimeout(deps.close, 800);
  }

  async function doAllow(host: string, scheme: Scheme | undefined): Promise<void> {
    const user: UserSites = await loadUserSites(deps.sites);
    const r = await ensureSiteAccess(user, host, scheme, deps.chromeish, SITE_SELECTORS);
    if (!r.ok) { status('Permission denied.'); return; }
    await deps.sites.save(r.user);
    status(`${host} added. Closing…`);
    setTimeout(deps.close, 800);
  }
}

// Production wiring (no-op under test — chrome undefined there)
declare const chrome: {
  runtime: { sendMessage(msg: BgRequest): Promise<BgResponse> };
  storage: { sync: { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void> } };
  permissions: { request: (p: { origins: string[] }) => Promise<boolean>; remove: (p: { origins: string[] }) => Promise<boolean> };
  scripting: {
    registerContentScripts: (s: { id: string; matches: string[]; js: string[] }[]) => Promise<void>;
    unregisterContentScripts: (f: { ids: string[] }) => Promise<void>;
  };
} | undefined;

if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
  const SITES_KEY = 'dc-sites';
  const deps: ConfirmDeps = {
    send: (m) => chrome.runtime.sendMessage(m),
    close: () => window.close(),
    chromeish: {
      permissions: {
        request: (p) => chrome.permissions.request(p),
        remove: (p) => chrome.permissions.remove(p),
      },
      scripting: {
        registerContentScripts: (s) => chrome.scripting.registerContentScripts(s),
        unregisterContentScripts: (f) => chrome.scripting.unregisterContentScripts(f),
      },
    },
    sites: {
      load: async () => (await chrome.storage.sync.get(SITES_KEY))[SITES_KEY] as UserSites | undefined,
      save: async (u) => { await chrome.storage.sync.set({ [SITES_KEY]: u }); },
    },
  };
  document.addEventListener('DOMContentLoaded', () => {
    void runConfirmPage(document, location.search, deps);
  });
}
