const enc = new TextEncoder();
const dec = new TextDecoder();
const b64e = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return btoa(s);
};
const b64d = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(pass: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await globalThis.crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function exportVaultJson(entriesJson: string, pass: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await keyFrom(pass, salt), enc.encode(entriesJson));
  return JSON.stringify({ v: 1, salt: b64e(salt), iv: b64e(iv), data: b64e(new Uint8Array(ct)) });
}

export async function importVaultJson(blob: string, pass: string): Promise<string> {
  const o = JSON.parse(blob) as { v: number; salt: string; iv: string; data: string };
  if (o.v !== 1) throw new Error('datacloak: unsupported vault export version');
  try {
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(o.iv) as BufferSource }, await keyFrom(pass, b64d(o.salt)), b64d(o.data) as BufferSource);
    return dec.decode(pt);
  } catch {
    throw new Error('datacloak: wrong passphrase or corrupt vault export');
  }
}
