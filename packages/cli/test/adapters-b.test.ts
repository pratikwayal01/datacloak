import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply as deepseekApply } from '../adapters/deepseek/cordis';
import { register as openclawRegister } from '../adapters/openclaw/hooks';

const ROOT = new URL('../adapters/', import.meta.url).pathname;
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;
const read = (p: string) => readFileSync(ROOT + p, 'utf8');
const nonEmptyLines = (s: string) => s.split('\n').filter((l) => l.trim().length > 0).length;

const shimEnv = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dc-shim-'));
  const bin = join(dir, 'datacloak');
  writeFileSync(bin, `#!/usr/bin/env bash\nexec node "${CLI}" "$@"\n`, { mode: 0o755 });
  return { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` };
};

describe('adapters-b', () => {
  it('kilo/plugin.ts re-exports opencode-plugin hooks (shape-identical)', () => {
    const s = read('kilo/plugin.ts');
    for (const n of ['createHooks', 'sessionStats', 'applyWriteRestore', 'shouldBlock', 'loadConfig'])
      expect(s).toContain(n);
    expect(s).toContain('@pratikw/opencode-plugin');
    expect(nonEmptyLines(s)).toBeLessThanOrEqual(60);
  });
  it('openclaw/hooks.ts has before_prompt_build + before_tool_call (all tools) + after_tool_call redact', () => {
    const s = read('openclaw/hooks.ts');
    for (const n of ['before_prompt_build', 'before_tool_call', 'after_tool_call', 'datacloak', 'guard', 'cloak', 'blockReason', 'prependContext'])
      expect(s).toContain(n);
    expect(s).not.toContain('matcher');
    expect(nonEmptyLines(s)).toBeLessThanOrEqual(60);
  });
  it('hermes/plugin.py compiles and registers pre_llm_call/pre_tool_call/transform_tool_result', () => {
    const p = ROOT + 'hermes/plugin.py';
    execFileSync('python3', ['-m', 'py_compile', p]);
    const s = read('hermes/plugin.py');
    for (const n of ['def register', 'pre_llm_call', 'pre_tool_call', 'transform_tool_result', 'datacloak', 'guard', 'cloak', 'subprocess'])
      expect(s).toContain(n);
    expect(nonEmptyLines(s)).toBeLessThanOrEqual(60);
  });
  it('pi/hooks.yaml parses with user.prompt.submit + tool.before via guard.sh + tool.after observe', () => {
    const p = ROOT + 'pi/hooks.yaml';
    const r = spawnSync('python3', ['-c', 'import yaml,sys;yaml.safe_load(open(sys.argv[1]))', p], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const s = read('pi/hooks.yaml');
    for (const n of ['user.prompt.submit', 'tool.before', 'tool.after', 'guard.sh', 'observe.sh', 'modify']) expect(s).toContain(n);
    expect(nonEmptyLines(s)).toBeLessThanOrEqual(60);
    execFileSync('bash', ['-n', ROOT + 'pi/observe.sh']);
    const o = read('pi/observe.sh');
    expect(o).toContain('datacloak scan');
    expect(o).not.toMatch(/\/[a-z]+\/datacloak/);
    expect(nonEmptyLines(o)).toBeLessThanOrEqual(60);
  });
  it('pi observe.sh notes secrets but never blocks (exit 0)', () => {
    const env = shimEnv();
    const hit = spawnSync('bash', [ROOT + 'pi/observe.sh'], { input: 'key sk-abcdefghij1234567890', encoding: 'utf8', env });
    expect(hit.status).toBe(0);
    expect(hit.stdout).toContain('datacloak');
    const clean = spawnSync('bash', [ROOT + 'pi/observe.sh'], { input: 'hello world', encoding: 'utf8', env });
    expect(clean.status).toBe(0);
    expect(clean.stdout).toBe('');
  });
  it('deepseek/cordis.ts gates tools/pre-execute + agent/pre-step + tools/post-execute redact', () => {
    const s = read('deepseek/cordis.ts');
    for (const n of ['tools/pre-execute', 'agent/pre-step', 'tools/post-execute', 'datacloak', 'guard', 'cloak', 'deny']) expect(s).toContain(n);
    expect(nonEmptyLines(s)).toBeLessThanOrEqual(60);
  });
  it('aider/pre-commit passes bash -n, calls datacloak scan, exit 2 blocks', () => {
    const p = ROOT + 'aider/pre-commit';
    execFileSync('bash', ['-n', p]);
    const s = read('aider/pre-commit');
    expect(s).toContain('datacloak scan');
    expect(s).not.toMatch(/\/[a-z]+\/datacloak/);
    expect(s).toContain('exit 2');
    expect(read('aider/README.md')).toContain('datacloak scan');
  });
  // ponytail: spawnSync avoids async execFile piped-stdin hang in this sandbox
  it('aider pre-commit blocks a staged secret via datacloak from PATH', () => {
    const env = shimEnv();
    const dir = mkdtempSync(join(tmpdir(), 'dc-aider-'));
    spawnSync('git', ['init', '-q', dir]);
    writeFileSync(join(dir, '.git/hooks/pre-commit'), read('aider/pre-commit'));
    writeFileSync(join(dir, 'leak.txt'), 'key sk-abcdefghij1234567890\n');
    spawnSync('git', ['-C', dir, 'add', 'leak.txt']);
    const r = spawnSync('bash', [join(dir, '.git/hooks/pre-commit')], { cwd: dir, encoding: 'utf8', env });
    expect(r.status).toBe(2);
    writeFileSync(join(dir, 'leak.txt'), 'hello world\n');
    spawnSync('git', ['-C', dir, 'add', 'leak.txt']);
    const ok = spawnSync('bash', [join(dir, '.git/hooks/pre-commit')], { cwd: dir, encoding: 'utf8', env });
    expect(ok.status).toBe(0);
  });
  it('hermes pre_tool_call blocks env-dump via datacloak from PATH', () => {
    const env = shimEnv();
    const r = spawnSync('python3', ['-c', `
import sys; sys.path.insert(0, ${JSON.stringify(ROOT + 'hermes')});
from plugin import register;
calls = {};
class Ctx:
    def register_hook(self, name, cb): calls[name] = cb;
register(Ctx());
print(calls['pre_tool_call']('bash', {'command': 'printenv'}));
print(calls['transform_tool_result']('bash', {}, 'key sk-abcdefghij1234567890 done'));
`], { encoding: 'utf8', env });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('block');
    expect(r.stdout).not.toContain('sk-abcdefghij1234567890');
  });
  it('deepseek post-execute + openclaw after_tool_call redact via temp vault', () => {
    const shim = mkdtempSync(join(tmpdir(), 'dc-shim-'));
    writeFileSync(join(shim, 'datacloak'), `#!/usr/bin/env bash\nexec node "${CLI}" "$@"\n`, { mode: 0o755 });
    const vault = join(mkdtempSync(join(tmpdir(), 'dc-vault-')), 'vault.json');
    const oldPath = process.env.PATH;
    const oldVault = process.env.DATACLOAK_VAULT;
    process.env.PATH = `${shim}:${oldPath ?? ''}`;
    process.env.DATACLOAK_VAULT = vault;
    try {
      const ds = new Map<string, (e: any, n: () => unknown) => unknown>();
      deepseekApply({ on: (p: string, fn: any) => { ds.set(p, fn); } } as never);
      const exec: any = { tool: 'read', args: {}, result: 'key sk-abcdefghij1234567890 leaked' };
      ds.get('tools/post-execute')!(exec, () => 'next');
      expect(exec.result).not.toContain('sk-abcdefghij1234567890');
      const oc = new Map<string, (e: any) => unknown>();
      openclawRegister({ on: (h: string, fn: any) => { oc.set(h, fn); } } as never);
      const e: any = { result: 'key sk-abcdefghij1234567890 leaked' };
      oc.get('after_tool_call')!(e);
      expect(e.result).not.toContain('sk-abcdefghij1234567890');
    } finally {
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      if (oldVault === undefined) delete process.env.DATACLOAK_VAULT; else process.env.DATACLOAK_VAULT = oldVault;
    }
  });
});
