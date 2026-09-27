export type ToolMode = 'warn' | 'block' | 'allow';
export interface ResolvedConfig {
  enabled: boolean;
  mode: ToolMode;
  detection: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean; entropyThreshold: number };
  vault: { maxEntries: number };
  allowPaths: string[];
  blockPaths: string[];
  customPatterns: { name: string; pattern: string; category: string; type: 'pii' | 'secret' | 'credential'; synthesizer?: string }[];
  notifications: { onDetection: boolean; onBlock: boolean };
}
export const defaultResolvedConfig: ResolvedConfig = {
  enabled: true,
  mode: 'warn',
  detection: { secrets: true, envVars: true, pii: true, entropy: true, entropyThreshold: 4.5 },
  vault: { maxEntries: 2000 },
  allowPaths: ['.env.example', 'fixtures/**'],
  blockPaths: ['.env', '.env.local', '**/*.pem', '~/.ssh/**'],
  customPatterns: [],
  notifications: { onDetection: true, onBlock: true },
};

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function readJson(path: string): Partial<ResolvedConfig> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<ResolvedConfig>;
  } catch {
    return {};
  }
}

export function loadConfig(cwd: string = process.cwd()): ResolvedConfig {
  const base = defaultResolvedConfig;
  const user = readJson(join(homedir(), '.config', 'datacloak', 'config.json'));
  const project = readJson(join(cwd, '.opencode', 'datacloak.json'));
  const merged: ResolvedConfig = {
    ...base, ...user, ...project,
    detection: { ...base.detection, ...user.detection, ...project.detection },
    vault: { ...base.vault, ...user.vault, ...project.vault },
    notifications: { ...base.notifications, ...user.notifications, ...project.notifications },
  };
  if (process.env.DATACLOAK_ENABLED === 'false' || process.env.DATACLOAK_ENABLED === '0') merged.enabled = false;
  const mode = process.env.DATACLOAK_MODE;
  if (mode === 'warn' || mode === 'block' || mode === 'allow') merged.mode = mode;
  const thr = Number(process.env.DATACLOAK_ENTROPY_THRESHOLD);
  if (Number.isFinite(thr)) merged.detection.entropyThreshold = thr;
  const max = Number(process.env.DATACLOAK_MAX_ENTRIES);
  if (Number.isFinite(max) && max > 0) merged.vault.maxEntries = Math.floor(max);
  return merged;
}
