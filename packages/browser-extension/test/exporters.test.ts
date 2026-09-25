import { describe, expect, it } from 'vitest';
import { toCsv, toJson } from '../src/exporters.js';

const rows = [
  { synthetic: 'a@x.net', original: 'john.doe@acme.com', category: 'EMAIL' },
  { synthetic: 'x', original: 'say "hi", ok', category: 'OTHER' },
];

describe('exporters', () => {
  it('csv quotes commas and quotes', () => {
    const csv = toCsv(rows);
    expect(csv.split('\n')[0]).toBe('synthetic,original,category');
    expect(csv).toContain('"say ""hi"", ok"');
  });
  it('json round-trips', () => {
    expect(JSON.parse(toJson(rows))).toEqual(rows);
  });
});
