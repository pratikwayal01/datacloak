import type { NerProvider, PiiContext, Span } from './types.js';

const HONORIFICS = /^(?:mr|ms|mrs|dr|prof)\.?\s+/i;
const SIGNALS = /(?:my name is|contact|attn|attn:|c\/o|signed|sincerely|regards|from)\s+$/i;
const BLOCK_MONTHS = new Set('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));
const BLOCK_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const BLOCK_SUFFIX = new Set(['inc', 'llc', 'gmbh', 'ltd', 'corp', 'co', 'ag', 'sas', 'bv']);
const PAIR = /\b([A-Z][a-z]{1,19}) ([A-Z][a-z]{1,19})\b/g;
const STREET_SUFFIX = 'St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Pl|Place|Way|Ter|Terrace|Str|Straße|Weg|Allee|Gasse';
const ADDR = new RegExp(
  `\\b(\\d{1,5}\\s+[A-Za-zÄÖÜäöüß.'-]+\\s+(?:${STREET_SUFFIX})\\.?,?\\s+[A-Za-zÄÖÜäöüß.'-]+(?:\\s+[A-Z]{2})?\\s+(?:\\d{5}(?:-\\d{4})?|[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}))\\b`,
  'g',
);
const ADDR_DE = /\b([A-Za-zÄÖÜäöüß.'-]+\s*(?:str|straße|weg|allee|gasse)\.?\s*\d{1,4}[a-z]?,?\s*\d{5}\s+[A-Za-zÄÖÜäöüß.'-]+)\b/gi;
const DOB_PATTERNS = [
  /\b(\d{4}-\d{2}-\d{2})\b/g,
  /\b(\d{2}\/\d{2}\/\d{4})\b/g,
  /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/gi,
];

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
      if (/^[A-Z][a-z]{1,19} [A-Z][a-z]{1,19} (fixed|added|removed|merged|said|says|announced)\b/.test(text.slice(m.index, m.index + full.length + 12))) continue;
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      const signaled = HONORIFICS.test(full) || SIGNALS.test(before) || /(?:mr|ms|mrs|dr|prof)\.?\s*$/i.test(before) || /(?:^|\s|,)(jr|sr|ii|iii|iv)\.?(\s|$)/i.test(text.slice(m.index + full.length, m.index + full.length + 8));
      const sentenceStart = m.index === 0 || /[.!?]\s+$/.test(before);
      if (!signaled && sentenceStart) continue;
      const stripped = HONORIFICS.test(full) ? full.replace(HONORIFICS, '') : full;
      if (stripped.trim().split(/\s+/).length < 2) continue;
      const start = m.index + full.indexOf(stripped);
      out.push({ value: stripped, start, end: start + stripped.length, confidence: signaled ? 'high' : 'medium' });
    }
    return out;
  }
  detectAddresses(text: string): Span[] {
    const out: Span[] = [];
    for (const re of [ADDR, ADDR_DE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) out.push({ value: m[1], start: m.index, end: m.index + m[1].length, confidence: 'high' });
    }
    return out;
  }
  detectDob(text: string, context: PiiContext): Span[] {
    if (!context.hasEmail && !context.hasPhone && !context.hasId) return [];
    const out: Span[] = [];
    for (const re of DOB_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (!/born|dob|birth|neé?e?/i.test(text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 8)) && !context.hasId) continue;
        out.push({ value: m[1], start: m.index, end: m.index + m[1].length, confidence: 'medium' });
      }
    }
    return out;
  }
}
