/**
 * A picture's pictures, as data URLs.
 *
 * The SVG has to stand alone: opened in another program, or drawn as an image to make the PNG, it
 * can reach nothing of the page's, so every picture it shows is written into it. A picture that
 * cannot be had (the asset is gone, the network is off, it is not one of the four kinds the assets
 * API takes) is left out, and the caller says how many were.
 */

import { toBase64 } from './fonts';

/** All the pictures of one file together, so a file that is a few hundred MB of pictures is not made. */
const BUDGET = 48 * 1024 * 1024;

export type Fetch = (url: string) => Promise<Uint8Array | null>;

const defaultFetch: Fetch = async (url) => {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
};

/** The kind of a picture from its bytes, never from what the server called it. */
export function sniff(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length > 6 && String.fromCharCode(...bytes.subarray(0, 4)) === 'GIF8') return 'image/gif';
  return null;
}

const isInline = (url: string): boolean => /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url);

/** Each address as a data URL, or null where it could not be had. */
export async function inlineImages(urls: Iterable<string>, fetchImage: Fetch = defaultFetch): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  let spent = 0;
  for (const url of new Set(urls)) {
    if (isInline(url)) {
      out.set(url, url);
      continue;
    }
    if (/^data:/i.test(url)) {
      out.set(url, null);
      continue;
    }
    const got = await fetchImage(url);
    const type = got ? sniff(got) : null;
    if (!got || !type || spent + got.length > BUDGET) {
      out.set(url, null);
      continue;
    }
    spent += got.length;
    out.set(url, `data:${type};base64,${toBase64(got)}`);
  }
  return out;
}
