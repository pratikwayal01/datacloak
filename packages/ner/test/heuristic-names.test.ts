import { describe, expect, it } from 'vitest';
import { HeuristicNerProvider } from '../src/heuristic.js';

const p = new HeuristicNerProvider();
const vals = (t: string) => p.detectNames(t).map((s) => s.value);

describe('heuristic names', () => {
  it('finds signaled names', () => {
    expect(vals('contact Alice Johnson tomorrow')).toContain('Alice Johnson');
    expect(vals('Dr. Marcus Okafor will join')).toContain('Marcus Okafor');
  });
  it('rejects months, weekdays, sentence starts, companies', () => {
    expect(vals('March brings rain')).toHaveLength(0);
    expect(vals('Monday morning standup')).toHaveLength(0);
    expect(vals('Acme Inc announced layoffs')).toHaveLength(0);
    expect(vals('Alice fixed the bug')).toHaveLength(0);
  });
  it('never returns single tokens', () => {
    for (const s of p.detectNames('Alice Johnson and Bob Smith met Carol')) {
      expect(s.value.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    }
  });
  it('re-anchors stripped honorific spans exactly', () => {
    const t = 'Dr. Alice Johnson will join';
    const hits = p.detectNames(t).filter((s) => s.value === 'Alice Johnson');
    expect(hits).toHaveLength(1);
    expect(t.slice(hits[0].start, hits[0].end)).toBe('Alice Johnson');
  });
  it('flags generational suffix as high confidence', () => {
    const hits = p.detectNames('John Smith Jr. arrives');
    expect(hits.map((s) => s.value)).toContain('John Smith');
    expect(hits.find((s) => s.value === 'John Smith')?.confidence).toBe('high');
  });
  it('rejects street-suffix pairs (not person names)', () => {
    expect(vals('lives on Main St near downtown')).toHaveLength(0);
    expect(vals('apt 4 on Oak Ave, second floor')).toHaveLength(0);
    expect(vals('ship to 847 Larkspur Ave, Denver CO 80203')).toHaveLength(0);
    expect(vals('meet on Pine Rd tomorrow')).toHaveLength(0);
  });
  it('street-suffix block does not suppress real addresses', () => {
    const hits = p.detectAddresses('ship to 847 Larkspur Ave, Denver CO 80203');
    expect(hits).toHaveLength(1);
    expect(hits[0].value).toContain('Larkspur Ave');
  });
  it('verb guard fires on merged too', () => {
    expect(vals('Alice fixed the bug')).toHaveLength(0);
    expect(vals('Bob merged the PR')).toHaveLength(0);
  });
});
