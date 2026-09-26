import { describe, expect, it } from 'vitest';
import { DataCloakEngine } from '../src/engine.js';

describe('vault export/import', () => {
  it('round-trips vault entries', async () => {
    const e = new DataCloakEngine();
    e.cloak('mail john.doe@acme.com');
    expect(e.vault.size).toBeGreaterThan(0);
    const blob = await e.exportVault('correct-horse');
    expect(typeof blob).toBe('string');
    const e2 = new DataCloakEngine();
    const n = await e2.importVault(blob, 'correct-horse');
    expect(n).toBe(e.vault.size);
    expect(e2.vault.size).toBe(e.vault.size);
    const synth = e.vault.list()[0].synthetic;
    expect(e2.restore(synth).text).toBe('john.doe@acme.com');
  });
  it('wrong passphrase errors and leaves vault untouched', async () => {
    const e = new DataCloakEngine();
    e.cloak('mail john.doe@acme.com');
    const blob = await e.exportVault('correct-horse');
    const e2 = new DataCloakEngine();
    await expect(e2.importVault(blob, 'wrong-pass')).rejects.toThrow(/wrong passphrase or corrupt/);
    expect(e2.vault.size).toBe(0);
  });
  it('malformed blob errors', async () => {
    const e = new DataCloakEngine();
    await expect(e.importVault('not-json', 'x')).rejects.toThrow();
    await expect(e.importVault(JSON.stringify({ v: 999 }), 'x')).rejects.toThrow(/unsupported vault export version/);
  });
});
