import { describe, expect, it, vi } from 'vitest';
import { isEnabled, parseHost, removeSite, requestSite, toOriginPattern } from '../src/site-store.js';

const chromeish = () => ({
  permissions: { contains: vi.fn(async () => false), request: vi.fn(async () => true), remove: vi.fn(async () => true) },
  scripting: { registerContentScripts: vi.fn(async () => {}), unregisterContentScripts: vi.fn(async () => {}) },
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
    expect(c.scripting.registerContentScripts).toHaveBeenCalledWith([{
      id: 'dc-nas:3000',
      matches: ['http://nas:3000/*'],
      js: ['dist/content.js'],
    }]);
  });
  it('requestSite returns false when permission denied', async () => {
    const c = chromeish();
    c.permissions.request.mockResolvedValueOnce(false);
    expect(await requestSite('duck.ai', c)).toBe(false);
    expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
  });
  it('removeSite removes permission and unregisters script', async () => {
    const c = chromeish();
    await removeSite('duck.ai', c);
    expect(c.permissions.remove).toHaveBeenCalledWith({ origins: ['https://duck.ai/*'] });
    expect(c.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['dc-duck.ai'] });
  });
});

describe('ensureSiteAccess/loadUserSites', () => {
  it('remove tolerates a never-registered script id', async () => {
    const { removeSite } = await import('../src/site-store.js');
    const c = chromeish();
    c.scripting.unregisterContentScripts.mockRejectedValueOnce(new Error(`Nonexistent script ID 'dc-gpt.com'`));
    await removeSite('gpt.com', c, 'https');
    expect(c.permissions.remove).toHaveBeenCalledWith({ origins: ['https://gpt.com/*'] });
  });
  const chromeishOk = () => ({
    permissions: { contains: vi.fn(async () => false), request: vi.fn(async () => true), remove: vi.fn(async () => true) },
    scripting: { registerContentScripts: vi.fn(async () => {}), unregisterContentScripts: vi.fn(async () => {}) },
  });
  it('already-granted skips the native dialog', async () => {
    const { ensureSiteAccess } = await import('../src/site-store.js');
    const c = chromeishOk();
    c.permissions.contains.mockResolvedValueOnce(true);
    const r = await ensureSiteAccess({ custom: [], disabled: [] }, 'duck.ai', undefined, c, {});
    expect(r.ok).toBe(true);
    expect(c.permissions.request).not.toHaveBeenCalled();
    expect(r.user.custom).toEqual([{ host: 'duck.ai', enabled: true }]);
  });
  it('duplicate script id clears and retries once', async () => {
    const { ensureSiteAccess } = await import('../src/site-store.js');
    const c = chromeishOk();
    c.scripting.registerContentScripts.mockRejectedValueOnce(new Error('duplicate'));
    const r = await ensureSiteAccess({ custom: [], disabled: [] }, 'duck.ai', undefined, c, {});
    expect(r.ok).toBe(true);
    expect(c.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['dc-duck.ai'] });
    expect(c.scripting.registerContentScripts).toHaveBeenCalledTimes(2);
  });
  it('new custom host registers and stores', async () => {
    const { ensureSiteAccess } = await import('../src/site-store.js');
    const c = chromeishOk();
    const r = await ensureSiteAccess({ custom: [], disabled: [] }, 'duck.ai', undefined, c, {});
    expect(r.ok).toBe(true);
    expect(r.user.custom).toEqual([{ host: 'duck.ai', enabled: true }]);
    expect(c.scripting.registerContentScripts).toHaveBeenCalledWith([{
      id: 'dc-duck.ai', matches: ['https://duck.ai/*'], js: ['dist/content.js'],
    }]);
  });
  it('denied grant keeps store untouched', async () => {
    const { ensureSiteAccess } = await import('../src/site-store.js');
    const c = chromeishOk();
    c.permissions.request.mockResolvedValueOnce(false);
    const before = { custom: [], disabled: [] };
    const r = await ensureSiteAccess(before, 'duck.ai', undefined, c, {});
    expect(r.ok).toBe(false);
    expect(r.user).toBe(before);
  });
  it('builtin re-enable drops the disabled flag', async () => {
    const { ensureSiteAccess } = await import('../src/site-store.js');
    const r = await ensureSiteAccess({ custom: [], disabled: ['claude.ai'] }, 'claude.ai', undefined, chromeishOk(), { 'claude.ai': ['textarea'] });
    expect(r.ok).toBe(true);
    expect(r.user.disabled).toEqual([]);
  });
  it('loadUserSites falls back on corrupt storage', async () => {
    const { loadUserSites } = await import('../src/site-store.js');
    expect(await loadUserSites({ load: async () => undefined, save: async () => {} })).toEqual({ custom: [], disabled: [] });
    expect(await loadUserSites({ load: async () => { throw new Error('x'); }, save: async () => {} })).toEqual({ custom: [], disabled: [] });
    const good = { custom: [{ host: 'a', enabled: true }], disabled: [] };
    expect(await loadUserSites({ load: async () => good, save: async () => {} })).toBe(good);
  });
});

describe('ensureRegistered', () => {
  it('skips registration without a grant (never prompts)', async () => {
    const { ensureRegistered } = await import('../src/site-store.js');
    const c = chromeish();
    c.permissions.contains.mockResolvedValueOnce(false);
    expect(await ensureRegistered('duck.ai', c)).toBe(false);
    expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
  });
  it('treats duplicate registration as settled', async () => {
    const { ensureRegistered } = await import('../src/site-store.js');
    const c = chromeish();
    c.permissions.contains.mockResolvedValueOnce(true);
    c.scripting.registerContentScripts.mockRejectedValueOnce(new Error('duplicate'));
    expect(await ensureRegistered('duck.ai', c)).toBe(true);
  });
});
