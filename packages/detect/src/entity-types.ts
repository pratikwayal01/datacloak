import { faker as defaultFaker } from '@faker-js/faker';
import { fakerFor } from './synthesizers/locale.js';
import type { CustomPattern, EntityKind, EntryType } from './types.js';

interface KindDef {
  label: string;
  category: string;
  type: EntryType;
}

export const ENTITY_KINDS: Record<EntityKind, KindDef> = {
  name: { label: 'Name', category: 'PERSON_NAME', type: 'pii' },
  employee_id: { label: 'Employee ID', category: 'EMPLOYEE_ID', type: 'pii' },
  email: { label: 'Email', category: 'EMAIL_CUSTOM', type: 'pii' },
  phone: { label: 'Phone', category: 'PHONE_CUSTOM', type: 'pii' },
  other: { label: 'Other', category: 'CUSTOM_TEXT', type: 'secret' },
};

export function isEntityKind(v: unknown): v is EntityKind {
  return typeof v === 'string' && v in ENTITY_KINDS;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const caseClass = (ch: string): string => {
  if (ch >= 'a' && ch <= 'z') return `[${ch.toUpperCase()}${ch}]`;
  if (ch >= 'A' && ch <= 'Z') return `[${ch}${ch.toLowerCase()}]`;
  return escapeRe(ch);
};

/**
 * Value-anchored matcher, no flags (the engine compiles flagless).
 * Only employee_id generalizes beyond the exact value (digit runs → \d);
 * every other kind matches the value itself, case-insensitively.
 */
export function matchPattern(kind: EntityKind, value: string): string {
  const parts = [...value].map((ch) => {
    if (kind === 'employee_id' && ch >= '0' && ch <= '9') return '\\d';
    if (/\s/.test(ch)) return '\\s+';
    return caseClass(ch);
  });
  // Collapse runs from adjacent whitespace chars into one \s+.
  return parts.join('').replace(/(?:\\s\+)+/g, '\\s+');
}

type CaseShape = 'upper' | 'title' | 'lower';

/** Shape of a single word against its template (letters only decide). */
function shapeWord(word: string, template: string): string {
  const t = template.replace(/[^A-Za-z]/g, '');
  if (!t) return word;
  if (t === t.toUpperCase()) return word.toUpperCase();
  if (/^[A-Z]/.test(t) && t.slice(1) === t.slice(1).toLowerCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return word.toLowerCase();
}

/**
 * Same-length, same-case-shape, same-structure fake for one matched value.
 * Random per call — session stability comes from vault reuse, not from here.
 */
export function synthesizeEntity(kind: EntityKind, original: string, locale = 'en'): string {
  const fk = locale === 'en' ? defaultFaker : fakerFor(locale);
  switch (kind) {
    case 'name':
      // Split keeping separators so spacing/punctuation survive verbatim.
      return original.split(/(\s+)/).map((part) => {
        if (part === '' || /^\s+$/.test(part)) return part;
        const gen = fk.string.alpha({ length: [...part].length, casing: 'lower' });
        return shapeWord(gen, part);
      }).join('');
    case 'employee_id':
    case 'phone':
      // Digits randomized, every separator kept in place.
      return [...original].map((ch) => (
        ch >= '0' && ch <= '9' ? fk.string.numeric({ length: 1, allowLeadingZeros: true }) : ch
      )).join('');
    case 'email': {
      const at = original.lastIndexOf('@');
      if (at <= 0) return fk.string.alphanumeric(Math.max(original.length, 1)).toLowerCase();
      const local = fk.string.alphanumeric(at).toLowerCase();
      return `${local}${original.slice(at)}`;
    }
    case 'other':
      // Per-char class preserved: letters → letters (case kept), digits → digits.
      return [...original].map((ch) => {
        if (ch >= 'a' && ch <= 'z') return fk.string.alpha({ length: 1, casing: 'lower' });
        if (ch >= 'A' && ch <= 'Z') return fk.string.alpha({ length: 1, casing: 'upper' });
        if (ch >= '0' && ch <= '9') return fk.string.numeric({ length: 1, allowLeadingZeros: true });
        return ch;
      }).join('');
  }
}

/** Expand a UI-supplied value+kind into a full engine-ready CustomPattern. */
export function expandEntityPattern(value: string, kind: EntityKind): CustomPattern {
  const def = ENTITY_KINDS[kind];
  return { name: value, pattern: matchPattern(kind, value), category: def.category, type: def.type, kind };
}
