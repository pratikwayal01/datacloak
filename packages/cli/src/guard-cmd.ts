import { DataCloakEngine } from '@pratikw/detect';
import { defaultVaultPath, loadInto } from './vault-file.js';
import { loadCliConfig } from './config-file.js';

export type GuardOut = { decision: 'allow' | 'deny' | 'rewrite'; reason?: string; args?: unknown };

const ENV_DUMP = [/(^|[;&|]\s*)printenv\b/, /(^|[;&|]\s*)env\b/, /echo\s+\$[A-Za-z_]/, /~\/\.ssh\//, /~\/\.aws\/credentials/, /\.env\b/];
const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'write_file', 'edit_file', 'apply_patch']);
const READ_TOOLS = new Set(['read', 'read_file']);
// ponytail: inline */** glob, same approach as opencode-plugin guard.ts
const SENSITIVE_GLOBS = ['.env', '.env.local', '**/.env', '**/.env.local', '*.pem', '**/*.pem', '~/.ssh/**', '**/.ssh/**', '*credentials*', '**/*credentials*'];

const globToRegExp = (glob: string): RegExp => {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
};

export const isSensitivePath = (p: string): boolean => SENSITIVE_GLOBS.some((g) => globToRegExp(g).test(p));

export function guard(incoming: { event: string; text?: string; tool?: string; args?: Record<string, unknown> }, engine: DataCloakEngine): { out: GuardOut; code: number } {
  if (incoming.event === 'prompt' && typeof incoming.text === 'string') {
    const found = engine.detect(incoming.text);
    if (found.length === 0) return { out: { decision: 'allow' }, code: 0 };
    const cats = [...new Set(found.map((d) => d.category))].join(', ');
    return { out: { decision: 'deny', reason: `datacloak: ${cats} in prompt` }, code: 2 };
  }
  if (incoming.event === 'tool') {
    const cmd = (incoming.args as Record<string, unknown> | undefined)?.command;
    if (typeof cmd === 'string' && ENV_DUMP.some((re) => re.test(cmd))) {
      return { out: { decision: 'deny', reason: 'datacloak: blocked env-dump command' }, code: 2 };
    }
    const fp = (incoming.args as Record<string, unknown> | undefined)?.filePath;
    if (incoming.tool && READ_TOOLS.has(incoming.tool) && typeof fp === 'string' && isSensitivePath(fp)) {
      return { out: { decision: 'deny', reason: 'datacloak: blocked sensitive read' }, code: 2 };
    }
    if (incoming.tool && WRITE_TOOLS.has(incoming.tool) && incoming.args && typeof incoming.args === 'object') {
      let rewrote = false;
      for (const [k, v] of Object.entries(incoming.args)) {
        if (k === 'filePath' || typeof v !== 'string') continue;
        const r = engine.restore(v);
        if (r.restored > 0) { (incoming.args as Record<string, unknown>)[k] = r.text; rewrote = true; }
      }
      if (rewrote) return { out: { decision: 'rewrite', args: incoming.args }, code: 0 };
    }
    return { out: { decision: 'allow' }, code: 0 };
  }
  return { out: { decision: 'allow' }, code: 0 };
}

export const vaultPathForGuard = (): string => process.env.DATACLOAK_VAULT ?? defaultVaultPath();

export const loadGuardEngine = (): DataCloakEngine => {
  const engine = new DataCloakEngine({ customPatterns: loadCliConfig().customPatterns });
  loadInto(engine, vaultPathForGuard());
  return engine;
};
