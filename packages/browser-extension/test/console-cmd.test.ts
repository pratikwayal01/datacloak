import { describe, expect, it } from 'vitest';
import { runConsoleCmd } from '../src/console-cmd.js';

const ctx = { version: '0.1.0', vaultCount: 3, settings: { mode: 'auto' } };

describe('console-cmd', () => {
  it('help lists commands', () => {
    expect(runConsoleCmd('help', ctx)).toMatch(/vault\.list.*settings\.dump.*version/s);
  });
  it('vault.list reports count', () => {
    expect(runConsoleCmd('vault.list', ctx)).toContain('3');
  });
  it('settings.dump prints settings', () => {
    expect(runConsoleCmd('settings.dump', ctx)).toContain('auto');
  });
  it('version prints version', () => {
    expect(runConsoleCmd('version', ctx)).toContain('0.1.0');
  });
  it('unknown suggests help', () => {
    expect(runConsoleCmd('frobnicate', ctx)).toMatch(/help/i);
  });
});
