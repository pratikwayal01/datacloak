import { faker } from '@faker-js/faker';
export function synthEmail(): string { return faker.internet.email(); }
export function synthPhoneUS(): string { return `(${faker.string.numeric(3)}) 555-01${faker.string.numeric(2)}`; }
export function synthPhoneE164(): string { return `+44770090${faker.string.numeric(4)}`; }
export function synthIpv4(): string { return faker.internet.ipv4(); }
