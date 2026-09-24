import { spawnSync } from 'node:child_process';

// OpenClaw datacloak adapter: every check shells out to `datacloak` from PATH.
type Ctx = { on: (hook: string, fn: (e: any) => any, opts?: any) => void };

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

export const register = (api: Ctx): void => {
  api.on('before_prompt_build', (e: any) => {
    const d = guard({ event: 'prompt', text: e.prompt ?? '' });
    if (d.decision === 'deny') return { prependContext: `[datacloak] prompt blocked: ${d.reason ?? 'secret detected'}` };
    return undefined;
  });
  api.on('before_tool_call', (e: any) => {
    const d = guard({ event: 'tool', tool: e.tool ?? e.name ?? '', args: e.params ?? {} });
    if (d.decision === 'deny') return { block: true, blockReason: d.reason ?? 'denied by datacloak' };
    if (d.decision === 'rewrite') return { params: d.args };
    return undefined;
  }); // ponytail: unfiltered — guard already allow-lists per tool, one path for all tools
  api.on('after_tool_call', (e: any) => {
    for (const k of ['result', 'output'] as const) {
      if (typeof e[k] === 'string' && e[k].length > 0) e[k] = cloak(e[k]);
    }
    return undefined;
  });
};
