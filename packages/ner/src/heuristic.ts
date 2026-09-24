import type { NerProvider, PiiContext, Span } from './types.js';

const HONORIFICS = /^(?:mr|ms|mrs|dr|prof)\.?\s+/i;
const SIGNALS = /(?:my name is|contact|attn|attn:|c\/o|signed|sincerely|regards|from)\s+$/i;
const BLOCK_MONTHS = new Set('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));
const BLOCK_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const BLOCK_SUFFIX = new Set(['inc', 'llc', 'gmbh', 'ltd', 'corp', 'co', 'ag', 'sas', 'bv']);
const PAIR = /\b([A-Z][a-z]{1,19}) ([A-Z][a-z]{1,19})\b/g;

export class HeuristicNerProvider implements NerProvider {
  name = 'heuristic';
  detectNames(text: string): Span[] {
    const out: Span[] = [];
    PAIR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PAIR.exec(text)) !== null) {
      const [full, first, last] = m;
      if (BLOCK_MONTHS.has(first.toLowerCase()) || BLOCK_MONTHS.has(last.toLowerCase())) continue;
      if (BLOCK_DAYS.has(first.toLowerCase()) || BLOCK_DAYS.has(last.toLowerCase())) continue;
      if (BLOCK_SUFFIX.has(last.toLowerCase())) continue;
      if (/^[A-Z][a-z]* [A-Z][a-z]* (fixed|added|removed|merged|said|says|announced)$/.test(text.slice(Math.max(0, m.index - 1), m.index + full.length + 12))) continue;
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      const signaled = HONORIFICS.test(full) || SIGNALS.test(before) || /(?:mr|ms|mrs|dr|prof)\.\s*$/i.test(before) || /, (jr|sr|ii|iii|iv)\.?$/i.test(full);
      const sentenceStart = m.index === 0 || /[.!?]\s+$/.test(before);
      if (!signaled && sentenceStart) continue;
      out.push({ value: HONORIFICS.test(full) ? full.replace(HONORIFICS, '') : full, start: m.index, end: m.index + full.length, confidence: signaled ? 'high' : 'medium' });
    }
    return out;
  }
  detectAddresses(_text: string): Span[] { return []; }
  detectDob(_text: string, _context: PiiContext): Span[] { return []; }
}
