import { findComposer, findSendButton, getFieldText, setFieldText } from './sites.js';
import type { BgRequest, BgResponse, CloakResponse } from './protocol.js';

export type SendFn = (req: BgRequest) => Promise<BgResponse>;
export interface ArmOpts { mode: 'auto' | 'review'; }

const isField = (el: Element | null): el is HTMLElement =>
  !!el && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || (el as HTMLElement).isContentEditable);

const fieldFromEvent = (doc: Document, e: Event): HTMLElement | null => {
  const t = e.target as Element | null;
  if (isField(t)) return t;
  const ae = doc.activeElement as Element | null;
  if (isField(ae)) return ae;
  return findComposer(doc);
};

const ensureBadge = (doc: Document): HTMLElement => {
  let b = doc.querySelector('.dc-badge') as HTMLElement | null;
  if (!b) {
    b = doc.createElement('div');
    b.className = 'dc-badge';
    b.setAttribute('style', 'position:fixed;bottom:12px;right:12px;z-index:2147483647;font:11px sans-serif;padding:2px 8px;border-radius:999px;background:#222;color:#fff;opacity:.85');
    doc.body.appendChild(b);
  }
  return b;
};

const setBadge = (doc: Document, count: number): void => {
  ensureBadge(doc).textContent = count > 0 ? `DataCloak: ${count} cloaked` : 'DataCloak active';
};

// ponytail: review MVP = one Cloak-all button over categories list; per-item Accept/Skip when Task 4 needs it.
const renderReviewPanel = (doc: Document, res: CloakResponse, onConfirm: () => void): void => {
  doc.querySelector('.dc-review-panel')?.remove();
  const panel = doc.createElement('div');
  panel.className = 'dc-review-panel';
  panel.setAttribute('style', 'position:fixed;bottom:44px;right:12px;z-index:2147483647;font:12px sans-serif;background:#fff;color:#111;border:1px solid #ccc;border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.2)');
  panel.textContent = `Cloaked ${res.count} item${res.count === 1 ? '' : 's'} (${res.categories.join(', ')}) `;
  const btn = doc.createElement('button');
  btn.textContent = 'Cloak all & send';
  btn.addEventListener('click', () => { panel.remove(); onConfirm(); });
  panel.appendChild(btn);
  doc.body.appendChild(panel);
  (btn as HTMLButtonElement).focus();
};

export function armComposer(doc: Document, send: SendFn, opts: ArmOpts): { disarm(): void } {
  let proceeding = false;
  const badge = ensureBadge(doc);
  badge.textContent = 'DataCloak active';

  const proceed = (field: HTMLElement): void => {
    proceeding = true;
    try {
      const form = field.closest('form');
      const btn = (form ? findSendButton(form) ?? findSendButton(doc) : findSendButton(doc)) as HTMLButtonElement | null;
      if (btn) btn.click();
      else form?.requestSubmit();
    } finally {
      setTimeout(() => { proceeding = false; }, 0);
    }
  };

  const intercept = async (field: HTMLElement): Promise<void> => {
    const text = getFieldText(field);
    const res = await send({ kind: 'cloak', text });
    if (!('count' in res) || res.count === 0) { setBadge(doc, 0); proceed(field); return; }
    const cloak = res as CloakResponse;
    if (opts.mode === 'auto') {
      setFieldText(field, cloak.text);
      setBadge(doc, cloak.count);
      proceed(field);
      return;
    }
    renderReviewPanel(doc, cloak, () => {
      setFieldText(field, cloak.text);
      setBadge(doc, cloak.count);
      proceed(field);
    });
  };

  const onKeydown = (e: Event): void => {
    if (proceeding) return;
    const ke = e as KeyboardEvent;
    if (ke.key !== 'Enter' || ke.shiftKey) return;
    const field = fieldFromEvent(doc, e);
    if (!field) return;
    e.preventDefault();
    e.stopPropagation();
    void intercept(field);
  };

  const onClick = (e: Event): void => {
    if (proceeding) return;
    const t = e.target as Element | null;
    const cand = t?.closest?.('button') ?? null;
    if (!cand) return;
    if (findSendButton(cand.closest('form') ?? doc) !== cand) return;
    const field = fieldFromEvent(doc, e) ?? findComposer(doc);
    if (!field) return;
    e.preventDefault();
    e.stopPropagation();
    void intercept(field);
  };

  const onSubmit = (e: Event): void => {
    if (proceeding) return;
    const form = e.target as HTMLFormElement;
    const field = findComposer(doc) ?? (doc.activeElement as HTMLElement | null);
    if (!field || !form.contains(field)) return;
    e.preventDefault();
    e.stopPropagation();
    void intercept(field);
  };

  doc.addEventListener('keydown', onKeydown, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('submit', onSubmit, true);

  return {
    disarm(): void {
      doc.removeEventListener('keydown', onKeydown, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('submit', onSubmit, true);
      doc.querySelector('.dc-review-panel')?.remove();
      doc.querySelector('.dc-badge')?.remove();
    },
  };
}

export function observeResponses(logRoot: Node, send: SendFn): MutationObserver {
  const doc = logRoot.ownerDocument ?? (logRoot as Document);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Map a char offset in the concatenated group text to its (node, inner offset).
  // lens is a snapshot: earlier replacements mutate live node data, so offsets
  // must resolve against the pre-replacement layout (applied descending).
  const locate = (nodes: Text[], starts: number[], lens: number[], off: number): { idx: number; inner: number } => {
    let idx = starts.length - 1;
    for (let i = 0; i < starts.length; i++) {
      if (off < starts[i] + lens[i]) { idx = i; break; }
    }
    return { idx, inner: off - starts[idx] };
  };
  const replaceRange = (nodes: Text[], starts: number[], lens: number[], s: number, e: number, original: string): void => {
    const a = locate(nodes, starts, lens, s);
    const b = locate(nodes, starts, lens, e - 1);
    if (a.idx === b.idx) {
      const node = nodes[a.idx];
      const eInner = e - starts[b.idx];
      if (eInner < node.data.length) node.splitText(eInner);
      const mid = a.inner > 0 ? node.splitText(a.inner) : node;
      const span = doc.createElement('span');
      span.className = 'dc-restored';
      span.textContent = original;
      mid.replaceWith(span);
      return;
    }
    // Multi-node match: plain-text replacement to avoid breaking formatting.
    const startNode = nodes[a.idx];
    const startTail = a.inner > 0 ? startNode.splitText(a.inner) : startNode;
    const endNode = nodes[b.idx];
    const eInner = e - starts[b.idx];
    const endAfter = eInner < endNode.data.length ? endNode.splitText(eInner) : null;
    const replacement = doc.createTextNode(original);
    startTail.before(replacement);
    const stop: Node | null = endAfter ?? endNode.nextSibling;
    for (let n: ChildNode | null = startTail; n && n !== stop;) {
      const next: ChildNode | null = n.nextSibling;
      n.remove();
      n = next;
    }
  };
  const scan = async (): Promise<void> => {
    const walker = doc.createTreeWalker(logRoot, 4 /* NodeFilter.SHOW_TEXT */);
    // Group CONTIGUOUS text nodes sharing the same parent: streamers append
    // response chunks as sibling text nodes, splitting a synthetic mid-value.
    const groups: Text[][] = [];
    let prev: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      if ((t.parentElement as HTMLElement | null)?.closest?.('.dc-restored')) { prev = null; continue; }
      if (prev && t.parentNode === prev.parentNode && t.previousSibling === prev) {
        groups[groups.length - 1].push(t);
      } else {
        groups.push([t]);
      }
      prev = t;
    }
    for (const g of groups) {
      if (!g.some((t) => t.isConnected)) continue;
      const starts: number[] = [];
      const lens: number[] = [];
      let acc = '';
      for (const t of g) { starts.push(acc.length); lens.push(t.data.length); acc += t.data; }
      if (!acc.trim()) continue;
      const res = await send({ kind: 'restore', text: acc });
      if (!('restored' in res) || res.restored === 0) continue;
      if (!g.some((t) => t.isConnected)) continue;
      if (res.hits?.length) {
        // Descending offsets so earlier replacements don't shift later ones.
        const occs: { s: number; e: number; original: string }[] = [];
        for (const h of [...res.hits].sort((x, y) => y.synthetic.length - x.synthetic.length)) {
          let from = 0;
          for (;;) {
            const at = acc.indexOf(h.synthetic, from);
            if (at < 0) break;
            occs.push({ s: at, e: at + h.synthetic.length, original: h.original });
            from = at + h.synthetic.length;
          }
        }
        occs.sort((x, y) => y.s - x.s);
        for (const o of occs) replaceRange(g, starts, lens, o.s, o.e, o.original);
      } else if (res.text !== acc && g.length === 1 && g[0].isConnected) {
        const span = doc.createElement('span');
        span.className = 'dc-restored';
        span.textContent = res.text;
        g[0].replaceWith(span);
      }
    }
  };
  const obs = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void scan(); }, 800);
  });
  obs.observe(logRoot, { childList: true, characterData: true, subtree: true });
  const origDisconnect = obs.disconnect.bind(obs);
  obs.disconnect = () => { if (timer) clearTimeout(timer); origDisconnect(); };
  return obs;
}

// Static manifest scripts can't unregister — runtime gate is the fix for
// disabled built-ins that would otherwise still cloak.
export interface UserSitesShape {
  custom?: { host: string; enabled: boolean }[];
  disabled?: string[];
}

export function shouldArmForSite(host: string, sites?: UserSitesShape | null): boolean {
  if (!sites) return true;
  const h = host.toLowerCase();
  if (sites.disabled?.some((d) => d.toLowerCase() === h)) return false;
  const custom = sites.custom?.find((c) => c.host.toLowerCase() === h);
  if (custom && !custom.enabled) return false;
  return true;
}

// Production bootstrap (no-op under test — chrome undefined there)
// ponytail: chat-log root narrowing is a later optimization; body works with the TreeWalker skips.
declare const chrome: {
  runtime: { sendMessage(req: BgRequest): Promise<BgResponse> };
  storage: { sync: { get(keys: string[]): Promise<Record<string, unknown>> } };
} | undefined;

if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage && chrome?.storage?.sync) {
  const send: SendFn = (req) => chrome.runtime.sendMessage(req);
  void chrome.storage.sync.get(['dc-mode', 'dc-sites']).then((vals) => {
    const host = typeof location !== 'undefined' ? location.host.toLowerCase() : '';
    if (host && !shouldArmForSite(host, (vals['dc-sites'] as UserSitesShape | undefined) ?? undefined)) return;
    const mode = vals['dc-mode'] === 'review' ? 'review' : 'auto';
    armComposer(document, send, { mode });
    if (document.body) observeResponses(document.body, send);
  });
}
