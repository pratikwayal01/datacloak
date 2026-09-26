// Vault v2 store: AES-GCM encrypted per-origin vault with hard bounds.
// MVP note: random DEK, no passphrase (PBKDF none). Raw DEK lives in
// chrome.storage.local `dc-dek` — honest grade: same-access attacker who can
// read extension storage gets the key. Passphrase wrap is future work.
export interface StoredEntry { synthetic: string; original: string; category: string; }
export interface StoredVault { origins: Record<string, { updatedAt: number; entries: StoredEntry[] }> }

export const MAX_ORIGINS = 10;
export const MAX_ENTRIES = 200;
export const TTL_MS = 7 * 864e5;
export const DEK_KEY = 'dc-dek';

// ponytail: chunked fromCharCode — one-shot spread overflows the stack on large vaults.
const b64e = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64d = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptVault(entries: StoredEntry[], key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(entries)));
  return `${b64e(iv)}.${b64e(new Uint8Array(ct))}`;
}

export async function decryptVault(blob: string, key: CryptoKey): Promise<StoredEntry[]> {
  const [ivs, cts] = blob.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(ivs) }, key, b64d(cts));
  return JSON.parse(new TextDecoder().decode(pt)) as StoredEntry[];
}

export function pruneStore(store: StoredVault, now: number): StoredVault {
  const fresh = Object.entries(store.origins).filter(([, o]) => now - o.updatedAt < TTL_MS);
  fresh.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const origins: StoredVault['origins'] = {};
  for (const [host, o] of fresh.slice(0, MAX_ORIGINS)) {
    origins[host] = { updatedAt: o.updatedAt, entries: o.entries.slice(-MAX_ENTRIES) };
  }
  return { origins };
}

// Session triples [synthetic, original, category][] → entries; malformed rows skipped.
export function migrateSession(sessionTriples: unknown): StoredEntry[] {
  if (!Array.isArray(sessionTriples)) return [];
  const out: StoredEntry[] = [];
  for (const r of sessionTriples) {
    if (!Array.isArray(r) || r.length !== 3 || !r.every((s) => typeof s === 'string')) continue;
    const [synthetic, original, category] = r as [string, string, string];
    out.push({ synthetic, original, category });
  }
  return out;
}

export interface DekStorage {
  get(): Promise<string | undefined>;
  set(rawB64: string): Promise<void>;
}

declare const chrome: {
  storage: {
    local: { get: (k: string) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void> };
  };
} | undefined;

export async function loadOrCreateDek(storage?: DekStorage): Promise<CryptoKey> {
  const store: DekStorage = storage ?? {
    get: async () => (await chrome?.storage.local.get(DEK_KEY))?.[DEK_KEY] as string | undefined,
    set: async (v: string) => { await chrome?.storage.local.set({ [DEK_KEY]: v }); },
  };
  const existing = await store.get();
  if (existing) {
    return crypto.subtle.importKey('raw', b64d(existing), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  await store.set(b64e(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
  return key;
}
