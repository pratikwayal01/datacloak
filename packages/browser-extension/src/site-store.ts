export interface UserSites {
  custom: { host: string; enabled: boolean; scheme?: Scheme }[];
  disabled: string[];
}

export type Scheme = 'http' | 'https';

export function parseHost(input: string): { host: string; scheme: Scheme } | null {
  const t = input.trim();
  if (!t) return null;
  const hasScheme = t.includes('://');
  try {
    const u = new URL(hasScheme ? t : `https://${t}`);
    if (!u.hostname) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const scheme: Scheme = hasScheme ? (u.protocol === 'http:' ? 'http' : 'https') : 'https';
    const isDefaultPort =
      (scheme === 'https' && u.port === '443') || (scheme === 'http' && u.port === '80');
    const port = u.port && !isDefaultPort ? `:${u.port}` : '';
    return { host: u.hostname + port, scheme };
  } catch {
    return null;
  }
}

export function toOriginPattern(host: string, scheme?: Scheme): string {
  const s = scheme ?? (host.includes(':') ? 'http' : 'https');
  return `${s}://${host}/*`;
}

export function isEnabled(  host: string,
  builtins: Record<string, unknown> | readonly string[],
  user: UserSites,
): boolean {
  const custom = user.custom.find((c) => c.host === host);
  if (custom) return custom.enabled;
  const isBuiltin = Array.isArray(builtins) ? builtins.includes(host) : host in builtins;
  if (isBuiltin && !user.disabled.includes(host)) return true;
  return false;
}

export interface Chromeish {
  permissions: {
    contains: (perms: { origins: string[] }) => Promise<boolean>;
    request: (perms: { origins: string[] }) => Promise<boolean>;
    remove: (perms: { origins: string[] }) => Promise<boolean>;
  };
  scripting: {
    registerContentScripts: (scripts: { id: string; matches: string[]; js: string[] }[]) => Promise<void>;
    unregisterContentScripts: (filter: { ids: string[] }) => Promise<void>;
  };
}

const scriptId = (host: string): string => `dc-${host}`;

/**
 * Best-effort registration: if the grant is already held, make sure the
 * content script is registered (heals a popup that died mid-add).
 * Never prompts — returns false when there is no grant to work with.
 */
export async function ensureRegistered(host: string, chromeish: Chromeish, scheme?: Scheme): Promise<boolean> {
  const pattern = toOriginPattern(host, scheme);
  try {
    if (!await chromeish.permissions.contains({ origins: [pattern] })) return false;
    await chromeish.scripting.registerContentScripts([{
      id: scriptId(host),
      matches: [pattern],
      js: ['dist/content.js'],
    }]);
  } catch {
    // Duplicate id or revoked mid-flight — steady state wins.
  }
  return true;
}

export async function requestSite(host: string, chromeish: Chromeish, scheme?: Scheme): Promise<boolean> {
  const pattern = toOriginPattern(host, scheme);
  // Already granted (e.g. retried Add) → skip the native dialog entirely.
  if (!await chromeish.permissions.contains({ origins: [pattern] })) {
    if (!await chromeish.permissions.request({ origins: [pattern] })) return false;
  }
  const script = {
    id: scriptId(host),
    matches: [pattern],
    js: ['dist/content.js'],
  };
  try {
    await chromeish.scripting.registerContentScripts([script]);
  } catch {
    // Duplicate id from a partial earlier attempt → clear and retry once.
    try {
      await chromeish.scripting.unregisterContentScripts({ ids: [script.id] });
      await chromeish.scripting.registerContentScripts([script]);
    } catch {
      return false;
    }
  }
  return true;
}

export async function removeSite(host: string, chromeish: Chromeish, scheme?: Scheme): Promise<void> {
  const pattern = toOriginPattern(host, scheme);
  try {
    await chromeish.scripting.unregisterContentScripts({ ids: [scriptId(host)] });
  } catch {
    // Script was never registered (or already gone) — removal is still complete.
  }
  await chromeish.permissions.remove({ origins: [pattern] });
}

export function upsertCustomSite(user: UserSites, host: string, enabled: boolean, scheme?: Scheme): UserSites {
  const idx = user.custom.findIndex((c) => c.host === host);
  if (idx >= 0) return { ...user, custom: user.custom.map((c, i) => i === idx ? { ...c, enabled } : c) };
  return { ...user, custom: [...user.custom, { host, enabled, ...(scheme ? { scheme } : {}) }] };
}

export interface SitesStorage {
  load(): Promise<UserSites | undefined>;
  save(u: UserSites): Promise<void>;
}

export async function loadUserSites(s: SitesStorage): Promise<UserSites> {
  try {
    const v = await s.load();
    if (v && Array.isArray(v.custom) && Array.isArray(v.disabled)) return v;
  } catch { /* corrupt storage → defaults */ }
  return { custom: [], disabled: [] };
}

/** Shared add/enable flow: permission + script registration, then store update. */
export async function ensureSiteAccess(
  user: UserSites,
  host: string,
  scheme: Scheme | undefined,
  chromeish: Chromeish,
  builtins: Record<string, unknown> | readonly string[],
): Promise<{ user: UserSites; ok: boolean }> {
  const isBuiltin = Array.isArray(builtins) ? builtins.includes(host) : host in builtins;
  if (!isBuiltin && !user.custom.some((c) => c.host === host)) {
    if (!await requestSite(host, chromeish, scheme)) return { user, ok: false };
    return { user: upsertCustomSite(user, host, true, scheme), ok: true };
  }
  const known = user.custom.find((c) => c.host === host)?.scheme ?? scheme;
  if (!await requestSite(host, chromeish, known)) return { user, ok: false };
  return {
    user: {
      custom: user.custom.map((c) => c.host === host ? { ...c, enabled: true } : c),
      disabled: user.disabled.filter((d) => d !== host),
    },
    ok: true,
  };
}
