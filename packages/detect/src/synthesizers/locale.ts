import { Faker, de, en, en_IN, fr } from '@faker-js/faker';

// Supported locales: en, de, fr, en_IN. Detection is locale-independent (unchanged).
const LOCALES: Record<string, [unknown, unknown?]> = { en: [en], de: [de], fr: [fr], en_IN: [en_IN, en] };
const cache = new Map<string, Faker>();
export function fakerFor(locale = 'en'): Faker {
  const key = LOCALES[locale] ? locale : 'en';
  if (key !== locale) console.error(`[datacloak] unknown locale ${locale}, falling back to en`);
  let f = cache.get(key);
  if (!f) { f = new Faker({ locale: LOCALES[key] as never }); cache.set(key, f); }
  return f;
}
