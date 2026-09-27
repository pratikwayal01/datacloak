import { describe, expect, it, vi } from 'vitest';
import { armComposer, observeResponses, restoreCached, shouldArmForSite } from '../src/content.js';
import type { BgRequest, BgResponse } from '../src/protocol.js';

const fakeSend = (map: (t: string) => string) => async (req: BgRequest): Promise<BgResponse> => {
  if (req.kind === 'cloak') return { text: map(req.text), count: req.text === map(req.text) ? 0 : 1, categories: ['EMAIL'], uncertain: [], subs: [] };
  return { text: req.text, restored: 0 };
};

describe('content', () => {
  it('rewrites composer and clicks through once', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">john.doe@acme.com</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, fakeSend(() => 'CLOAKED@x.net'), { mode: 'auto' });
    (document.getElementById('p') as HTMLTextAreaElement).focus();
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('CLOAKED@x.net');
    expect(submitted).toBe(1);
    disarm();
  });
  it('clean text submits without rewrite', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hello world</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, fakeSend((t) => t), { mode: 'auto' });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toBe(1);
    disarm();
  });
  it('shouldArmForSite gates disabled hosts', () => {
    expect(shouldArmForSite('claude.ai', { custom: [], disabled: ['claude.ai'] })).toBe(false);
    expect(shouldArmForSite('nas:3000', { custom: [{ host: 'nas:3000', enabled: false }], disabled: [] })).toBe(false);
    expect(shouldArmForSite('claude.ai', { custom: [], disabled: [] })).toBe(true);
    expect(shouldArmForSite('x.test', undefined)).toBe(true);
  });
  it('bootstrap skips arm on disabled host, arms on enabled host', async () => {
    const host = window.location.host.toLowerCase();
    const g = globalThis as unknown as { chrome?: unknown };
    const bootWith = async (sites: unknown, review = false): Promise<void> => {
      document.body.innerHTML = `<form id="f"><textarea id="p">hi</textarea><button type="submit" id="s">send</button></form>`;
      g.chrome = {
        runtime: { sendMessage: async (req: BgRequest): Promise<BgResponse> => ({ text: req.text, restored: 0 }) },
        storage: { sync: { get: async (_keys: string[]) => ({ 'dc-sites': sites, 'dc-settings': { review } }) } },
      };
      vi.resetModules();
      await import('../src/content.js');
      await new Promise((r) => setTimeout(r, 10));
    };
    try {
      await bootWith({ custom: [], disabled: [host] });
      expect(document.querySelector('.dc-badge')).toBeNull();
      await bootWith({ custom: [], disabled: [] });
      expect(document.querySelector('.dc-badge')).not.toBeNull();
      document.querySelector('.dc-badge')?.remove();
    } finally {
      delete g.chrome;
    }
  });
  it('review flag arms review mode: cloaked send pauses with panel', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hi ramesh bye</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const g = globalThis as unknown as { chrome?: unknown };
    g.chrome = {
      runtime: { sendMessage: async (req: BgRequest): Promise<BgResponse> =>
        req.kind === 'cloak'
          ? { text: 'hi XXX bye', count: 1, categories: ['PERSON_NAME'], uncertain: [], subs: [] }
          : { text: (req as unknown as { text: string }).text, restored: 0 } },
      storage: { sync: { get: async () => ({ 'dc-settings': { review: true } }) } },
    };
    try {
      vi.resetModules();
      await import('../src/content.js');
      await new Promise((r) => setTimeout(r, 10));
      document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
      expect(document.querySelector('.dc-review-panel')).not.toBeNull();
      expect(submitted).toBe(0);
    } finally {
      delete g.chrome;
      document.querySelector('.dc-review-panel')?.remove();
      document.querySelector('.dc-badge')?.remove();
    }
  });
});

describe('content dead-context', () => {
  const deadSend = async (): Promise<BgResponse> => {
    throw new Error('Extension context invalidated.');
  };
  it('cloak fails closed: nothing submits, badge warns', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">john.doe@acme.com</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, deadSend, { mode: 'auto' });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toBe(0);
    expect(document.querySelector('.dc-badge')?.textContent).toMatch(/refresh the page/);
    disarm();
  });
});

describe('copy matches display', () => {
  it('restoreCached swaps longest-first, regex chars safe', () => {
    const cache = new Map([['[RAMESH_X1]', 'ramesh'], ['X1]', 'oops']]);
    expect(restoreCached('hi [RAMESH_X1] bye', cache)).toBe('hi ramesh bye');
    expect(restoreCached('clean text', cache)).toBe('clean text');
    expect(restoreCached('', cache)).toBe('');
    expect(restoreCached('hi [RAMESH_X1]', new Map())).toBe('hi [RAMESH_X1]');
  });

  it('scan populates the copy cache from hits', async () => {
    document.body.innerHTML = `<div id="log"><p>hello FAKE@x.net</p></div>`;
    const cache = new Map<string, string>();
    const send = async (req: BgRequest): Promise<BgResponse> => {
      if (req.kind !== 'restore') return { text: req.text, restored: 0 };
      return { text: req.text.replace('FAKE@x.net', 'real@x.net'), restored: 1, hits: [{ synthetic: 'FAKE@x.net', original: 'real@x.net' }] };
    };
    const obs = observeResponses(document.getElementById('log')!, send, cache);
    try {
      document.querySelector('#log p')?.appendChild(document.createTextNode('!'));
      await new Promise((r) => setTimeout(r, 1000));
      expect(cache.get('FAKE@x.net')).toBe('real@x.net');
    } finally {
      obs.disconnect();
    }
  });

  it('copy handler swaps cached fakes synchronously', async () => {
    document.body.innerHTML = `<div id="log"><p>hello</p></div>`;
    const cache = new Map([['FAKE@x.net', 'real@x.net']]);
    const send = async (req: BgRequest): Promise<BgResponse> => ({ text: req.text, restored: 0 });
    const obs = observeResponses(document.getElementById('log')!, send, cache);
    try {
      Object.defineProperty(document, 'getSelection', { value: () => ({ toString: () => 'mail FAKE@x.net' }), configurable: true });
      const writes: string[] = [];
      const ev = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: { setData: (_t: string, d: string) => { writes.push(d); } } });
      const cancelled = !document.getElementById('log')!.dispatchEvent(ev);
      expect(cancelled).toBe(true);
      expect(writes).toEqual(['mail real@x.net']);
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      obs.disconnect();
    }
  });

  it('copy leaves clean selections to default handling', async () => {
    document.body.innerHTML = `<div id="log"><p>hello</p></div>`;
    const send = vi.fn(async (req: BgRequest): Promise<BgResponse> => ({ text: req.text, restored: 0 }));
    const obs = observeResponses(document.getElementById('log')!, send);
    try {
      Object.defineProperty(document, 'getSelection', { value: () => ({ toString: () => 'just hello' }), configurable: true });
      const ev = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: { setData: vi.fn() } });
      const cancelled = !document.getElementById('log')!.dispatchEvent(ev);
      expect(cancelled).toBe(false);
      await new Promise((r) => setTimeout(r, 20));
      expect(send).toHaveBeenCalled();
    } finally {
      obs.disconnect();
    }
  });
});

describe('review uncertain rows', () => {
  const uncertainSend = async (req: BgRequest): Promise<BgResponse> => {
    if (req.kind !== 'cloak') return { text: req.text, restored: 0 };
    return {
      text: 'hi XXX, mail YYY', count: 2, categories: ['PERSON_NAME', 'EMAIL'],
      uncertain: [{ original: 'ramesh', synthetic: 'XXX', category: 'PERSON_NAME' }],
      subs: [
        { original: 'ramesh', synthetic: 'XXX', category: 'PERSON_NAME' },
        { original: 'ramesh@gmail.com', synthetic: 'YYY', category: 'EMAIL' },
      ],
    };
  };
  const armReview = (): { disarm: () => void; submitted: () => number } => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hi ramesh bye</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, uncertainSend, { mode: 'review' });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return { disarm, submitted: () => submitted };
  };
  const panelHost = (): HTMLElement | null => document.querySelector('.dc-review-panel');
  const panelButtons = (): HTMLButtonElement[] =>
    [...(panelHost()?.shadowRoot?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
  const panelText = (): string => panelHost()?.shadowRoot?.textContent ?? '';

  it('renders one row per detected value, not just uncertain ones', async () => {
    const { disarm } = armReview();
    await new Promise((r) => setTimeout(r, 20));
    expect(panelText()).toContain('PERSON_NAME');
    expect(panelText()).toContain('EMAIL');
    expect(panelHost()?.shadowRoot?.querySelectorAll('.item')).toHaveLength(2);
    disarm();
  });

  it('Reveal reverts that sub to the original on send', async () => {
    const t = armReview();
    await new Promise((r) => setTimeout(r, 20));
    panelButtons().find((b) => b.textContent === 'Reveal')!.click();
    panelButtons().find((b) => b.textContent === 'Send cloaked →')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('hi ramesh, mail YYY');
    expect(t.submitted()).toBe(1);
    t.disarm();
  });

  it('Keep (default) retains the synthetic on send', async () => {
    const t = armReview();
    await new Promise((r) => setTimeout(r, 20));
    panelButtons().find((b) => b.textContent === 'Send cloaked →')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('hi XXX, mail YYY');
    expect(t.submitted()).toBe(1);
    t.disarm();
  });

  it('auto mode never shows a panel, badge carries the count', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hi ramesh bye</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, uncertainSend, { mode: 'auto' });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.dc-review-panel')).toBeNull();
    expect(document.querySelector('.dc-badge')?.textContent).toBe('🔒 2 cloaked ⚠️ 1 uncertain');
    expect(submitted).toBe(1);
    disarm();
  });
});

describe('single armed instance', () => {
  it('re-arm disarms the previous instance (one submit, not two)', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hello world</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const first = armComposer(document, fakeSend((t) => t), { mode: 'auto' });
    const second = armComposer(document, fakeSend((t) => t), { mode: 'auto' });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toBe(1);
    first.disarm();
    second.disarm();
  });
});

describe('review send original', () => {
  const armOriginal = (): { disarm: () => void; submitted: () => number } => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hi ramesh bye</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const send = async (req: BgRequest): Promise<BgResponse> => {
      if (req.kind !== 'cloak') return { text: req.text, restored: 0 };
      return {
        text: 'hi XXX bye', count: 1, categories: ['PERSON_NAME'],
        uncertain: [{ original: 'ramesh', synthetic: 'XXX', category: 'PERSON_NAME' }],
        subs: [{ original: 'ramesh', synthetic: 'XXX', category: 'PERSON_NAME' }],
      };
    };
    const { disarm } = armComposer(document, send, { mode: 'review' });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return { disarm, submitted: () => submitted };
  };
  const shadowButtons = (): HTMLButtonElement[] =>
    [...(document.querySelector('.dc-review-panel')?.shadowRoot?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];

  it('✗ Send original submits the unmodified text', async () => {
    const t = armOriginal();
    await new Promise((r) => setTimeout(r, 20));
    shadowButtons().find((b) => b.textContent === '✗ Send original')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('hi ramesh bye');
    expect(t.submitted()).toBe(1);
    expect(document.querySelector('.dc-review-panel')).toBeNull();
    t.disarm();
  });

  it('scrim click cancels the same way', async () => {
    const t = armOriginal();
    await new Promise((r) => setTimeout(r, 20));
    (document.querySelector('.dc-review-panel') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('hi ramesh bye');
    expect(t.submitted()).toBe(1);
    expect(document.querySelector('.dc-review-panel')).toBeNull();
    t.disarm();
  });
});

describe('page badge flag', () => {
  it('badge:false sends without ever creating a badge', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">john.doe@acme.com</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, fakeSend(() => 'CLOAKED@x.net'), { mode: 'auto', badge: false });
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('CLOAKED@x.net');
    expect(submitted).toBe(1);
    expect(document.querySelector('.dc-badge')).toBeNull();
    disarm();
  });
});

describe('review repeat sends', () => {
  const stableSend = async (req: BgRequest): Promise<BgResponse> => {
    if (req.kind !== 'cloak') return { text: req.text, restored: 0 };
    return {
      text: 'hi XXX bye', count: 1, categories: ['PERSON_NAME'],
      uncertain: [{ original: 'ramesh', synthetic: 'XXX', category: 'PERSON_NAME' }],
      subs: [{ original: 'ramesh', synthetic: 'XXX', category: 'PERSON_NAME' }],
    };
  };
  const pressEnter = (): void => {
    document.getElementById('p')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  it('same text sends without re-asking after confirm', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hi ramesh bye</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    const { disarm } = armComposer(document, stableSend, { mode: 'review' });
    pressEnter();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.dc-review-panel')).not.toBeNull();
    (document.querySelector('.dc-review-panel')?.shadowRoot?.querySelector('.dc-send') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toBe(1);
    // Same original text back in the box (user re-sends / site kept it): no second panel.
    (document.getElementById('p') as HTMLTextAreaElement).value = 'hi ramesh bye';
    pressEnter();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.dc-review-panel')).toBeNull();
    expect(submitted).toBe(2);
    expect((document.getElementById('p') as HTMLTextAreaElement).value).toBe('hi XXX bye');
    disarm();
  });

  it('changed cloak result re-asks (vault changed underneath)', async () => {
    document.body.innerHTML = `<form id="f"><textarea id="p">hi ramesh bye</textarea><button type="submit" id="s">send</button></form>`;
    let submitted = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => { e.preventDefault(); submitted++; });
    let first = true;
    const shifting = async (req: BgRequest): Promise<BgResponse> => {
      if (req.kind !== 'cloak') return { text: req.text, restored: 0 };
      const fake = first ? 'XXX' : 'YYY';
      first = false;
      return {
        text: `hi ${fake} bye`, count: 1, categories: ['PERSON_NAME'],
        uncertain: [{ original: 'ramesh', synthetic: fake, category: 'PERSON_NAME' }],
        subs: [{ original: 'ramesh', synthetic: fake, category: 'PERSON_NAME' }],
      };
    };
    const { disarm } = armComposer(document, shifting, { mode: 'review' });
    pressEnter();
    await new Promise((r) => setTimeout(r, 20));
    (document.querySelector('.dc-review-panel')?.shadowRoot?.querySelector('.dc-send') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toBe(1);
    (document.getElementById('p') as HTMLTextAreaElement).value = 'hi ramesh bye';
    pressEnter();
    await new Promise((r) => setTimeout(r, 20));
    // New fake → panel again, not a silent send.
    expect(document.querySelector('.dc-review-panel')).not.toBeNull();
    expect(submitted).toBe(1);
    disarm();
  });
});
