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
});
