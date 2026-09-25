import { faker } from '@faker-js/faker';
import { synthEmail, synthIpv4, synthPhoneE164, synthPhoneUS } from './pii.js';
import { synthAnthropic, synthAws, synthGithub, synthJwt, synthOpenAI, synthPem, synthStripe } from './secrets.js';
import { synthesizeDsn } from './credentials.js';

export function synthesize(category: string, original: string): string | null {
  switch (category) {
    case 'EMAIL': return synthEmail();
    case 'PHONE_US': return synthPhoneUS();
    case 'PHONE_E164': return synthPhoneE164();
    case 'IPV4': return synthIpv4();
    case 'API_KEY_OPENAI': return synthOpenAI();
    case 'API_KEY_ANTHROPIC': return synthAnthropic();
    case 'AWS_ACCESS_KEY': return synthAws();
    case 'GITHUB_PAT': return synthGithub();
    case 'STRIPE_KEY': return synthStripe(original.startsWith('rk_live_') ? 'rk_live_' : 'sk_live_');
    case 'JWT': return synthJwt();
    case 'PEM_KEY': return synthPem();
    case 'PERSON_NAME': return faker.person.fullName();
    case 'STREET_ADDRESS': return faker.location.streetAddress(true);
    case 'DATE_OF_BIRTH': return faker.date.birthdate().toISOString().slice(0, 10);
    case 'DSN_POSTGRES': case 'DSN_MONGO': case 'DSN_REDIS': case 'DSN_MYSQL': case 'DSN_AMQP': return synthesizeDsn(original);
    default: return null;
  }
}
