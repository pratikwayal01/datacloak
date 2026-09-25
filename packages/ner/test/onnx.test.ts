import { describe, expect, it, vi } from 'vitest';
import { OnnxNerProvider } from '../src/onnx.js';

describe('onnx provider', () => {
  it('throws install hint without a model file', () => {
    expect(() => new OnnxNerProvider('/nonexistent/model.onnx')).toThrow(/model file not found/);
  });
  it('maps label spans to Span[] with a mocked session', async () => {
    const fakeSession = {
      run: vi.fn(async () => ({ labels: ['B-PER', 'I-PER', 'O'] })),
    };
    const p = new OnnxNerProvider('/model.onnx', fakeSession as never);
    const spans = await p.detectNamesAsync('Alice Johnson ran');
    expect(spans.map((s) => s.value)).toContain('Alice Johnson');
  });
});
