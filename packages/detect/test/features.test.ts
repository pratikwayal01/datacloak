import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataCloakEngine } from '../src/engine.js';
import { cloakFile } from '../src/files.js';

describe('audit', () => {
  it('previews without vault writes', () => {
    const e = new DataCloakEngine();
    const r = e.audit('mail john.doe@acme.com key sk-abcdefghij1234567890');
    expect(r.detections.map((d) => d.category)).toContain('EMAIL');
    expect(r.preview).toMatch(/\[EMAIL_1\]/);
    expect(r.preview).not.toContain('john.doe@acme.com');
    expect(e.vault.size).toBe(0);
  });
});

describe('cloakJson', () => {
  it('cloaks leaves, preserves shape', () => {
    const e = new DataCloakEngine();
    const r = e.cloakJson({ user: { email: 'john.doe@acme.com', age: 30, tags: ['a', 'sk-abcdefghij1234567890'] } });
    expect((r.value as { user: { email: string } }).user.email).not.toContain('john.doe@acme.com');
    expect((r.value as { user: { age: number } }).user.age).toBe(30);
    expect(r.substitutions.length).toBe(2);
    expect(e.restore((r.value as { user: { email: string } }).user.email).text).toContain('john.doe@acme.com');
  });
  it('skips cycles and class instances', () => {
    const e = new DataCloakEngine();
    const o: Record<string, unknown> = { a: 'john.doe@acme.com' };
    o.self = o;
    expect(() => e.cloakJson(o)).not.toThrow();
    expect(e.cloakJson({ d: new Date('2020-01-01') }).value).toEqual({ d: new Date('2020-01-01') });
  });
  it('cloaks cyclic refs without leaking original', () => {
    const e = new DataCloakEngine();
    const o: Record<string, unknown> = { email: 'john.doe@acme.com' };
    o.self = o;
    const r = e.cloakJson(o);
    const out = r.value as Record<string, unknown>;
    expect(out.email).not.toContain('john.doe@acme.com');
    expect((out.self as Record<string, unknown>).email).not.toContain('john.doe@acme.com');
    expect(out.self).toBe(out);
  });
  it('cloaks null-prototype objects', () => {
    const e = new DataCloakEngine();
    const inner: Record<string, unknown> = Object.create(null);
    inner.email = 'john.doe@acme.com';
    const outer: Record<string, unknown> = Object.create(null);
    outer.nested = inner;
    const r = e.cloakJson(outer);
    expect((r.value as Record<string, Record<string, string>>).nested.email).not.toContain('john.doe@acme.com');
    expect(r.substitutions.length).toBe(1);
  });
});

describe('cloakFile', () => {
  it('.txt round-trip via restore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const p = join(dir, 'a.txt');
    writeFileSync(p, 'mail john.doe@acme.com');
    const e = new DataCloakEngine();
    const r = await cloakFile(e, p);
    expect(r.text).not.toContain('john.doe@acme.com');
    expect(r.substitutions.length).toBe(1);
    expect(e.restore(r.text).text).toContain('john.doe@acme.com');
  });
  it('.json preserves shape + restore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const p = join(dir, 'a.json');
    writeFileSync(p, JSON.stringify({ email: 'john.doe@acme.com', n: 1 }));
    const e = new DataCloakEngine();
    const r = await cloakFile(e, p);
    const parsed = JSON.parse(r.text) as { email: string; n: number };
    expect(parsed.n).toBe(1);
    expect(parsed.email).not.toContain('john.doe@acme.com');
    expect(e.restore(parsed.email).text).toContain('john.doe@acme.com');
  });
  it('.csv handles quoted commas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const p = join(dir, 'a.csv');
    writeFileSync(p, 'name,email\n"doe, john",john.doe@acme.com');
    const e = new DataCloakEngine();
    const r = await cloakFile(e, p);
    expect(r.text).not.toContain('john.doe@acme.com');
    expect(r.text.split('\n')[1]).toMatch(/^"[^"]*,[^"]*",[^,]+$/);
  });
  it('.pdf throws fail-closed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const p = join(dir, 'a.pdf');
    writeFileSync(p, 'x');
    await expect(cloakFile(new DataCloakEngine(), p)).rejects.toThrow(/unsupported extension/);
  });
});

describe('custom entity mapping', () => {
  const emp = { name: 'Employee ID', pattern: 'EMP-[0-9]{6}', category: 'EMPLOYEE_ID', type: 'pii' as const, synthesizer: 'EMP-{{string.numeric(6)}}' };
  it('cloaks with shape-preserving fake and restores', () => {
    const e = new DataCloakEngine({ customPatterns: [emp] });
    const r = e.cloak('owner EMP-482913 please');
    expect(r.text).toMatch(/EMP-[0-9]{6}/);
    expect(r.text).not.toContain('EMP-482913');
    expect(e.restore(r.text).text).toContain('EMP-482913');
  });
  it('falls back to opaque without a synthesizer', () => {
    const e = new DataCloakEngine({ customPatterns: [{ name: 'x', pattern: 'XX-[0-9]+', category: 'XX_CODE', type: 'secret' }] });
    expect(e.cloak('id XX-123').text).toMatch(/\[XX_CODE_[A-Z0-9]{6}\]/);
  });
  it('bad synthesizer fails open with opaque token', () => {
    const e = new DataCloakEngine({ customPatterns: [{ ...emp, synthesizer: 'EMP-{{nope.fn(1)}}' }] });
    expect(e.cloak('owner EMP-482913').text).toMatch(/\[EMPLOYEE_ID_[A-Z0-9]{6}\]/);
  });
});

describe('synthetic vault-collision guard', () => {
  it('never reuses a synthetic the vault already knows', () => {
    const lit = (cat: string) => ({ name: cat, pattern: `${cat}-[0-9]+`, category: cat, type: 'pii' as const, synthesizer: 'FIXED-SYNTH' });
    const e = new DataCloakEngine({ customPatterns: [lit('C1'), lit('C2')] });
    const first = e.cloak('id C1-1');
    expect(first.text).toContain('FIXED-SYNTH');
    const second = e.cloak('id C2-2');
    expect(second.text).not.toContain('FIXED-SYNTH');
    expect(second.text).toMatch(/\[C2_[A-Z0-9]{6}\]/);
    // And the known synthetic is not re-cloaked as an original either.
    expect(e.cloak('saw FIXED-SYNTH today').text).toContain('FIXED-SYNTH');
  });
});

describe('restore chained entries', () => {
  it('maps each synthetic to its direct original without cascading', () => {
    const e = new DataCloakEngine();
    e.vault.set({ original: 'AAA@x.com', synthetic: 'BBB@x.com', category: 'EMAIL', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    e.vault.set({ original: 'BBB@x.com', synthetic: 'CCC@x.com', category: 'EMAIL', type: 'pii', synthesizedAt: 2, confidence: 'high' });
    expect(e.restore('hi CCC@x.com').text).toBe('hi BBB@x.com');
    expect(e.restore('hi BBB@x.com').text).toBe('hi AAA@x.com');
  });
});

describe('case-insensitive literal', () => {
  it('class-expanded pattern cloaks every case variant', () => {
    const lit = '[Rr][Aa][Mm][Ee][Ss][Hh]';
    const e = new DataCloakEngine({ customPatterns: [{ name: 'Ramesh', pattern: lit, category: 'RAMESH', type: 'pii' as const, literal: true }] });
    for (const v of ['Ramesh', 'ramesh', 'RAMESH']) {
      const r = e.cloak(`hi ${v} bye`);
      expect(r.substitutions).toHaveLength(1);
      expect(r.text).not.toContain(`hi ${v} bye`);
      expect(e.restore(r.text).text).toContain(`hi ${v} bye`);
    }
  });
});

describe('recased restore', () => {
  it('restores LLM-recased synthetics to the verbatim original', () => {
    const e = new DataCloakEngine({});
    e.vault.set({ original: 'suresh', synthetic: 'ivqtry', category: 'PERSON_NAME', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    expect(e.restore('Hi, Ivqtry!').text).toBe('Hi, suresh!');
    expect(e.restore('shout IVQTRY now').text).toBe('shout suresh now');
    expect(e.restore('hi ivqtry bye').text).toBe('hi suresh bye');
    expect(e.restore('nothing to do here').text).toBe('nothing to do here');
  });
});

describe('substitution offsets', () => {
  it('carries original-coordinates for diff highlighting', () => {
    const e = new DataCloakEngine({});
    const r = e.cloak('mail kloe36@gmail.com end');
    expect(r.substitutions).toHaveLength(1);
    const [s] = r.substitutions;
    expect('mail kloe36@gmail.com end'.slice(s.start, s.end)).toBe(s.original);
  });
});

describe('substitution confidence', () => {
  it('carries detection confidence (medium for entropy)', () => {
    const e = new DataCloakEngine({});
    const r = e.cloak('mail kloe36@gmail.com end');
    expect(r.substitutions).toHaveLength(1);
    expect(r.substitutions[0].confidence).toBe('high');
  });
});
