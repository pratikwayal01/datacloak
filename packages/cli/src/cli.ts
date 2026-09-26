#!/usr/bin/env node
import { DataCloakEngine } from '@pratikw/detect';
import { defaultVaultPath, loadInto, saveFrom } from './vault-file.js';
import { loadCliConfig } from './config-file.js';

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
  const engine = new DataCloakEngine({ customPatterns: loadCliConfig(process.argv.slice(2)).customPatterns });
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
  if (cmd === 'guard') {
    const { guard, loadGuardEngine } = await import('./guard-cmd.js');
    const raw = await readStdin();
    let incoming: { event: string };
    try {
      incoming = JSON.parse(raw) as { event: string };
    } catch {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      return 0;
    }
    const { out, code } = guard(incoming as never, loadGuardEngine());
    process.stdout.write(JSON.stringify(out));
    return code;
  }
  if (cmd === 'install-shell') {
    const shell = rest[rest.indexOf('--shell') + 1] ?? 'bash';
    const names: Record<string, string> = { bash: 'preexec.sh', zsh: 'preexec.zsh', fish: 'preexec.fish' };
    const { readFileSync } = await import('node:fs');
    const file = new URL(`../shell/${names[shell] ?? 'preexec.sh'}`, import.meta.url);
    process.stdout.write(readFileSync(file, 'utf8'));
    return 0;
  }
  process.stderr.write('usage: datacloak <cloak|restore|scan|guard|install-shell> [--vault PATH] [--config PATH]\n');
  return 1;
};

main().then(
  (code) => process.exit(code),
  (err) => { process.stderr.write(`datacloak: ${(err as Error).message}\n`); process.exit(1); },
);
