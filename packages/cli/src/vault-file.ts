import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DataCloakEngine } from '@pratikw/detect';

export interface FileEntry { original: string; synthetic: string; category: string; type: 'pii' | 'secret' | 'credential'; }

export function defaultVaultPath(): string {
  if (process.env.DATACLOAK_VAULT) return process.env.DATACLOAK_VAULT;
  const session = process.env.DATACLOAK_SESSION ?? 'default';
  return join(homedir(), '.config', 'datacloak', `vault-${session}.json`);
}

export function loadInto(engine: DataCloakEngine, path: string): void {
  if (!existsSync(path)) return;
  const data = JSON.parse(readFileSync(path, 'utf8')) as { version: number; entries: FileEntry[] };
  for (const e of data.entries ?? []) {
    engine.vault.set({ ...e, synthesizedAt: Date.now(), confidence: 'high' });
  }
}

export function saveFrom(engine: DataCloakEngine, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, entries: engine.vault.list() }), { mode: 0o600 });
  chmodSync(path, 0o600);
}
