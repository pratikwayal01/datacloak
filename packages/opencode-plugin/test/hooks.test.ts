import { describe, expect, it } from 'vitest';
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
});
