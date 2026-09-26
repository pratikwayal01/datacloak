import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

// ponytail: spawnSync with input avoids async execFile piped-stdin hang in this sandbox
const cli = (args: string[], input: string, env: Record<string, string> = {}) => {
  const r = spawnSync('node', [CLI, ...args], { input, env: { ...process.env, ...env }, encoding: 'utf8' });
  return Promise.resolve({ code: r.status ?? 1, stdout: r.stdout as string, stderr: r.stderr as string });
};

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
  it('cloak starts empty on corrupt vault, stderr names path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-'));
    const vault = join(dir, 'v.json');
    writeFileSync(vault, '{not-json');
    const c = await cli(['cloak', '--vault', vault], 'hello world');
    expect(c.code).toBe(0);
    expect(c.stderr).toContain(`corrupt vault at ${vault}`);
  });
});

describe('guard', () => {
  it('denies prompts with secrets, allows clean', async () => {
    const deny = await cli(['guard'], JSON.stringify({ event: 'prompt', text: 'key sk-abcdefghij1234567890' }));
    expect(deny.code).toBe(2);
    expect(JSON.parse(deny.stdout).decision).toBe('deny');
    expect(JSON.parse(deny.stdout).reason).not.toContain('sk-abcdefghij1234567890');
    const ok = await cli(['guard'], JSON.stringify({ event: 'prompt', text: 'hello world' }));
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout).decision).toBe('allow');
  });
  it('denies env dumps, rewrites writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-'));
    const vault = join(dir, 'v.json');
    await cli(['cloak', '--vault', vault], 'sk-abcdefghij1234567890', { DATACLOAK_VAULT: vault });
    const deny = await cli(['guard'], JSON.stringify({ event: 'tool', tool: 'bash', args: { command: 'cat .env' } }), { DATACLOAK_VAULT: vault });
    expect(deny.code).toBe(2);
    const c = await cli(['cloak', '--vault', vault], 'sk-abcdefghij1234567890');
    const rw = await cli(['guard'], JSON.stringify({ event: 'tool', tool: 'write', args: { filePath: 'a.txt', content: c.stdout } }), { DATACLOAK_VAULT: vault });
    expect(rw.code).toBe(0);
    expect(JSON.parse(rw.stdout).decision).toBe('rewrite');
    expect(JSON.parse(rw.stdout).args.content).toContain('sk-abcdefghij1234567890');
  });
  it('denies sensitive reads, allows normal reads', async () => {
    const deny = await cli(['guard'], JSON.stringify({ event: 'tool', tool: 'read', args: { filePath: '.env.local' } }));
    expect(deny.code).toBe(2);
    expect(JSON.parse(deny.stdout).decision).toBe('deny');
    const ok = await cli(['guard'], JSON.stringify({ event: 'tool', tool: 'read', args: { filePath: 'src/index.ts' } }));
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout).decision).toBe('allow');
  });
});
