import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

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
});
