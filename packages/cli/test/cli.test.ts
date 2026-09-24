import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

const cli = (args: string[], input: string, env: Record<string, string> = {}) =>
  run('node', [CLI, ...args], { input, env: { ...process.env, ...env } }).then(
    (r) => ({ code: 0, stdout: r.stdout as string, stderr: r.stderr as string }),
    (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }),
  );

describe('cli', () => {
  it('cloak round-trips through a vault file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-'));
    const vault = join(dir, 'v.json');
    const c = await cli(['cloak', '--vault', vault], 'mail john.doe@acme.com');
    expect(c.code).toBe(0);
    expect(c.stdout).not.toContain('john.doe@acme.com');
    expect(statSync(vault).mode & 0o777).toBe(0o600);
    const r = await cli(['restore', '--vault', vault], c.stdout);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('mail john.doe@acme.com');
  });
  it('scan exits 2 on detection, 0 when clean', async () => {
    expect((await cli(['scan'], 'key sk-abcdefghij1234567890')).code).toBe(2);
    expect((await cli(['scan'], 'hello world')).code).toBe(0);
  });
});
