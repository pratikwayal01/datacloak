import { describe, expect, it } from 'vitest';
import { DataCloakEngine } from '../src/engine.js';

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
