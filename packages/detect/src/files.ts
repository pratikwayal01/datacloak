import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { DataCloakEngine } from './engine.js';

const splitCsv = (line: string): string[] => {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q && ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
};
const joinCsv = (fields: string[]): string =>
  fields.map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(',');

export async function cloakFile(engine: DataCloakEngine, path: string): Promise<{ text: string; substitutions: { original: string; synthetic: string; category: string }[] }> {
  const ext = extname(path).toLowerCase();
  const raw = readFileSync(path, 'utf8');
  if (ext === '.json') {
    const parsed: unknown = JSON.parse(raw);
    const r = engine.cloakJson(parsed);
    return { text: JSON.stringify(r.value, null, 2), substitutions: r.substitutions };
  }
  if (ext === '.csv') {
    const subs: { original: string; synthetic: string; category: string }[] = [];
    const text = raw.split('\n').map((line) => joinCsv(splitCsv(line).map((f) => {
      const r = engine.cloak(f);
      subs.push(...r.substitutions);
      return r.text;
    }))).join('\n');
    return { text, substitutions: subs };
  }
  if (ext === '.txt' || ext === '.md' || ext === '') {
    const r = engine.cloak(raw);
    return { text: r.text, substitutions: r.substitutions };
  }
  throw new Error(`datacloak: unsupported extension ${ext || '(none)'}`);
}
