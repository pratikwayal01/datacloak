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
  it('re-set same original with new synthetic replaces old entry', () => {
    const v = new Vault(10);
    v.set({ original: '1', synthetic: 's1', category: 'C', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    v.set({ original: '1', synthetic: 's2', category: 'C', type: 'pii', synthesizedAt: 2, confidence: 'high' });
    expect(v.size).toBe(1);
    expect(v.getBySynthetic('s1')).toBeUndefined();
    expect(v.getBySynthetic('s2')?.original).toBe('1');
    expect(v.getByOriginal('1')).toBe('s2');
  });
  it('eviction after re-mapping keeps current mapping intact', () => {
    const v = new Vault(2);
    v.set({ original: '1', synthetic: 's1', category: 'C', type: 'pii', synthesizedAt: 1, confidence: 'high' });
    v.set({ original: '2', synthetic: 's2', category: 'C', type: 'pii', synthesizedAt: 2, confidence: 'high' });
    v.set({ original: '1', synthetic: 's3', category: 'C', type: 'pii', synthesizedAt: 3, confidence: 'high' });
    v.set({ original: '3', synthetic: 's4', category: 'C', type: 'pii', synthesizedAt: 4, confidence: 'high' });
    expect(v.getByOriginal('1')).toBe('s3');
    expect(v.getBySynthetic('s3')?.original).toBe('1');
    expect(v.size).toBe(2);
  });
});
