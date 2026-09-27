import { findComposer, findSendButton, getFieldText, setFieldText } from './sites.js';
import type { BgRequest, BgResponse, CloakResponse } from './protocol.js';

export type SendFn = (req: BgRequest) => Promise<BgResponse>;
export interface ArmOpts { mode: 'auto' | 'review'; badge?: boolean; }

/** Synchronously swap known synthetics for originals (split/join: no regex-escaping hazards). */
export function restoreCached(text: string, cache: Map<string, string>): string {
  if (!text || cache.size === 0) return text;
  let out = text;
  for (const k of [...cache.keys()].sort((a, b) => b.length - a.length)) {
    if (k && out.includes(k)) out = out.split(k).join(cache.get(k) as string);
  }
  return out;
}

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

const setBadge = (doc: Document, count: number, uncertain = 0): void => {
  if (uncertain > 0) {
    ensureBadge(doc).textContent = `🔒 ${count} cloaked ⚠️ ${uncertain} uncertain`;
    return;
  }
  ensureBadge(doc).textContent = count > 0 ? `DataCloak: ${count} cloaked` : 'DataCloak active';
};

// ponytail: review MVP = uncertain rows over the Cloak-all button; per-item
// Accept/Skip lives here now that confidence rides the cloak response.
const CARD_CSS = [
  ':host{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(5,7,12,.55);font:13px \'Inter\',system-ui,sans-serif}',
  '.dc-card{background:#0F1117;color:#E4E8F0;border:1px solid #2A3050;border-radius:14px;padding:16px 18px;box-shadow:0 16px 48px rgba(0,0,0,.5);width:min(520px,92vw);max-height:80vh;overflow:auto}',
  '.dc-head{font-weight:700;font-size:14px;margin-bottom:10px}',
  '.dc-item{border:1px solid #2A3050;border-radius:10px;padding:10px 12px;margin:8px 0;background:#1C2033}',
  '.dc-item[data-state="revealed"]{border-color:#FFB547}',
  '.dc-pill{display:inline-block;background:#252B42;color:#00D4AA;border-radius:4px;padding:1px 7px;font-size:11px;font-family:\'JetBrains Mono\',monospace;margin-bottom:6px}',
  '.dc-orig{font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#8B95A6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dc-synth{font-family:\'JetBrains Mono\',monospace;font-size:12.5px;color:#E4E8F0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:2px 0 8px}',
  '.dc-toggle{display:flex;gap:8px}',
  '.dc-btn{font:inherit;color:#E4E8F0;background:#222640;border:1px solid #2A3050;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer}',
  '.dc-btn.kept{border-color:#00D4AA;color:#00D4AA}',
  '.dc-btn.revealed{border-color:#FFB547;color:#FFB547}',
  '.dc-foot{display:flex;gap:8px;margin-top:12px}',
  '.dc-send{flex:1;background:rgba(0,212,170,.12);border:1px solid #00D4AA;color:#00D4AA;font-weight:700;border-radius:8px;padding:8px;font-size:13px;cursor:pointer;font:inherit}',
  '.dc-cancel{background:transparent;border:1px solid #2A3050;color:#8B95A6;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font:inherit}',
].join('\n');

/** Shadow card: page author CSS can't restyle our buttons; adopted sheets
 *  (constructable stylesheets bypass style-src) with a plain <style>
 *  fallback for older engines. A <style> in shadow still obeys page CSP —
 *  shadow DOM buys isolation, not exemption. */
const renderReviewPanel = (doc: Document, res: CloakResponse, onConfirm: (finalText: string) => void): void => {
  doc.querySelector('.dc-review-panel')?.remove();
  const host = doc.createElement('div');
  host.className = 'dc-review-panel';
  const sh = host.attachShadow({ mode: 'open' });
  let styled = false;
  try {
    const Ctor = (globalThis as unknown as { CSSStyleSheet?: new () => { replaceSync(c: string): void } }).CSSStyleSheet;
    if (Ctor && 'adoptedStyleSheets' in sh) {
      const sheet = new Ctor();
      sheet.replaceSync(CARD_CSS);
      (sh as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets = [sheet];
      styled = true;
    }
  } catch { /* fall through to <style> */ }
  if (!styled) {
    const style = doc.createElement('style');
    style.textContent = CARD_CSS;
    sh.appendChild(style);
  }
  const panel = doc.createElement('div');
  panel.className = 'dc-card';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Review cloaked values');
  const head = doc.createElement('div');
  head.className = 'dc-head';
  head.textContent = `Cloaked ${res.count} item${res.count === 1 ? '' : 's'} (${res.categories.join(', ')}) — review each value:`;
  panel.appendChild(head);
  // Every detected value gets a row (not just uncertain ones): Keep sends the
  // synthetic, Reveal swaps it back to the original in the outgoing text.
  const items = (res.subs?.length ? res.subs : (res.uncertain ?? [])).map((s, i) => ({ id: i, ...s }));
  const states = new Map<number, 'kept' | 'revealed'>(items.map((s) => [s.id, 'kept']));
  const revertRevealed = (text: string, ids?: Set<number>): string => {
    let out = text;
    const targets = [...items]
      .filter((s) => (ids ? ids.has(s.id) : states.get(s.id) === 'revealed'))
      .sort((a, b) => b.synthetic.length - a.synthetic.length);
    for (const s of targets) {
      if (s.synthetic) out = out.split(s.synthetic).join(s.original);
    }
    return out;
  };
  for (const sub of items) {
    const div = doc.createElement('div');
    div.className = 'item';
    div.dataset.id = String(sub.id);
    div.dataset.state = 'kept';
    const pill = doc.createElement('span');
    pill.className = 'dc-pill';
    pill.textContent = sub.category;
    const orig = doc.createElement('div');
    orig.className = 'dc-orig';
    orig.textContent = sub.original;
    const synth = doc.createElement('div');
    synth.className = 'dc-synth';
    synth.textContent = `→ ${sub.synthetic}`;
    const toggle = doc.createElement('div');
    toggle.className = 'dc-toggle';
    const keep = doc.createElement('button');
    keep.className = 'dc-btn kept';
    keep.textContent = 'Keep';
    keep.setAttribute('data-action', 'keep');
    const reveal = doc.createElement('button');
    reveal.className = 'dc-btn';
    reveal.textContent = 'Reveal';
    reveal.setAttribute('data-action', 'reveal');
    const paint = (): void => {
      const st = states.get(sub.id) ?? 'kept';
      div.dataset.state = st;
      keep.classList.toggle('kept', st === 'kept');
      reveal.classList.toggle('revealed', st === 'revealed');
    };
    keep.addEventListener('click', () => { states.set(sub.id, 'kept'); paint(); });
    reveal.addEventListener('click', () => { states.set(sub.id, 'revealed'); paint(); });
    toggle.append(keep, reveal);
    div.append(pill, orig, synth, toggle);
    panel.appendChild(div);
  }
  const foot = doc.createElement('div');
  foot.className = 'dc-foot';
  const send = doc.createElement('button');
  send.className = 'dc-send';
  send.textContent = 'Send cloaked →';
  send.addEventListener('click', () => {
    host.remove();
    onConfirm(revertRevealed(res.text));
  });
  const cancel = doc.createElement('button');
  cancel.className = 'dc-cancel';
  cancel.textContent = '✗ Send original';
  const sendOriginal = (): void => {
    host.remove();
    onConfirm(revertRevealed(res.text, new Set(items.map((s) => s.id))));
  };
  cancel.addEventListener('click', sendOriginal);
  foot.append(send, cancel);
  panel.appendChild(foot);
  sh.appendChild(panel);
  // Scrim click cancels the same way "Send original" does.
  host.addEventListener('click', (ev) => {
    if (ev.target === host) sendOriginal();
  });
  doc.body.appendChild(host);
  send.focus();
};

export function armComposer(doc: Document, send: SendFn, opts: ArmOpts): { disarm(): void } {
  // Single armed instance per document: a previous arm (stale test module,
  // double bootstrap) would otherwise swallow submits via stopPropagation.
  // The marker lives on the document so it works across module instances.
  const d = doc as unknown as { __dcArm?: { disarm(): void } };
  try { d.__dcArm?.disarm(); } catch { /* stale handle */ }
  let proceeding = false;
  // Page badge is user-hideable (Settings → Page badge); review panel is unaffected.
  const showBadge = opts.badge !== false;
  const badgeText = (t: string): void => { if (showBadge) ensureBadge(doc).textContent = t; };
  const badgeCount = (count: number, uncertain = 0): void => { if (showBadge) setBadge(doc, count, uncertain); };
  if (showBadge) ensureBadge(doc).textContent = 'DataCloak active';

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
    let res: BgResponse;
    try {
      res = await send({ kind: 'cloak', text });
    } catch {
      // Stale content script (extension reloaded): fail closed — never send raw.
      badgeText('DataCloak disconnected — refresh the page');
      return;
    }
    if (!('count' in res) || res.count === 0) { badgeCount(0); proceed(field); return; }
    const cloak = res as CloakResponse;
    const uncertainCount = cloak.uncertain?.length ?? 0;
    if (opts.mode === 'auto') {
      // Auto mode: badge count only — no panel, no intercept change.
      setFieldText(field, cloak.text);
      badgeCount(cloak.count, uncertainCount);
      proceed(field);
      return;
    }
    renderReviewPanel(doc, cloak, (finalText) => {
      setFieldText(field, finalText);
      badgeCount(cloak.count, uncertainCount);
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

  const handle = {
    disarm(): void {
      doc.removeEventListener('keydown', onKeydown, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('submit', onSubmit, true);
      doc.querySelector('.dc-review-panel')?.remove();
      doc.querySelector('.dc-badge')?.remove();
      if (d.__dcArm === handle) delete d.__dcArm;
    },
  };
  d.__dcArm = handle;
  return handle;
}

export function observeResponses(logRoot: Node, send: SendFn, cache: Map<string, string> = new Map(), showBadge = true): MutationObserver {
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
      let res: BgResponse;
      try {
        res = await send({ kind: 'restore', text: acc });
      } catch {
        // Stale content script (extension reloaded): stop observing so the
        // dead sendMessage doesn't spam errors every batch.
        obs.disconnect();
        if (showBadge) ensureBadge(doc).textContent = 'DataCloak disconnected — refresh the page';
        return;
      }
      if (!('restored' in res) || res.restored === 0) continue;
      if (!g.some((t) => t.isConnected)) continue;
      if (res.hits?.length) {
        // Feed the copy-handler cache: what the user sees restored, copy must match.
        for (const h of res.hits) {
          cache.set(h.synthetic, h.original);
          if (cache.size > 500) {
            const oldest = cache.keys().next();
            if (!oldest.done) cache.delete(oldest.value);
          }
        }
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
  // Copy must match display: swap cached synthetics synchronously, then let
  // the background catch fakes the cache missed via an async rewrite.
  // Untouched when the selection is already clean, so rich formatting survives.
  const onCopy = (e: Event): void => {
    const sel = typeof doc.getSelection === 'function' ? doc.getSelection()?.toString() ?? '' : '';
    if (!sel) return;
    const quick = restoreCached(sel, cache);
    if (quick !== sel) {
      try {
        (e as ClipboardEvent).preventDefault();
        (e as ClipboardEvent).clipboardData?.setData('text/plain', quick);
      } catch { return; }
    }
    void (async () => {
      try {
        const res = await send({ kind: 'restore', text: sel });
        if (!('restored' in res) || res.restored === 0 || res.text === quick) return;
        await navigator.clipboard?.writeText(res.text);
      } catch { /* clipboard write is best-effort */ }
    })();
  };
  doc.addEventListener('copy', onCopy, true);
  const origDisconnect = obs.disconnect.bind(obs);
  obs.disconnect = () => { if (timer) clearTimeout(timer); doc.removeEventListener('copy', onCopy, true); origDisconnect(); };
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
  void chrome.storage.sync.get(['dc-mode', 'dc-sites', 'dc-settings']).then((vals) => {
    const host = typeof location !== 'undefined' ? location.host.toLowerCase() : '';
    if (host && !shouldArmForSite(host, (vals['dc-sites'] as UserSitesShape | undefined) ?? undefined)) return;
    // Review toggle lives in Settings (dc-settings); legacy dc-mode 'review' still honored.
    const uiSettings = vals['dc-settings'] as { review?: boolean; pageBadge?: boolean } | undefined;
    const review = uiSettings?.review === true;
    const showBadge = uiSettings?.pageBadge ?? true;
    const mode = vals['dc-mode'] === 'review' || review ? 'review' : 'auto';
    armComposer(document, send, { mode, badge: showBadge });
    if (document.body) observeResponses(document.body, send, new Map(), showBadge);
  }).catch(() => {
    // Reload raced the initial read — the orphaned script stays inert.
  });
}
