import { describe, expect, it } from 'vitest';
import { defaultResolvedConfig, loadConfig } from '../src/config.js';

describe('config', () => {
  it('defaults are safe (enabled, warn, persist off)', () => {
    expect(defaultResolvedConfig.enabled).toBe(true);
    expect(defaultResolvedConfig.mode).toBe('warn');
    expect(defaultResolvedConfig.detection).toEqual({ secrets: true, envVars: true, pii: true, entropy: true, entropyThreshold: 4.5 });
    expect(defaultResolvedConfig.vault).toEqual({ maxEntries: 2000 });
  });
  it('env overrides mode', () => {
    process.env.DATACLOAK_MODE = 'block';
    expect(loadConfig('/nonexistent-dir-xyz').mode).toBe('block');
    delete process.env.DATACLOAK_MODE;
  });
  it('missing files fall back to defaults', () => {
    const c = loadConfig('/nonexistent-dir-xyz');
    expect(c.allowPaths).toEqual(['.env.example', 'fixtures/**']);
    expect(c.blockPaths).toContain('.env');
  });
});
