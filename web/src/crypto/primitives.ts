/**
 * The narrow set of primitives everything else in web/src/crypto is built from.
 *
 * One rule runs through this whole directory: **a key is a non-extractable
 * CryptoKey wherever it possibly can be.** Once WebCrypto imports raw bytes
 * with `extractable: false`, script cannot read them back — not this code, not
 * an XSS payload, not a compromised dependency. Raw `Uint8Array` key material
 * exists only in the moments between deriving a key and importing it, and those
 * moments are confined to this file and `keys.ts`.
 *
 * Everything is AES-256-GCM, HKDF-SHA256 or ECDH P-256. P-256 rather than the
 * nicer X25519 because Safari still does not implement X25519 in WebCrypto, and
 * a polyfill would mean doing curve arithmetic in extractable JS values.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s: string): Bytes => enc.encode(s) as Bytes;
export const fromUtf8 = (b: BufferSource): string => dec.decode(b);

// ── encoding ────────────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  // Chunked: String.fromCharCode(...bytes) blows the argument limit somewhere
  // around 100k bytes, and thumbnails get close.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out as Bytes;
}

export const toBase64Url = (bytes: Uint8Array): string =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function fromBase64Url(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// ── random ──────────────────────────────────────────────────────────────────

export const randomBytes = (n: number): Bytes =>
  crypto.getRandomValues(new Uint8Array(n)) as Bytes;

// ── AES-256-GCM ─────────────────────────────────────────────────────────────

/** 96 bits, the only IV length AES-GCM is actually specified for. */
export const IV_LENGTH = 12;

/**
 * Wire format for a single encrypted value: `<iv_b64>.<ciphertext_b64>`.
 *
 * The same shape the account site uses for TOTP secrets, so anyone reading both
 * codebases meets one convention. The IV is random per encryption and stored
 * beside the ciphertext, which is safe for GCM as long as it is never reused
 * under one key — 96 random bits guarantees that for any realistic number of
 * encryptions under a given key.
 */
export async function aesEncrypt(
  key: CryptoKey,
  plaintext: BufferSource,
  aad?: BufferSource
): Promise<string> {
  const iv = randomBytes(IV_LENGTH);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) },
    key,
    plaintext
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`;
}

/**
 * Reverses `aesEncrypt`. Throws on a wrong key, a tampered ciphertext or
 * mismatched AAD — GCM authenticates, so all three surface identically and
 * none of them can return partial plaintext.
 */
export async function aesDecrypt(
  key: CryptoKey,
  payload: string,
  aad?: BufferSource
): Promise<Bytes> {
  const dot = payload.indexOf('.');
  if (dot < 0) throw new Error('Malformed ciphertext: expected <iv>.<ct>.');

  const iv = fromBase64(payload.slice(0, dot));
  if (iv.length !== IV_LENGTH) throw new Error('Malformed ciphertext: bad IV length.');

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) },
    key,
    fromBase64(payload.slice(dot + 1))
  );
  return new Uint8Array(plain) as Bytes;
}

export const aesEncryptString = (key: CryptoKey, s: string, aad?: BufferSource) =>
  aesEncrypt(key, utf8(s), aad);

export const aesDecryptString = async (key: CryptoKey, payload: string, aad?: BufferSource) =>
  fromUtf8(await aesDecrypt(key, payload, aad));

/**
 * Import 32 raw bytes as an AES-256-GCM key.
 *
 * `extractable` defaults to false and should stay false at every call site that
 * does not need the bytes back. The one legitimate exception is a key about to
 * be wrapped under another key — see `exportRaw`.
 */
export const importAesKey = (raw: BufferSource, extractable = false): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, ['encrypt', 'decrypt']);

/** A fresh AES-256-GCM key. Extractable, because a node key only exists to be
 *  wrapped under its parent, and wrapping needs the bytes. */
export const generateAesKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export const exportRaw = async (key: CryptoKey): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.exportKey('raw', key)) as Bytes;

// ── HKDF-SHA256 ─────────────────────────────────────────────────────────────

/**
 * Derive an AES key from input keying material.
 *
 * `info` is the domain separator and it is never optional here. Two keys
 * derived from one secret with different `info` strings are computationally
 * unrelated, which is the property the share-link design leans on entirely:
 * the same 32-byte link secret yields both the key that decrypts the file and
 * the token presented to the server, and holding the token tells you nothing
 * about the key.
 */
export async function hkdfAesKey(
  ikm: BufferSource,
  info: string,
  salt: BufferSource = new Uint8Array(0),
  extractable = false
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

/** HKDF to raw bytes, for values that are not keys — bearer tokens, verifiers. */
export async function hkdfBytes(
  ikm: BufferSource,
  info: string,
  length = 32,
  salt: BufferSource = new Uint8Array(0)
): Promise<Bytes> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) },
    base,
    length * 8
  );
  return new Uint8Array(bits) as Bytes;
}

// ── hashing ─────────────────────────────────────────────────────────────────

export async function sha256(input: BufferSource): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input)) as Bytes;
}

export const sha256Hex = async (input: BufferSource): Promise<string> =>
  toHex(await sha256(input));

/**
 * HMAC-SHA256 under an AES key's bytes.
 *
 * Used for `nodes.name_hmac`: the server enforces "no two siblings share a
 * name" by comparing these, holding neither the name nor the key that produced
 * them. Requires the key to be extractable, which node keys are.
 */
export async function hmacSha256(key: CryptoKey, message: BufferSource): Promise<Bytes> {
  const raw = await exportRaw(key);
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, message)) as Bytes;
}

// ── constant-time comparison ────────────────────────────────────────────────

/** Compares two equal-length byte strings without an early return. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
