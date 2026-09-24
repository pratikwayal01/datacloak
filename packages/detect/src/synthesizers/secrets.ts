import { faker } from '@faker-js/faker';
const alnum = (n: number): string => faker.string.alphanumeric(n);
export function synthOpenAI(): string { return `sk-SYNTH${alnum(20)}`; }
export function synthAnthropic(): string { return `sk-ant-api03-SYNTH${alnum(20)}`; }
export function synthAws(): string { return `AKIA${faker.string.alphanumeric({ length: 16, casing: 'upper' })}`; }
export function synthGithub(): string { return `ghp_SYNTH${alnum(31)}`; }
export function synthStripe(prefix: string): string { return `${prefix}SYNTH${alnum(20)}`; }
export function synthJwt(): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: `synth-${faker.string.uuid()}`, iat: Date.now(), exp: Date.now() + 3600 });
  return `${header}.${body}.SYNTH${alnum(32)}`;
}
// ponytail: static throwaway PEM template; real @noble/curves keypair gen deferred to follow-up
export function synthPem(): string {
  const b64body = faker.string.alphanumeric(64);
  return `-----BEGIN RSA PRIVATE KEY-----\nSYNTH${b64body}\n-----END RSA PRIVATE KEY-----`;
}
