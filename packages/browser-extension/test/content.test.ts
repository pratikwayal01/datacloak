import { describe, expect, it, vi } from 'vitest';
import { armComposer, observeResponses, restoreCached, shouldArmForSite } from '../src/content.js';
import type { BgRequest, BgResponse } from '../src/protocol.js';

const fakeSend = (map: (t: string) => string) => async (req: BgRequest): Promise<BgResponse> => {
  if (req.kind === 'cloak') return { text: map(req.text), count: req.text === map(req.text) ? 0 : 1, categories: ['EMAIL'] };
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
    const bootWith = async (sites: unknown): Promise<void> => {
      document.body.innerHTML = `<form id="f"><textarea id="p">hi</textarea><button type="submit" id="s">send</button></form>`;
      g.chrome = {
        runtime: { sendMessage: async (req: BgRequest): Promise<BgResponse> => ({ text: req.text, restored: 0 }) },
        storage: { sync: { get: async (_keys: string[]) => ({ 'dc-sites': sites }) } },
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
