import { describe, expect, it } from 'vitest';
import { DataCloakEngine } from '../src/engine.js';
import {
  ENTITY_KINDS,
  expandEntityPattern,
  isEntityKind,
  matchPattern,
  synthesizeEntity,
} from '../src/entity-types.js';
import type { EntityKind } from '../src/types.js';

const matches = (kind: EntityKind, value: string, text: string): boolean =>
  new RegExp(matchPattern(kind, value), 'g').test(text);

describe('matchPattern', () => {
  it('name matches every case variant, nothing else', () => {
    for (const v of ['Ramesh', 'ramesh', 'RAMESH', 'rAmEsH']) expect(matches('name', 'Ramesh', `hi ${v} bye`)).toBe(true);
    expect(matches('name', 'Ramesh', 'hi Rammsh bye')).toBe(false);
    expect(matches('name', 'Ramesh', 'hi Ram bye')).toBe(false);
  });

  it('name flexes whitespace runs', () => {
    expect(matches('name', 'Mary Jane', 'x Mary   Jane y')).toBe(true);
    expect(matches('name', 'Mary Jane', 'x Mary Jane y')).toBe(true);
  });

  it('name escapes regex metacharacters', () => {
    expect(matches('name', 'EMP.001', 'EMP.001')).toBe(true);
    expect(matches('name', 'EMP.001', 'EMPX001')).toBe(false);
  });

  it('employee_id generalizes digit runs (accepted over-match)', () => {
    expect(matches('employee_id', 'EMP-001234', 'id EMP-001234 ok')).toBe(true);
    expect(matches('employee_id', 'EMP-001234', 'id EMP-999999 ok')).toBe(true);
    expect(matches('employee_id', 'EMP-001234', 'id EMP-ABC ok')).toBe(false);
    expect(matches('employee_id', 'EMP-001234', 'id XMP-001234 ok')).toBe(false);
  });

  it('email/phone/other match the exact value only', () => {
    expect(matches('email', 'Ramesh@Acme.com', 'mail RAMESH@ACME.COM here')).toBe(true);
    expect(matches('email', 'Ramesh@Acme.com', 'mail other@acme.com here')).toBe(false);
    expect(matches('phone', '+91 98765 43210', 'call +91 98765 43210 now')).toBe(true);
    expect(matches('phone', '+91 98765 43210', 'call +91 11111 11111 now')).toBe(false);
    expect(matches('other', 'sk-fweufuwae;ude', 'key sk-fweufuwae;ude!')).toBe(true);
    expect(matches('other', 'sk-fweufuwae;ude', 'key sk-other!')).toBe(false);
  });

  it('every compiled pattern is valid', () => {
    const kinds: EntityKind[] = ['name', 'employee_id', 'email', 'phone', 'other'];
    for (const k of kinds) expect(() => new RegExp(matchPattern(k, 'Ramesh portano-99 @x; y'))).not.toThrow();
  });
});

describe('synthesizeEntity invariants', () => {
  const cases: [EntityKind, string][] = [
    ['name', 'Ramesh'],
    ['name', 'RAMESH'],
    ['name', 'ramesh'],
    ['name', 'Mary Jane'],
    ['employee_id', 'EMP-001234'],
    ['email', 'Ramesh@Acme.com'],
    ['phone', '+91 98765 43210'],
    ['other', 'sk-fweufuwae;ude'],
    ['other', 'Acct 4821-X'],
  ];

  it('same character count as the original', () => {
    for (const [kind, original] of cases) {
      expect([...synthesizeEntity(kind, original)].length).toBe([...original].length);
    }
  });

  it('same case shape per word', () => {
    expect(synthesizeEntity('name', 'RAMESH')).toMatch(/^[A-Z]+$/);
    expect(synthesizeEntity('name', 'Ramesh')).toMatch(/^[A-Z][a-z]+$/);
    expect(synthesizeEntity('name', 'ramesh')).toMatch(/^[a-z]+$/);
    const multi = synthesizeEntity('name', 'MARY Jane');
    const [w1, w2] = multi.split(' ');
    expect(w1).toMatch(/^[A-Z]+$/);
    expect(w2).toMatch(/^[A-Z][a-z]+$/);
  });

  it('same format structure', () => {
    expect(synthesizeEntity('employee_id', 'EMP-001234')).toMatch(/^EMP-\d{6}$/);
    expect(synthesizeEntity('phone', '+91 98765 43210')).toMatch(/^\+\d\d \d{5} \d{5}$/);
    const mail = synthesizeEntity('email', 'Ramesh@Acme.com');
    expect(mail.endsWith('@Acme.com')).toBe(true);
    expect(mail.split('@')[0]).toHaveLength('Ramesh'.length);
    const pw = synthesizeEntity('other', 'sk-fweufuwae;ude');
    expect(pw.slice(0, 2)).toMatch(/^[a-z]{2}$/);
    expect(pw[2]).toBe('-');
    expect(pw.slice(3, 12)).toMatch(/^[a-z]{9}$/);
    expect(pw[12]).toBe(';');
    expect(pw.slice(13)).toMatch(/^[a-z]{3}$/);
  });

  it('name words stay alphabetic, spacing preserved', () => {
    const s = synthesizeEntity('name', 'Mary  Jane');
    expect(s).toMatch(/^[A-Za-z]+  [A-Za-z]+$/);
    expect(s.split('  ').map((w) => w.length)).toEqual([4, 4]);
  });
});

describe('expandEntityPattern', () => {
  it('fills all engine fields per kind', () => {
    expect(expandEntityPattern('Ramesh', 'name')).toEqual({
      name: 'Ramesh',
      pattern: matchPattern('name', 'Ramesh'),
      category: 'PERSON_NAME',
      type: 'pii',
      kind: 'name',
    });
    expect(expandEntityPattern('x', 'other').type).toBe('secret');
    for (const kind of Object.keys(ENTITY_KINDS) as EntityKind[]) {
      const e = expandEntityPattern('v', kind);
      expect(e.kind).toBe(kind);
      expect(() => new RegExp(e.pattern)).not.toThrow();
    }
  });

  it('isEntityKind guards unknown kinds', () => {
    expect(isEntityKind('name')).toBe(true);
    expect(isEntityKind('regex')).toBe(false);
    expect(isEntityKind(undefined)).toBe(false);
  });
});

describe('engine kind branch', () => {
  it('uses same-length fakes, stable across cloaks, round-trips', () => {
    const e = new DataCloakEngine({ customPatterns: [expandEntityPattern('Ramesh', 'name')] });
    const r1 = e.cloak('hi ramesh, meet RAMESH');
    const syns = r1.substitutions.map((s) => s.synthetic);
    expect(syns).toHaveLength(2);
    for (const s of syns) expect(s).toHaveLength(6);
    expect(r1.text).not.toContain('ramesh');
    expect(r1.text).not.toContain('RAMESH');
    // Stable: second cloak reuses the vault fakes.
    const r2 = e.cloak('ramesh again');
    expect(r2.substitutions[0].synthetic).toBe(
      r1.substitutions.find((s) => s.original === 'ramesh')?.synthetic,
    );
    expect(e.restore(r1.text).text).toContain('hi ramesh, meet RAMESH');
  });

  it('employee_id keeps prefix, randomizes digits', () => {
    const e = new DataCloakEngine({ customPatterns: [expandEntityPattern('EMP-001234', 'employee_id')] });
    const r = e.cloak('id EMP-001234 and EMP-999999 end');
    expect(r.substitutions).toHaveLength(2);
    for (const s of r.substitutions.map((x) => x.synthetic)) expect(s).toMatch(/^EMP-\d{6}$/);
    expect(e.restore(r.text).text).toContain('EMP-001234');
  });
});
