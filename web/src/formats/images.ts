/**
 * Which pictures are pictures.
 *
 * A file's own claim about a picture (its extension, a `content-type`, a data URL's type)
 * is not evidence of anything. The bytes are: PNG, JPEG, GIF and WebP begin in ways that
 * nothing else does, and those four are the only formats the upload route takes. The server
 * checks again; this is so a document is not made with a picture it would refuse.
 */

import { LIMITS } from '@shared/api';

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);

/** The type a picture's first bytes say, or null for anything that is not one of the four. */
export function assetMimeOf(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Fit for the upload route: a known type, not empty, within the asset limit. */
export const uploadable = (b: Uint8Array): boolean => b.byteLength > 0 && b.byteLength <= LIMITS.assetMaxBytes && assetMimeOf(b) !== null;

const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/\s]+={0,2})\s*$/i;

/** The bytes of a `data:image/…;base64,…` URL when it is one of the four, else null. */
export function decodeDataImage(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = DATA_IMAGE.exec(src.trim());
  if (!m) return null;
  try {
    const bin = atob(m[2]!.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // The declared type is checked against the bytes; the bytes win.
    const real = assetMimeOf(bytes);
    return real ? { bytes, mime: real } : null;
  } catch {
    return null;
  }
}

/** Standard base64 in pieces: `btoa(String.fromCharCode(...bytes))` overflows the stack on a large picture. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** A picture's natural size, read from its header, or null when the header is not in the usual place. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const mime = assetMimeOf(b);
  const u16be = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const u16le = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const u24le = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
  const u32be = (i: number) => (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
  if (mime === 'image/png') return b.length >= 24 ? { width: u32be(16), height: u32be(20) } : null;
  if (mime === 'image/gif') return b.length >= 10 ? { width: u16le(6), height: u16le(8) } : null;
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1] ?? 0;
      // Start-of-frame markers carry the size; the others are skipped by their length.
      if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) return { height: u16be(i + 5), width: u16be(i + 7) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) i += 2;
      else i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (mime === 'image/webp' && b.length >= 30) {
    const kind = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0);
    if (kind === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === 'VP8X') return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (kind === 'VP8L') {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
