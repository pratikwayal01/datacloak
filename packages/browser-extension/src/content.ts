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
  const scan = async (): Promise<void> => {
    const walker = doc.createTreeWalker(logRoot, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      if ((t.parentElement as HTMLElement | null)?.closest?.('.dc-restored')) continue;
      if (!t.data.trim()) continue;
      nodes.push(t);
    }
    for (const t of nodes) {
      if (!t.isConnected) continue;
      const res = await send({ kind: 'restore', text: t.data });
      if (!('restored' in res) || res.restored === 0 || res.text === t.data) continue;
      const span = doc.createElement('span');
      span.className = 'dc-restored';
      span.textContent = res.text;
      t.replaceWith(span);
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
