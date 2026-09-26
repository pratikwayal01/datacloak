import { describe, expect, it, vi } from 'vitest';
import { synthesize } from '../src/synthesizers/index.js';
import { fakerFor } from '../src/synthesizers/locale.js';
import { synthesizeDsn } from '../src/synthesizers/credentials.js';
import { synthJwt } from '../src/synthesizers/secrets.js';
import { opaqueToken } from '../src/tokens.js';

describe('synthesize', () => {
  it('email stays an email, different value', () => {
    const s = synthesize('EMAIL', 'john.doe@acme.com');
    expect(s).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(s).not.toBe('john.doe@acme.com');
  });
  it('openai key keeps prefix with SYNTH infix', () => {
    const s = synthesize('API_KEY_OPENAI', 'sk-abcdefghij1234567890');
    expect(s.startsWith('sk-SYNTH')).toBe(true);
    expect(synthesize('API_KEY_OPENAI', 'sk-proj-7fK9mQ2xR4vN8cL1pT6yW3aB5dE0').startsWith('sk-proj-SYNTH')).toBe(true);
  });
  it('aws key keeps AKIA shape', () => {
    expect(synthesize('AWS_ACCESS_KEY', 'AKIAIOSFODNN7EXAMPLE')).toMatch(/^AKIA[0-9A-Z]{16}$/);
  });
  it('dsn preserves protocol and port', () => {
    const s = synthesizeDsn('postgres://alice:s3cr3t@db.prod.acme.com:5432/users');
    expect(s.startsWith('postgres://')).toBe(true);
    expect(s).toContain(':5432/');
    expect(s).not.toContain('alice');
  });
  it('fallback token is bracketed', () => {
    expect(opaqueToken('EMPLOYEE_ID')).toMatch(/^\[EMPLOYEE_ID_[A-Z0-9]{6}\]$/);
  });
  it('us phone uses fictional 555-01 range', () => {
    expect(synthesize('PHONE_US', '(212) 555-1234')).toMatch(/^\(\d{3}\) 555-01\d{2}$/);
  });
  it('e164 phone uses ofcom drama range', () => {
    expect(synthesize('PHONE_E164', '+14155552671')).toMatch(/^\+44770090\d{4}$/);
  });
  it('jwt round-trips non-latin1 claim without throwing', () => {
    const t = synthJwt({ sub: 'synth-Müller' });
    const payload = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.sub).toBe('synth-Müller');
    expect(payload.exp - payload.iat).toBe(3600);
  });
});

describe('locale-aware synthesis', () => {
  it('caches faker per locale, distinct instances per locale', () => {
    expect(fakerFor('en')).toBe(fakerFor('en'));
    expect(fakerFor('de')).toBe(fakerFor('de'));
    expect(fakerFor('de')).not.toBe(fakerFor('en'));
  });
  it('unknown locale warns on stderr and falls back to en', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(fakerFor('xx-unknown')).toBe(fakerFor('en'));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('xx-unknown'));
    err.mockRestore();
  });
  it('fr emails use .fr domains', () => {
    const mails = Array.from({ length: 20 }, () => synthesize('EMAIL', 'a@b.com', 'fr')!);
    for (const m of mails) expect(m).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(mails.some((m) => m.endsWith('.fr'))).toBe(true);
  });
  it('en_IN names come from a different pool than en', () => {
    const en = Array.from({ length: 30 }, () => synthesize('PERSON_NAME', 'John Doe', 'en')!);
    const inNames = Array.from({ length: 30 }, () => synthesize('PERSON_NAME', 'John Doe', 'en_IN')!);
    const shared = inNames.filter((n) => en.includes(n)).length;
    expect(shared).toBeLessThan(8);
  });
  it('e164 phones use fictional ofcom range for all locales', () => {
    for (const loc of ['en', 'de', 'fr', 'en_IN']) {
      for (let i = 0; i < 5; i++) {
        expect(synthesize('PHONE_E164', '+14155552671', loc)).toMatch(/^\+44770090\d{4}$/);
      }
    }
  });
  it('default locale stays backward-compatible', () => {
    expect(synthesize('EMAIL', 'john.doe@acme.com')).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(synthesize('PHONE_US', '(212) 555-1234')).toMatch(/^\(\d{3}\) 555-01\d{2}$/);
  });
});
