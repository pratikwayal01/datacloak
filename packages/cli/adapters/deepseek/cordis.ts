import { spawnSync } from 'node:child_process';

// DeepSeek Cordis datacloak adapter: every check shells out to `datacloak` from PATH.
type Ctx = { on: (point: string, fn: (exec: any, next: () => any) => any) => void };

const guard = (payload: unknown): any => {
  try {
    const r = spawnSync('datacloak', ['guard'], { input: JSON.stringify(payload), encoding: 'utf8' });
    return JSON.parse(r.stdout || '{"decision":"allow"}');
  } catch { return { decision: 'allow' }; } // ponytail: fail-open, never break the agent
};

const cloak = (text: string): string => {
  try {
    // env (incl. DATACLOAK_VAULT) passes through via default spawnSync env
    const r = spawnSync('datacloak', ['cloak'], { input: text, encoding: 'utf8' });
    return r.status === 0 ? r.stdout : text;
  } catch { return text; } // ponytail: fail-open, never break the agent
};

export function apply(ctx: Ctx): void {
  ctx.on('tools/pre-execute', (exec, next) => {
    const d = guard({ event: 'tool', tool: exec.tool ?? exec.name ?? '', args: exec.args ?? {} });
    if (d.decision === 'deny') return { kind: 'deny', reason: d.reason ?? 'Denied by datacloak.' };
    if (d.decision === 'rewrite') exec.args = d.args;
    return next();
  });
  ctx.on('agent/pre-step', (exec, next) => {
    const d = guard({ event: 'prompt', text: exec.prompt ?? exec.input ?? '' });
    if (d.decision === 'deny') return { kind: 'deny', reason: d.reason ?? 'Denied by datacloak.' };
    return next();
  });
  ctx.on('tools/post-execute', (exec, next) => {
    for (const k of ['result', 'output'] as const) {
      if (typeof exec[k] === 'string' && exec[k].length > 0) exec[k] = cloak(exec[k]);
    }
    return next();
  });
}
