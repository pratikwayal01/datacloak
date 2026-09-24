#!/usr/bin/env node
import { DataCloakEngine } from '@pratikw/detect';
import { defaultVaultPath, loadInto, saveFrom } from './vault-file.js';

const readStdin = async (): Promise<string> => {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s;
};

const vaultFlag = (argv: string[]): string => {
  const i = argv.indexOf('--vault');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : defaultVaultPath();
};

const main = async (): Promise<number> => {
  const [cmd, ...rest] = process.argv.slice(2);
  const engine = new DataCloakEngine();
  if (cmd === 'cloak') {
    const path = vaultFlag(rest);
    loadInto(engine, path);
    const r = engine.cloak(await readStdin());
    saveFrom(engine, path);
    process.stdout.write(r.text);
    return 0;
  }
  if (cmd === 'restore') {
    loadInto(engine, vaultFlag(rest));
    process.stdout.write(engine.restore(await readStdin()).text);
    return 0;
  }
  if (cmd === 'scan') {
    const found = engine.detect(await readStdin());
    if (found.length === 0) return 0;
    if (!rest.includes('--quiet')) {
      const cats = [...new Set(found.map((d) => d.category))].join(', ');
      process.stderr.write(`datacloak: detected ${found.length} (${cats})\n`);
    }
    return 2;
  }
  process.stderr.write('usage: datacloak <cloak|restore|scan|guard|install-shell> [--vault PATH]\n');
  return 1;
};

main().then(
  (code) => process.exit(code),
  (err) => { process.stderr.write(`datacloak: ${(err as Error).message}\n`); process.exit(1); },
);
