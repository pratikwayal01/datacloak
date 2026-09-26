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
