import { existsSync } from 'node:fs';
import type { NerProvider, PiiContext, Span } from './types.js';

interface OnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, string[]>>;
}

const BIO_JOIN = (tokens: string[], labels: string[], text: string): Span[] => {
  const out: Span[] = [];
  let cur: string[] = [];
  let curStart = 0;
  const flush = (end: number) => {
    if (cur.length > 0) {
      const value = cur.join(' ');
      const start = text.indexOf(value, curStart);
      out.push({ value, start, end: start + value.length, confidence: 'high' });
      curStart = start + value.length;
      cur = [];
    }
    void end;
  };
  tokens.forEach((tok, i) => {
    const label = labels[i] ?? 'O';
    if (label.startsWith('B-')) { flush(i); cur = [tok]; }
    else if (label.startsWith('I-') && cur.length > 0) cur.push(tok);
    else flush(i);
  });
  flush(tokens.length);
  return out;
};

export class OnnxNerProvider implements NerProvider {
  name = 'onnx';
  private session: OnnxSession | null;
  private warned = false;
  constructor(
    private modelPath: string,
    session?: OnnxSession,
    private runner?: (modelPath: string) => Promise<OnnxSession>,
  ) {
    if (!session && !existsSync(modelPath)) {
      throw new Error(`datacloak: NER model file not found at ${modelPath} — download a token-classification ONNX model and pass its path`);
    }
    this.session = session ?? null;
  }
  private hint(): void {
    if (!this.warned) {
      this.warned = true;
      console.error('[datacloak] onnx session not loaded — sync detect falls back to no spans; use detectNamesAsync');
    }
  }
  detectNames(_text: string): Span[] { this.hint(); return []; }
  detectAddresses(_text: string): Span[] { this.hint(); return []; }
  detectDob(_text: string, _context: PiiContext): Span[] { this.hint(); return []; }
  async detectNamesAsync(text: string): Promise<Span[]> {
    let session = this.session;
    if (!session) {
      if (!this.runner) throw new Error('datacloak: no onnx runner — install onnxruntime-node');
      const specifier = 'onnxruntime-node';
      const mod = await import(specifier).catch(() => null) as null;
      void mod;
      session = await this.runner(this.modelPath);
      this.session = session;
    }
    const tokens = text.split(/\s+/);
    const out = await session.run({ input: tokens });
    return BIO_JOIN(tokens, out.labels ?? [], text);
  }
}
