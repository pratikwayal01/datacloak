import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

describe('shell snippets', () => {
  it('bash/zsh parse clean', () => {
    for (const f of ['shell/preexec.sh', 'shell/preexec.zsh']) {
      const r = spawnSync('bash', ['-n', new URL(`../${f}`, import.meta.url).pathname]);
      expect(r.status).toBe(0);
    }
  });
  it('fish parses clean', () => {
    const r = spawnSync('fish', ['-n', new URL('../shell/preexec.fish', import.meta.url).pathname]);
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return;
    expect(r.status).toBe(0);
  });
  it('bash self-wires DEBUG trap', () => {
    expect(load('shell/preexec.sh')).toContain(`trap '_datacloak_preexec "$BASH_COMMAND"' DEBUG`);
  });
  it.each(['shell/preexec.sh', 'shell/preexec.zsh', 'shell/preexec.fish'])('exit-2-only blocking in %s', (f) => {
    expect(load(f)).toContain('-eq 2');
  });
});
