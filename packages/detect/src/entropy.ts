export function shannon(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scanEntropy(text: string, threshold: number): { value: string; start: number; end: number }[] {
  const out: { value: string; start: number; end: number }[] = [];
  const re = /[^\s"'`,;()]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    if (value.length < 20 || UUID.test(value)) continue;
    if (value.startsWith('data:image')) continue;
    if (shannon(value) >= threshold) out.push({ value, start: m.index, end: m.index + value.length });
  }
  return out;
}
