export const SITE_SELECTORS: Record<string, string[]> = {
  'claude.ai': ['div[contenteditable="true"][data-testid*="chat"]', 'div[contenteditable="true"]'],
  'chat.openai.com': ['#prompt-textarea', 'textarea[data-id="root"]', 'textarea'],
  'chatgpt.com': ['#prompt-textarea', 'textarea'],
  'gemini.google.com': ['div[contenteditable="true"]', 'rich-textarea textarea'],
  'x.ai': ['textarea', 'div[contenteditable="true"]'],
  'perplexity.ai': ['textarea', 'div[contenteditable="true"]'],
  'cowork.ai': ['textarea', 'div[contenteditable="true"]'],
  'chat.deepseek.com': ['textarea', 'div[contenteditable="true"]'],
};

const isVisible = (el: Element): boolean => {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 40 && r.height > 20;
};

const score = (el: Element): number => {
  const r = (el as HTMLElement).getBoundingClientRect();
  const lowBonus = r.top > window.innerHeight * 0.4 ? 1000 : 0;
  const area = Math.min(r.width * r.height, 200000);
  return lowBonus + area;
};

export function findComposer(doc: Document = document): HTMLElement | null {
  const host = location.hostname.replace(/^www\./, '');
  const sels = SITE_SELECTORS[host] ?? ['textarea', 'div[contenteditable="true"]'];
  let best: HTMLElement | null = null;
  let bestScore = -1;
  for (const sel of sels) {
    for (const el of doc.querySelectorAll(sel)) {
      if (!isVisible(el)) continue;
      const s = score(el);
      if (s > bestScore) { bestScore = s; best = el as HTMLElement; }
    }
    if (best) break;
  }
  return best;
}

export function findSendButton(root: ParentNode): HTMLElement | null {
  const btn = root.querySelector('button[type="submit"], button[data-testid*="send" i], button[aria-label*="send" i]');
  return (btn as HTMLElement) ?? null;
}

export function getFieldText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.innerText ?? el.textContent ?? '';
}

export function setFieldText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.focus();
    (el as HTMLTextAreaElement).value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, text);
    if (getFieldText(el) !== text) el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
