import { faker as defaultFaker, type Faker } from '@faker-js/faker';
import { fakerFor } from './locale.js';

type Fn = (fk: Faker, args: number[]) => string;

const FUNCS: Record<string, Fn> = {
  'string.numeric': (fk, [n]) => fk.string.numeric({ length: n }),
  'string.alphanumeric': (fk, [n]) => fk.string.alphanumeric(n),
  'number.int': (fk, [min, max]) => String(fk.number.int({ min, max })),
  'person.firstName': (fk) => fk.person.firstName(),
  'person.lastName': (fk) => fk.person.lastName(),
};

export function renderSynthesizer(template: string, fk: Faker = defaultFaker): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\(([^)]*)\)\s*\}\}/g, (m, fn: string, rawArgs: string) => {
    const impl = FUNCS[fn];
    if (!impl) throw new Error(`datacloak: unknown synthesizer expression ${fn}`);
    const args = rawArgs.split(',').map((a) => Number(a.trim()));
    if (args.some((a) => !Number.isFinite(a))) throw new Error(`datacloak: bad args in ${m}`);
    return impl(fk, args);
  });
}

/** Render a template with the right locale's faker instance. */
export function synthesizeCustom(template: string, locale = 'en'): string {
  return renderSynthesizer(template, locale === 'en' ? defaultFaker : fakerFor(locale));
}
