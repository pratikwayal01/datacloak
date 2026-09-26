import { describe, expect, it, vi } from 'vitest';
import { isEnabled, parseHost, removeSite, requestSite, toOriginPattern } from '../src/site-store.js';

const chromeish = () => ({
  permissions: { request: vi.fn(async () => true), remove: vi.fn(async () => true) },
  scripting: { registerContentScript: vi.fn(async () => {}), unregisterContentScripts: vi.fn(async () => {}) },
});

describe('parseHost', () => {
  it('bare host defaults to https', () => {
    expect(parseHost('duck.ai')).toEqual({ host: 'duck.ai', scheme: 'https' });
  });
  it('explicit http scheme with port wins', () => {
    expect(parseHost('http://nas:3000/')).toEqual({ host: 'nas:3000', scheme: 'http' });
  });
  it('explicit https kept, default ports stripped', () => {
    expect(parseHost('https://example.com:443/x')).toEqual({ host: 'example.com', scheme: 'https' });
    expect(parseHost('http://example.com:80/x')).toEqual({ host: 'example.com', scheme: 'http' });
  });
  it('cross-scheme ports kept (not scheme defaults)', () => {
    expect(parseHost('https://x.test:80/')).toEqual({ host: 'x.test:80', scheme: 'https' });
    expect(parseHost('http://x.test:443/')).toEqual({ host: 'x.test:443', scheme: 'http' });
  });
  it('garbage returns null', () => {
    expect(parseHost('')).toBeNull();
    expect(parseHost('::::')).toBeNull();
    expect(parseHost('http://')).toBeNull();
  });
});

describe('toOriginPattern', () => {
  it('bare host → https pattern', () => {
    expect(toOriginPattern('duck.ai')).toBe('https://duck.ai/*');
  });
  it('host:port → http pattern (self-hosted OpenWebUI)', () => {
    expect(toOriginPattern('nas:3000')).toBe('http://nas:3000/*');
  });
  it('explicit scheme overrides', () => {
    expect(toOriginPattern('example.com:8443', 'https')).toBe('https://example.com:8443/*');
  });
});

describe('isEnabled', () => {
  const builtins = { 'claude.ai': ['textarea'] };
  it('builtin enabled unless disabled', () => {
    expect(isEnabled('claude.ai', builtins, { custom: [], disabled: [] })).toBe(true);
    expect(isEnabled('claude.ai', builtins, { custom: [], disabled: ['claude.ai'] })).toBe(false);
  });
  it('custom host follows enabled flag', () => {
    expect(isEnabled('nas:3000', builtins, { custom: [{ host: 'nas:3000', enabled: true }], disabled: [] })).toBe(true);
    expect(isEnabled('nas:3000', builtins, { custom: [{ host: 'nas:3000', enabled: false }], disabled: [] })).toBe(false);
  });
  it('unknown host is disabled', () => {
    expect(isEnabled('nope.example', builtins, { custom: [], disabled: [] })).toBe(false);
  });
});

describe('requestSite/removeSite', () => {
  it('requestSite requests permission and registers content script', async () => {
    const c = chromeish();
    expect(await requestSite('nas:3000', c)).toBe(true);
    expect(c.permissions.request).toHaveBeenCalledWith({ origins: ['http://nas:3000/*'] });
    expect(c.scripting.registerContentScript).toHaveBeenCalledWith({
      id: 'dc-nas:3000',
      matches: ['http://nas:3000/*'],
      js: ['dist/content.js'],
    });
  });
  it('requestSite returns false when permission denied', async () => {
    const c = chromeish();
    c.permissions.request.mockResolvedValueOnce(false);
    expect(await requestSite('duck.ai', c)).toBe(false);
    expect(c.scripting.registerContentScript).not.toHaveBeenCalled();
  });
  it('removeSite removes permission and unregisters script', async () => {
    const c = chromeish();
    await removeSite('duck.ai', c);
    expect(c.permissions.remove).toHaveBeenCalledWith({ origins: ['https://duck.ai/*'] });
    expect(c.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['dc-duck.ai'] });
  });
});
