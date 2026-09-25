export interface ExportRow { synthetic: string; original: string; category: string; }

const cell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(rows: ExportRow[]): string {
  return ['synthetic,original,category', ...rows.map((r) => [r.synthetic, r.original, r.category].map(cell).join(','))].join('\n');
}

export function toJson(rows: ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}
