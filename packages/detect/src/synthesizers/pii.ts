import { faker as defaultFaker, type Faker } from '@faker-js/faker';
export function synthEmail(fk: Faker = defaultFaker): string { return fk.internet.email(); }
export function synthPhoneUS(fk: Faker = defaultFaker): string { return `(${fk.string.numeric(3)}) 555-01${fk.string.numeric(2)}`; }
// ponytail: US fictional 555-01 range kept for all locales (never emits a real number);
// E.164 uses the locale's real phone format off-en (shape varies, still synthetic-looking).
export function synthPhoneE164(fk: Faker = defaultFaker, locale = 'en'): string {
  if (locale !== 'en') return fk.phone.number();
  return `+44770090${fk.string.numeric(4)}`;
}
export function synthIpv4(): string { return defaultFaker.internet.ipv4(); }
