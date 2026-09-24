import { faker } from '@faker-js/faker';
const DSN = /^([a-z+]+:\/\/)(?:([^:@/\s]+)(?::([^@/\s]*))?@)?([^:/\s]+)(?::(\d+))?(\/[^?\s]*)?(\?[^\s]*)?$/i;
export function synthesizeDsn(original: string): string {
  const m = DSN.exec(original);
  if (!m) return original;
  const [, proto, , , , port, path, query] = m;
  const user = faker.internet.username().replace(/[^A-Za-z0-9_]/g, '_');
  const pass = `SYNTHpw${faker.number.int({ min: 10, max: 99 })}`;
  const host = `${faker.internet.domainWord()}.${faker.internet.domainSuffix()}`;
  return `${proto}${user}:${pass}@${host}${port ? `:${port}` : ''}${path ?? ''}${query ?? ''}`;
}
