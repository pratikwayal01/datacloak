import { describe, expect, it, vi } from 'vitest';
import { decryptVault, encryptVault, loadOrCreateDek, migrateSession, pruneStore } from '../src/vault-store.js';
import type { StoredVault } from '../src/vault-store.js';

const entry = (s: string) => ({ synthetic: s, original: 'real-' + s, category: 'EMAIL' as const });

describe('vault-store', () => {
  it('round-trips entries', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const blob = await encryptVault([entry('a@x')], key);
    expect(await decryptVault(blob, key)).toEqual([entry('a@x')]);
  });
  it('wrong key fails closed', async () => {
    const k1 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const k2 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    await expect(decryptVault(await encryptVault([entry('a@x')], k1), k2)).rejects.toThrow();
  });
  it('prunes to bounds (origins, entries, ttl)', () => {
    const now = Date.now();
    const store: StoredVault = { origins: {} };
    for (let i = 0; i < 12; i++) {
      store.origins[`h${i}`] = {
        updatedAt: i < 11 ? now : now - 8 * 864e5,
        entries: Array.from({ length: 250 }, (_, j) => entry(`${i}-${j}`)),
      };
    }
    const out = pruneStore(store, now);
    expect(Object.keys(out.origins)).toHaveLength(10);
    expect(out.origins['h0'].entries).toHaveLength(200);
    expect(out.origins['h11']).toBeUndefined();
  });
  it('migrates session triples, skipping malformed rows', () => {
    const out = migrateSession([
      ['s1', 'o1', 'EMAIL'],
      ['bad', 'row'],
      'nope',
    ] as unknown as [string, string, string][]);
    expect(out).toEqual([{ synthetic: 's1', original: 'o1', category: 'EMAIL' }]);
  });
  it('loadOrCreateDek reuses persisted key', async () => {
    let saved: string | undefined;
    const storage = {
      get: vi.fn(async () => saved),
      set: vi.fn(async (v: string) => { saved = v; }),
    };
    const k1 = await loadOrCreateDek(storage);
    const k2 = await loadOrCreateDek(storage);
    const [r1, r2] = await Promise.all([
      crypto.subtle.exportKey('raw', k1),
      crypto.subtle.exportKey('raw', k2),
    ]);
    expect(Buffer.from(r1).toString('hex')).toBe(Buffer.from(r2).toString('hex'));
    expect(storage.set).toHaveBeenCalledTimes(1);
  });
});
