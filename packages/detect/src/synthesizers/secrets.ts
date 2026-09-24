import { faker } from '@faker-js/faker';
const alnum = (n: number): string => faker.string.alphanumeric(n);
export function synthOpenAI(): string { return `sk-SYNTH${alnum(20)}`; }
export function synthAnthropic(): string { return `sk-ant-api03-SYNTH${alnum(20)}`; }
export function synthAws(): string { return `AKIA${faker.string.alphanumeric({ length: 16, casing: 'upper' })}`; }
export function synthGithub(): string { return `ghp_SYNTH${alnum(31)}`; }
export function synthStripe(prefix: string): string { return `${prefix}SYNTH${alnum(20)}`; }
export function synthJwt(overrides: Record<string, unknown> = {}): string {
  const b64 = (o: object): string => {
    const s = JSON.stringify(o);
    const G = globalThis as unknown as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } };
    if (G.Buffer) return G.Buffer.from(s, 'utf8').toString('base64url');
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ sub: `synth-${faker.string.uuid()}`, iat: now, exp: now + 3600, ...overrides });
  return `${header}.${body}.SYNTH${alnum(32)}`;
}
// ponytail: static throwaway PEM template; real @noble/curves keypair gen deferred to follow-up
export function synthPem(): string {
  const b64body = faker.string.alphanumeric(64);
  return `-----BEGIN RSA PRIVATE KEY-----\nSYNTH${b64body}\n-----END RSA PRIVATE KEY-----`;
}
