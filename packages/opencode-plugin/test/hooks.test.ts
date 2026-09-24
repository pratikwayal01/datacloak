import { describe, expect, it, vi } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { createHooks } from '../src/hooks.js';
import { defaultResolvedConfig } from '../src/config.js';

function mockCtx() {
  const handlers: Record<string, ((e: never) => void)[]> = {};
  const hook = (name: string, fn: (e: never) => void) => { (handlers[name] ??= []).push(fn); };
  return { ctx: { session: { hook }, tool: { hook } }, handlers };
}

describe('hooks', () => {
  it('request hook cloaks system + message text', () => {
    const { ctx, handlers } = mockCtx();
    const h = createHooks(ctx as never, { ...defaultResolvedConfig });
    void h;
    const event = { system: 'key sk-abcdefghij1234567890', messages: [{ parts: [{ type: 'text', text: 'mail john.doe@acme.com' }] }] };
    for (const fn of handlers['request'] ?? []) fn(event as never);
    expect(event.system).not.toContain('sk-abcdefghij1234567890');
    expect(event.messages[0].parts[0].text).not.toContain('john.doe@acme.com');
  });
  it('request hook cloaks system array (real string[] shape)', () => {
    const { ctx, handlers } = mockCtx();
    createHooks(ctx as never, { ...defaultResolvedConfig });
    const event = { system: ['key sk-abcdefghij1234567890', 'clean'] };
    for (const fn of handlers['request'] ?? []) fn(event as never);
    expect(event.system[0]).not.toContain('sk-abcdefghij1234567890');
    expect(event.system[1]).toBe('clean');
  });
  it('before hook throws on env dump, passes safe calls', () => {
    const { ctx, handlers } = mockCtx();
    createHooks(ctx as never, { ...defaultResolvedConfig, mode: 'block' });
    expect(() => (handlers['execute.before']?.[0] as (e: unknown) => void)({ tool: 'bash', input: { command: 'cat .env' } })).toThrow(/DataCloak/);
    expect(() => (handlers['execute.before']?.[0] as (e: unknown) => void)({ tool: 'bash', input: { command: 'ls' } })).not.toThrow();
  });
  it('after hook redacts secrets, suppresses on internal error', () => {
    const { ctx, handlers } = mockCtx();
    createHooks(ctx as never, { ...defaultResolvedConfig });
    const event = { tool: 'read', result: 'token sk-abcdefghij1234567890 end', output: '' };
    for (const fn of handlers['execute.after'] ?? []) fn(event as never);
    expect(event.result).not.toContain('sk-abcdefghij1234567890');
  });
  it('after hook redacts title + metadata leaves, cycle-safe', () => {
    const { ctx, handlers } = mockCtx();
    createHooks(ctx as never, { ...defaultResolvedConfig });
    const metadata: Record<string, unknown> = {
      note: 'mail john.doe@acme.com',
      count: 3,
      nested: ['token sk-abcdefghij1234567890'],
    };
    metadata.self = metadata;
    const event = { tool: 'read', result: '', output: '', title: 'key sk-abcdefghij1234567890', metadata };
    for (const fn of handlers['execute.after'] ?? []) fn(event as never);
    expect(event.title).not.toContain('sk-abcdefghij1234567890');
    expect(metadata.note as string).not.toContain('john.doe@acme.com');
    expect((metadata.nested as string[])[0]).not.toContain('sk-abcdefghij1234567890');
    expect(metadata.count).toBe(3);
  });
  it('after hook fail-closed sanitizes all four fields on cloak failure', () => {
    const { ctx, handlers } = mockCtx();
    createHooks(ctx as never, { ...defaultResolvedConfig });
    vi.spyOn(DataCloakEngine.prototype, 'cloak').mockImplementationOnce(() => {
      throw new Error('vault offline');
    });
    const event = {
      tool: 'read',
      result: 'token sk-abcdefghij1234567890',
      output: 'token sk-abcdefghij1234567890',
      title: 'key sk-abcdefghij1234567890',
      metadata: { note: 'mail john.doe@acme.com' },
    };
    for (const fn of handlers['execute.after'] ?? []) fn(event as never);
    vi.restoreAllMocks();
    expect(event.result).toBe('[DataCloak: output suppressed after detection failure]');
    expect(event.output).toBe('');
    expect(event.title).toBe('');
    expect(event.metadata).toEqual({});
  });
});
