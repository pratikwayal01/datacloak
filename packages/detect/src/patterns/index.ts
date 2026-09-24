import type { CustomPattern, Detection } from '../types.js';
import { secretPatterns, type PatternEntry } from './secrets.js';
import { credentialPatterns, isCredentialKey } from './credentials.js';
import { piiPatterns } from './pii.js';

export interface Pass1Opts { secrets: boolean; envVars: boolean; pii: boolean; }

export function detectPass1(text: string, opts: Pass1Opts, custom: CustomPattern[] = []): Detection[] {
  const entries: PatternEntry[] = [];
  if (opts.secrets) entries.push(...secretPatterns);
  if (opts.envVars) entries.push(...credentialPatterns);
  if (opts.pii) entries.push(...piiPatterns);
  for (const c of custom) {
    let regex: RegExp;
    try { regex = new RegExp(c.pattern, 'g'); } catch { throw new Error(`datacloak: invalid custom pattern "${c.name}"`); }
    entries.push({ name: c.name, category: c.category, type: c.type, regex, confidence: 'medium' });
  }
  const out: Detection[] = [];
  for (const e of entries) {
    e.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = e.regex.exec(text)) !== null) {
      if (m[0].length === 0) { e.regex.lastIndex++; continue; }
      let value = m[0], start = m.index;
      if (e.valueGroup !== undefined && m[e.valueGroup] !== undefined) {
        value = m[e.valueGroup];
        start = m.index + m[0].indexOf(value);
      }
      if (e.name === 'env-var') {
        const key = m[1];
        if (!isCredentialKey(key)) continue;
      }
      out.push({ value, category: e.category, type: e.type, start, end: start + value.length, confidence: e.confidence });
      if (m[0].length === 0) e.regex.lastIndex++;
    }
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Detection[] = [];
  for (const d of out) {
    if (kept.length > 0 && d.start < kept[kept.length - 1].end) continue;
    kept.push(d);
  }
  return kept;
}
