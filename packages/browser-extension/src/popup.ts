import type { BgResponse } from './protocol.js';

export interface VaultEntry { synthetic: string; original: string; category: string; }
export type Mode = 'auto' | 'review';

export interface PopupStorage {
  getMode(): Promise<Mode>;
  setMode(mode: Mode): Promise<void>;
  getVault(): Promise<VaultEntry[]>;
}

// Same count/categories shape background returns for cloak responses.
export function countsFromResponse(res: BgResponse): { count: number; categories: string[] } {
  if (!('count' in res)) return { count: 0, categories: [] };
  return { count: res.count, categories: res.categories };
}

export function summarize(entries: VaultEntry[]): { count: number; categories: string[] } {
  return { count: entries.length, categories: [...new Set(entries.map((e) => e.category))] };
}

export function buildAuditJson(entries: VaultEntry[]): string {
  return JSON.stringify(entries.map((e) => ({
    synthetic: e.synthetic, original: e.original, category: e.category, exportedAt: new Date().toISOString(),
  })), null, 2);
}

const MASK = '••••••';

const paint = (el: HTMLElement, original: string, blurred: boolean): void => {
  el.classList.toggle('dc-blurred', blurred);
  el.textContent = blurred ? MASK : original;
};

export interface RenderDeps {
  storage: PopupStorage;
  onExport(json: string, filename: string): void;
}

export async function renderPopup(doc: Document, deps: RenderDeps): Promise<void> {
  const toggle = doc.getElementById('dc-mode-toggle') as HTMLButtonElement | null;
  const counts = doc.getElementById('dc-counts');
  const vault = doc.getElementById('dc-vault');
  const exportBtn = doc.getElementById('dc-export') as HTMLButtonElement | null;
  if (!toggle || !counts || !vault || !exportBtn) throw new Error('popup skeleton missing dc-* ids');

  let mode = await deps.storage.getMode();
  const paintToggle = (): void => { toggle.textContent = `Mode: ${mode}`; };
  paintToggle();
  toggle.addEventListener('click', () => {
    mode = mode === 'auto' ? 'review' : 'auto';
    paintToggle();
    void deps.storage.setMode(mode);
  });

  const entries = await deps.storage.getVault();
  const { count, categories } = summarize(entries);
  counts.textContent = count === 0
    ? '0 cloaked this session'
    : `${count} cloaked (${categories.join(', ')})`;

  vault.replaceChildren();
  if (entries.length === 0) {
    vault.textContent = 'Nothing cloaked yet — secrets appear here as you chat.';
  }
  for (const e of entries) {
    const row = doc.createElement('div');
    row.className = 'dc-row';
    const synth = doc.createElement('span');
    synth.className = 'dc-synth';
    synth.textContent = e.synthetic;
    const cat = doc.createElement('span');
    cat.className = 'dc-cat';
    cat.textContent = e.category;
    const orig = doc.createElement('span') as HTMLElement;
    orig.className = 'dc-original';
    orig.title = 'click to reveal';
    paint(orig, e.original, true);
    orig.addEventListener('click', () => {
      paint(orig, e.original, !orig.classList.contains('dc-blurred'));
    });
    row.append(synth, cat, orig);
    vault.appendChild(row);
  }

  exportBtn.addEventListener('click', () => {
    deps.onExport(buildAuditJson(entries), `datacloak-audit-${Date.now()}.json`);
  });
}

// Production wiring (no-op under test — chrome undefined there)
declare const chrome: {
  storage: {
    sync: { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void> };
    session: { get(k: null): Promise<Record<string, unknown>> };
  };
} | undefined;

function download(json: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (typeof chrome !== 'undefined' && chrome?.storage) {
  const storage: PopupStorage = {
    getMode: async () => ((await chrome.storage.sync.get('dc-mode'))['dc-mode'] as Mode) ?? 'auto',
    setMode: async (m) => { await chrome.storage.sync.set({ 'dc-mode': m }); },
    getVault: async () => {
      const all = await chrome.storage.session.get(null);
      return Object.entries(all)
        .filter(([k]) => k.startsWith('vault:'))
        .flatMap(([, v]) => (v as { vault: [string, string, string][] }).vault
          .map(([synthetic, original, category]) => ({ synthetic, original, category })));
    },
  };
  document.addEventListener('DOMContentLoaded', () => {
    void renderPopup(document, { storage, onExport: download });
  });
}
