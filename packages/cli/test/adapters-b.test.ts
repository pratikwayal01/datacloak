import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
  it('openclaw/hooks.ts has before_prompt_build + before_tool_call via datacloak guard', () => {
    const s = read('openclaw/hooks.ts');
    for (const n of ['before_prompt_build', 'before_tool_call', 'datacloak', 'guard', 'blockReason', 'prependContext'])
      expect(s).toContain(n);
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
  it('pi/hooks.yaml parses with user.prompt.submit + tool.before via guard.sh', () => {
    const p = ROOT + 'pi/hooks.yaml';
    const r = spawnSync('python3', ['-c', 'import yaml,sys;yaml.safe_load(open(sys.argv[1]))', p], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const s = read('pi/hooks.yaml');
    for (const n of ['user.prompt.submit', 'tool.before', 'guard.sh', 'modify']) expect(s).toContain(n);
    expect(nonEmptyLines(s)).toBeLessThanOrEqual(60);
  });
  it('deepseek/cordis.ts gates tools/pre-execute + agent/pre-step via datacloak guard', () => {
    const s = read('deepseek/cordis.ts');
    for (const n of ['tools/pre-execute', 'agent/pre-step', 'datacloak', 'guard', 'deny']) expect(s).toContain(n);
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
});
