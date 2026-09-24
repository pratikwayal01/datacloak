import { faker } from '@faker-js/faker';
export function synthEmail(): string { return faker.internet.email(); }
export function synthPhoneUS(): string { return faker.phone.number({ style: 'national' }); }
export function synthPhoneE164(): string { return faker.phone.number({ style: 'international' }); }
export function synthIpv4(): string { return faker.internet.ipv4(); }
