import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// ponytail: opt-in live smoke (DATACLOAK_SMOKE=1) — asserts `datacloak`
// resolves on PATH (npm link or PATH shim to dist/cli.js, see task-5 report)
// and each harness CLI exists. Live prompt scenarios run manually per report.
const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { encoding: 'utf8' });

describe.skipIf(!process.env.DATACLOAK_SMOKE)('smoke', () => {
  it('datacloak resolves on PATH', () => {
    const r = run('datacloak', ['scan']);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0); // empty stdin = clean
  });
  for (const [bin, args] of [
    ['claude', ['--version']],
    ['gemini', ['--version']],
    ['hermes', ['--version']],
  ] as [string, string[]][]) {
    it(`${bin} --version`, () => {
      const r = run(bin, args);
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(0);
    });
  }
});
