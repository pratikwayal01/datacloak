// packages/browser-extension/test/sites.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { findComposer, findSendButton, getFieldText, setFieldText } from '../src/sites.js';

const composerHtml = `<div id="app"><div class="chatlog">hi</div><div class="composer"><textarea id="prompt" rows="4"></textarea><button data-testid="send">↑</button></div></div>`;

// ponytail: happy-dom has no layout (zero rects, no execCommand).
// Simulate layout per-element: decor (#search) small+high, composer big+low.
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if ((this as HTMLElement).id === 'search')
      return { width: 50, height: 10, top: 5, left: 10, right: 60, bottom: 15 } as DOMRect;
    return { width: 300, height: 80, top: 700, left: 10, right: 310, bottom: 780 } as DOMRect;
  };
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  (document as any).execCommand = () => false;
});

describe('sites', () => {
  it('finds the composer textarea, not decor', () => {
    document.body.innerHTML = `<textarea id="search" rows="1"></textarea>` + composerHtml;
    const el = findComposer(document);
    expect((el as HTMLTextAreaElement).id).toBe('prompt');
  });
  it('finds send button near composer', () => {
    document.body.innerHTML = composerHtml;
    const composer = findComposer(document) as HTMLElement;
    expect(findSendButton(composer.parentElement as HTMLElement)?.textContent).toBe('↑');
  });
  it('reads/writes textarea and contenteditable', () => {
    document.body.innerHTML = `<textarea id="t">hello</textarea><div id="e" contenteditable="true">world</div>`;
    expect(getFieldText(document.getElementById('t') as HTMLElement)).toBe('hello');
    setFieldText(document.getElementById('e') as HTMLElement, 'synth');
    expect(getFieldText(document.getElementById('e') as HTMLElement)).toBe('synth');
  });
});
