import { describe, expect, it } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { applyWriteRestore } from '../src/hooks.js';

describe('write-path restore', () => {
  it('restores synthetics in write content', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('key sk-abcdefghij1234567890');
    const args = { filePath: 'cfg.txt', content: `token=${c.text}` };
    const n = applyWriteRestore(e, 'write', args);
    expect(n).toBe(1);
    expect(args.content).toContain('sk-abcdefghij1234567890');
  });
  it('leaves clean content untouched', () => {
    const e = new DataCloakEngine();
    const args = { filePath: 'a.txt', content: 'hello world' };
    expect(applyWriteRestore(e, 'write', args)).toBe(0);
    expect(args.content).toBe('hello world');
  });
  it('returns 0 without throwing on missing/non-object args', () => {
    const e = new DataCloakEngine();
    expect(applyWriteRestore(e, 'write', undefined as unknown as Record<string, unknown>)).toBe(0);
    expect(applyWriteRestore(e, 'write', null as unknown as Record<string, unknown>)).toBe(0);
  });
  it('ignores non-write tools', () => {
    const e = new DataCloakEngine();
    const c = e.cloak('john.doe@acme.com');
    const args = { command: `echo ${c.text}` };
    expect(applyWriteRestore(e, 'bash', args)).toBe(0);
    expect(args.command).toContain(c.text);
  });
});
