import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DataCloakEngine } from '@pratikw/detect';
import { HeuristicNerProvider } from '../src/index.js';

const ner = () => new DataCloakEngine({ ner: new HeuristicNerProvider() } as never);

describe('ner integration', () => {
  it('cloaks and restores a name', () => {
    const e = ner();
    const c = e.cloak('contact Alice Johnson tomorrow');
    expect(c.text).not.toContain('Alice Johnson');
    expect(e.restore(c.text).text).toContain('Alice Johnson');
  });
  it('pattern wins overlap (email kept, not name)', () => {
    const e = ner();
    const d = e.detect('mail alice.johnson@acme.com');
    expect(d.map((x) => x.category)).toContain('EMAIL');
    expect(d.map((x) => x.category)).not.toContain('PERSON_NAME');
  });
  it('corpus recall >= 90%', () => {
    const lines = readFileSync(new URL('./corpus-ner.jsonl', import.meta.url), 'utf8').trim().split('\n');
    const e = ner();
    let hit = 0;
    for (const line of lines) {
      const { text, expect: cats } = JSON.parse(line) as { text: string; expect: string[] };
      const found = new Set(e.detect(text).map((d) => d.category));
      if (cats.every((c) => found.has(c))) hit++;
    }
    expect(hit / lines.length).toBeGreaterThanOrEqual(0.9);
  });
});
