import { describe, expect, it } from 'vitest';
import { shouldBlock } from '../src/guard.js';
import { defaultResolvedConfig } from '../src/config.js';

const cfg = defaultResolvedConfig;

describe('shouldBlock', () => {
  it('denies cat of .env via bash', () => {
    expect(shouldBlock('bash', { command: 'cat .env' }, cfg)).toMatch(/\.env/);
  });
  it('denies printenv and env pipes', () => {
    expect(shouldBlock('bash', { command: 'printenv | grep KEY' }, cfg)).toBeTruthy();
    expect(shouldBlock('bash', { command: 'env | grep SECRET' }, cfg)).toBeTruthy();
  });
  it('denies echo of $VAR and ssh reads', () => {
    expect(shouldBlock('bash', { command: 'echo $AWS_SECRET' }, cfg)).toBeTruthy();
    expect(shouldBlock('bash', { command: 'cat ~/.ssh/id_rsa' }, cfg)).toBeTruthy();
    expect(shouldBlock('bash', { command: 'cat ~/.aws/credentials' }, cfg)).toBeTruthy();
  });
  it('denies read of blocked paths, allows examples', () => {
    expect(shouldBlock('read', { filePath: '.env.local' }, cfg)).toBeTruthy();
    expect(shouldBlock('read', { filePath: 'certs/key.pem' }, cfg)).toBeTruthy();
    expect(shouldBlock('read', { filePath: '.env.example' }, cfg)).toBeNull();
  });
  it('ignores safe commands', () => {
    expect(shouldBlock('bash', { command: 'ls -la src' }, cfg)).toBeNull();
    expect(shouldBlock('read', { filePath: 'src/index.ts' }, cfg)).toBeNull();
  });
});
