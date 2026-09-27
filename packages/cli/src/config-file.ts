import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CustomPattern } from '@pratikw/detect';

export interface CliConfig { customPatterns: CustomPattern[]; }

const isPattern = (p: unknown): p is CustomPattern =>
  !!p && typeof p === 'object' &&
  typeof (p as CustomPattern).pattern === 'string' &&
  typeof (p as CustomPattern).category === 'string';

/** Precedence: --config PATH > $DATACLOAK_CONFIG > ./datacloak.json. Missing/invalid → empty. */
export function loadCliConfig(argv: string[] = process.argv.slice(2)): CliConfig {
  const i = argv.indexOf('--config');
  const candidates = [
    i >= 0 && argv[i + 1] ? argv[i + 1] : null,
    process.env.DATACLOAK_CONFIG ?? null,
    join(process.cwd(), 'datacloak.json'),
  ].filter((p): p is string => !!p);
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { customPatterns?: unknown };
      const list = Array.isArray(raw.customPatterns) ? raw.customPatterns.filter(isPattern) : [];
      return { customPatterns: list };
    } catch { /* fall through to next candidate */ }
  }
  return { customPatterns: [] };
}
