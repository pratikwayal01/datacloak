import { faker as defaultFaker, type Faker } from '@faker-js/faker';
export function synthEmail(fk: Faker = defaultFaker): string { return fk.internet.email(); }
export function synthPhoneUS(fk: Faker = defaultFaker): string { return `(${fk.string.numeric(3)}) 555-01${fk.string.numeric(2)}`; }
// ponytail: fictional ranges for all locales (never emit a real number) —
// US 555-01 and Ofcom +44770090; no verified fictional ranges exist for de/fr/en_IN,
// so locale value lives in names/emails, not phone shapes.
export function synthPhoneE164(fk: Faker = defaultFaker, _locale = 'en'): string {
  return `+44770090${fk.string.numeric(4)}`;
}
export function synthIpv4(): string { return defaultFaker.internet.ipv4(); }
