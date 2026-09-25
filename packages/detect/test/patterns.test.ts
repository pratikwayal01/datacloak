import { describe, expect, it } from 'vitest';
import { detectPass1 } from '../src/patterns/index.js';

const cats = (t: string) => detectPass1(t, { secrets: true, envVars: true, pii: true }).map((d) => d.category);

describe('detectPass1', () => {
  it('finds openai key and email', () => {
    const ds = detectPass1('key sk-abcdefghij1234567890 mail john.doe@acme.com', { secrets: true, envVars: true, pii: true });
    expect(cats('key sk-abcdefghij1234567890')).toContain('API_KEY_OPENAI');
    expect(ds.find((d) => d.category === 'EMAIL')?.value).toBe('john.doe@acme.com');
  });
  it('finds openai proj and svcacct keys', () => {
    expect(cats('key sk-proj-7fK9mQ2xR4vN8cL1pT6yW3aB5dE0hG9jS2uI4oP8nM6qZ1xC3 end')).toContain('API_KEY_OPENAI');
    expect(cats('key sk-svcacct-7fK9mQ2xR4vN8cL1pT6yW3aB5dE0hG9 end')).toContain('API_KEY_OPENAI');
  });
  it('finds aws key, jwt, ipv4, e164', () => {
    expect(cats('x AKIAIOSFODNN7EXAMPLE y')).toContain('AWS_ACCESS_KEY');
    expect(cats('t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_5NTkZBfQfRXNVIo z')).toContain('JWT');
    expect(cats('host 192.168.1.104 up')).toContain('IPV4');
    expect(cats('call +447700900123 now')).toContain('PHONE_E164');
  });
  it('finds github classic pat (36 chars after prefix)', () => {
    expect(cats('tok ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890 end')).toContain('GITHUB_PAT');
  });
  it('de-overlaps: DSN wins over inner password', () => {
    const ds = detectPass1('postgres://alice:s3cr3t@db.prod.acme.com:5432/users', { secrets: true, envVars: true, pii: true });
    expect(ds).toHaveLength(1);
    expect(ds[0].category).toBe('DSN_POSTGRES');
  });
  it('env match exposes value span only', () => {
    const ds = detectPass1('DATABASE_URL=postgres://a:b@h:5432/d', { secrets: true, envVars: true, pii: true });
    const env = ds.find((d) => d.category === 'ENV_VAR');
    expect(env?.value).toBe('postgres://a:b@h:5432/d');
  });
  it('respects disabled flags', () => {
    expect(detectPass1('john.doe@acme.com', { secrets: true, envVars: true, pii: false })).toHaveLength(0);
  });
  it('throws loudly on invalid custom pattern', () => {
    expect(() => detectPass1('x', { secrets: true, envVars: true, pii: true }, [{ name: 'bad', pattern: '([', category: 'X', type: 'pii' }])).toThrow(/bad/);
  });
});
