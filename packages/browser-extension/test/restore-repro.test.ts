import { describe, expect, it } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { observeResponses } from '../src/content.js';
import type { BgRequest, BgResponse } from '../src/protocol.js';

// Reproduces the reported chat: bracketed custom-literal fake + email fake
// in an assistant reply across two paragraphs. Both must restore.
describe('restore user repro', () => {
  it('restores [RAMESH_*] token and email fake in one reply', async () => {
    const engine = new DataCloakEngine({
      customPatterns: [{ name: 'Ramesh', pattern: '[Rr][Aa][Mm][Ee][Ss][Hh]', category: 'RAMESH', type: 'pii' as const, literal: true }],
    });
    const sent = engine.cloak('hey my name is ramesh my mail is ramesh@gmail.com');
    const nameSyn = sent.substitutions.find((s) => s.original === 'ramesh')?.synthetic;
    const mailSyn = sent.substitutions.find((s) => s.original === 'ramesh@gmail.com')?.synthetic;
    expect(nameSyn).toBeTruthy();
    expect(mailSyn).toBeTruthy();

    const reply = document.createElement('div');
    const p1 = document.createElement('p');
    p1.textContent = `Name: ${nameSyn}`;
    const p2 = document.createElement('p');
    p2.textContent = `Email: ${mailSyn}`;
    reply.append(p1, p2);
    document.body.appendChild(reply);

    const send = async (req: BgRequest): Promise<BgResponse> => {
      if (req.kind !== 'restore') return { text: req.text, restored: 0 };
      const r = engine.restore(req.text);
      const hits = engine.vault.list()
        .filter((e) => req.text.includes(e.synthetic))
        .map((e) => ({ synthetic: e.synthetic, original: e.original }));
      return { text: r.text, restored: r.restored, hits };
    };

    const obs = observeResponses(reply, send);
    try {
      p2.appendChild(document.createTextNode(''));
      await new Promise((r) => setTimeout(r, 1100));
      expect(reply.textContent).toContain('ramesh@gmail.com');
      expect(reply.textContent).not.toContain(mailSyn!);
      expect(reply.textContent).toContain('ramesh');
      expect(reply.textContent).not.toContain(nameSyn!);
    } finally {
      obs.disconnect();
      reply.remove();
    }
  });
});
