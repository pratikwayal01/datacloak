import { describe, expect, it } from 'vitest';
import { scanEntropy, shannon } from '../src/entropy.js';

describe('entropy', () => {
  it('low entropy for english words', () => {
    expect(shannon('password')).toBeLessThan(4.5);
  });
  it('flags random-looking token', () => {
    const hits = scanEntropy('token xK9#mQ2$vL7@nP4!qR8sT1wZ6 here', 4.5);
    expect(hits.map((h) => h.value)).toContain('xK9#mQ2$vL7@nP4!qR8sT1wZ6');
  });
  it('skips uuids and short words', () => {
    expect(scanEntropy('id 123e4567-e89b-12d3-a456-426614174000 see', 4.0)).toHaveLength(0);
    expect(scanEntropy('see the cat sat', 4.5)).toHaveLength(0);
  });
});
