import { describe, expect, it } from 'vitest';
import { Vault } from '../src/vault.js';

describe('Vault', () => {
  it('round-trips synthetic->original', () => {
    const v = new Vault(10);
    v.set({ original: 'a@b.com', synthetic: 'x@y.net', category: 'EMAIL', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    expect(v.getBySynthetic('x@y.net')?.original).toBe('a@b.com');
    expect(v.getByOriginal('a@b.com')).toBe('x@y.net');
  });
  it('evicts oldest past maxEntries', () => {
    const v = new Vault(2);
    v.set({ original: '1', synthetic: 's1', category: 'C', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    v.set({ original: '2', synthetic: 's2', category: 'C', type: 'pii', synthesizedAt: 2, confidence: 'high' });
    v.set({ original: '3', synthetic: 's3', category: 'C', type: 'pii', synthesizedAt: 3, confidence: 'high' });
    expect(v.getBySynthetic('s1')).toBeUndefined();
    expect(v.size).toBe(2);
  });
  it('clear empties both directions', () => {
    const v = new Vault(10);
    v.set({ original: '1', synthetic: 's1', category: 'C', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    v.clear();
    expect(v.size).toBe(0);
    expect(v.getByOriginal('1')).toBeUndefined();
  });
});
