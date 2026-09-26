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

export function isEnabled(
  host: string,
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
    request: (perms: { origins: string[] }) => Promise<boolean>;
    remove: (perms: { origins: string[] }) => Promise<boolean>;
  };
  scripting: {
    registerContentScript: (script: { id: string; matches: string[]; js: string[] }) => Promise<void>;
    unregisterContentScripts: (filter: { ids: string[] }) => Promise<void>;
  };
}

const scriptId = (host: string): string => `dc-${host}`;

export async function requestSite(host: string, chromeish: Chromeish, scheme?: Scheme): Promise<boolean> {
  const pattern = toOriginPattern(host, scheme);
  const granted = await chromeish.permissions.request({ origins: [pattern] });
  if (!granted) return false;
  await chromeish.scripting.registerContentScript({
    id: scriptId(host),
    matches: [pattern],
    js: ['dist/content.js'],
  });
  return true;
}

export async function removeSite(host: string, chromeish: Chromeish, scheme?: Scheme): Promise<void> {
  const pattern = toOriginPattern(host, scheme);
  await chromeish.permissions.remove({ origins: [pattern] });
  await chromeish.scripting.unregisterContentScripts({ ids: [scriptId(host)] });
}
