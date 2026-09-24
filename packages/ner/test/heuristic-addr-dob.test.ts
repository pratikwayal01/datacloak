import { describe, expect, it } from 'vitest';
import { HeuristicNerProvider } from '../src/heuristic.js';

const p = new HeuristicNerProvider();
const ctx = { hasEmail: true, hasPhone: false, hasId: false };
const noCtx = { hasEmail: false, hasPhone: false, hasId: false };

describe('heuristic addresses', () => {
  it('needs all three parts', () => {
    const hits = p.detectAddresses('ship to 847 Larkspur Ave, Denver CO 80203 please');
    expect(hits.length).toBe(1);
    expect(hits[0].confidence).toBe('high');
    expect(p.detectAddresses('meet on Larkspur Ave')).toHaveLength(0);
    expect(p.detectAddresses('Denver CO 80203 is nice')).toHaveLength(0);
  });
  it('supports DE format', () => {
    expect(p.detectAddresses('Hauptstr. 12, 10115 Berlin')).toHaveLength(1);
  });
});

describe('heuristic dob', () => {
  it('requires co-located signal', () => {
    expect(p.detectDob('born 1987-03-22', noCtx)).toHaveLength(0);
    const hits = p.detectDob('Alice Johnson, born 1987-03-22, alice@x.com', ctx);
    expect(hits.map((s) => s.value)).toContain('1987-03-22');
  });
  it('accepts DMY and MDY', () => {
    expect(p.detectDob('DOB 22/03/1987 mail a@b.co', ctx).length).toBe(1);
    expect(p.detectDob('DOB 03/22/1987 mail a@b.co', ctx).length).toBe(1);
  });
});
