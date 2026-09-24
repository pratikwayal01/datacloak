import { describe, expect, it, vi } from 'vitest';
import { armComposer } from '../src/content.js';
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
});
