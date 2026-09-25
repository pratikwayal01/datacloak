import { describe, expect, it } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { observeResponses } from '../src/content.js';
import type { BgRequest, BgResponse } from '../src/protocol.js';

const ORIGINAL = 'Jasmine_Watsica4@hotmail.com';

describe('restore split across streaming text nodes', () => {
  it('restores a synthetic split across 3 text nodes under one parent', async () => {
    const engine = new DataCloakEngine();
    const cloaked = engine.cloak(`contact ${ORIGINAL} please`);
    expect(cloaked.substitutions.length).toBeGreaterThan(0);
    const synthetic = cloaked.substitutions[0].synthetic;
    expect(synthetic).not.toBe(ORIGINAL);

    // Streaming parsers (ChatGPT/Gemini) append response text as sibling
    // text nodes; split the synthetic into thirds across 3 of them.
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('contact '));
    const cut1 = Math.floor(synthetic.length / 3);
    const cut2 = Math.floor((2 * synthetic.length) / 3);
    p.appendChild(document.createTextNode(synthetic.slice(0, cut1)));
    p.appendChild(document.createTextNode(synthetic.slice(cut1, cut2)));
    p.appendChild(document.createTextNode(synthetic.slice(cut2)));
    p.appendChild(document.createTextNode(' please'));
    document.body.appendChild(p);

    const send = async (req: BgRequest): Promise<BgResponse> => {
      if (req.kind !== 'restore') return { text: req.text, restored: 0 };
      const r = engine.restore(req.text);
      const hits = engine.vault.list()
        .filter((e) => req.text.includes(e.synthetic))
        .map((e) => ({ synthetic: e.synthetic, original: e.original }));
      return { text: r.text, restored: r.restored, hits };
    };

    const obs = observeResponses(p, send);
    try {
      // Trigger the observer, then wait out the 800ms debounce.
      p.appendChild(document.createTextNode(''));
      await new Promise((r) => setTimeout(r, 1100));
      expect(p.textContent).toContain(ORIGINAL);
      expect(p.textContent).not.toContain(synthetic);
    } finally {
      obs.disconnect();
      p.remove();
    }
  });
});
