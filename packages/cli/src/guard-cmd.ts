import { DataCloakEngine } from '@pratikw/detect';
import { defaultVaultPath, loadInto } from './vault-file.js';

export type GuardOut = { decision: 'allow' | 'deny' | 'rewrite'; reason?: string; args?: unknown };

const ENV_DUMP = [/(^|[;&|]\s*)printenv\b/, /(^|[;&|]\s*)env\b/, /echo\s+\$[A-Za-z_]/, /~\/\.ssh\//, /~\/\.aws\/credentials/, /\.env\b/];
const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'write_file', 'edit_file', 'apply_patch']);

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
  const engine = new DataCloakEngine();
  loadInto(engine, vaultPathForGuard());
  return engine;
};
