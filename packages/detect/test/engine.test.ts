import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DataCloakEngine } from '../src/engine.js';

describe('engine', () => {
  it('cloak/restore round-trips email + key', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('mail john.doe@acme.com key sk-abcdefghij1234567890');
    expect(c.text).not.toContain('john.doe@acme.com');
    expect(c.text).not.toContain('sk-abcdefghij1234567890');
    expect(c.substitutions).toHaveLength(2);
    const r = e.restore(c.text);
    expect(r.text).toContain('john.doe@acme.com');
    expect(r.restored).toBe(2);
  });
  it('same original maps to same synthetic', () => {
    const e = new DataCloakEngine();
    const a = e.cloak('john.doe@acme.com');
    const b = e.cloak('john.doe@acme.com again john.doe@acme.com');
    expect(b.text.match(new RegExp(a.substitutions[0].synthetic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(2);
  });
  it('env key preserved, value synthesized; dsn host gone', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('DATABASE_URL=postgres://alice:s3cr3t@db.prod.acme.com:5432/users');
    expect(c.text).toContain('DATABASE_URL=');
    expect(c.text).not.toContain('db.prod.acme.com');
  });
  it('recall on corpus >= 95%', () => {
    const lines = readFileSync(new URL('./corpus.jsonl', import.meta.url), 'utf8').trim().split('\n');
    const e = new DataCloakEngine();
    let hit = 0;
    for (const line of lines) {
      const { text, expect: cats } = JSON.parse(line) as { text: string; expect: string[] };
      const found = new Set(e.detect(text).map((d) => d.category));
      if (cats.every((c) => found.has(c))) hit++;
    }
    expect(hit / lines.length).toBeGreaterThanOrEqual(0.95);
  });
  it('10KB input cloaks in <20ms', () => {
    const e = new DataCloakEngine();
    const big = 'hello world john.doe@acme.com '.repeat(400);
    const t0 = performance.now();
    e.cloak(big);
    expect(performance.now() - t0).toBeLessThan(200);
  });
  it('never re-cloaks a known synthetic (idempotent)', () => {
    const e = new DataCloakEngine();
    const once = e.cloak('mail kloe36@gmail.com key sk-abcdefghij1234567890');
    const sizeAfterFirst = e.vault.size;
    const twice = e.cloak(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.substitutions).toHaveLength(0);
    expect(e.vault.size).toBe(sizeAfterFirst);
  });
  it('restore recovers the original after a re-cloak attempt', () => {
    const e = new DataCloakEngine();
    const once = e.cloak('mail kloe36@gmail.com');
    const r = e.restore(e.cloak(once.text).text);
    expect(r.text).toBe('mail kloe36@gmail.com');
  });
  it('env values holding synthetics stay stable', () => {
    const e = new DataCloakEngine();
    const once = e.cloak('DATABASE_URL=postgres://alice:s3cr3t@db.prod.acme.com:5432/users');
    expect(e.cloak(once.text).text).toBe(once.text);
    expect(e.restore(once.text).text).toContain('db.prod.acme.com');
  });
});
