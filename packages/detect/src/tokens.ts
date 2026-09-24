import { faker } from '@faker-js/faker';
export function opaqueToken(category: string): string {
  return `[${category.toUpperCase()}_${faker.string.alphanumeric({ length: 6, casing: 'upper' })}]`;
}
