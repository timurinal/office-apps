/**
 * Getting a picture ready, and getting it stored.
 *
 * A picture is made smaller before it leaves the page (the limit in shared/api.ts says so:
 * `assetMaxBytes` is the server's ceiling, not a size to aim at). Decoding and encoding
 * run in the browser's own image pipeline (`createImageBitmap` and
 * `OffscreenCanvas.convertToBlob`), which is off the main thread, so a 12-megapixel photo
 * does not freeze typing.
 *
 * A document on a server keeps its pictures as assets and refers to them by URL. A file
 * with no server (a local document, a locked one, whose pictures must be inside the
 * ciphertext) has nowhere to put an asset, so the picture is embedded as a data URL, and
 * made small enough to be worth that.
 */

import { LIMITS, PATHS, type AssetMeta } from '@shared/api';
import { request } from '../../api';

export const isImageFile = (f: { type: string }): boolean => LIMITS.assetMimes.includes(f.type);

/** The size a picture is brought to: its own, or the long edge at `max`. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The width a picture is first shown at: its own, up to the text column of an 816px page. */
export const DISPLAY_MAX = 648;
export function displaySize(width: number, height: number): { width: number; height: number } {
  return fitWithin(width, height, DISPLAY_MAX);
}

/**
 * How hard a picture is worked on before it is stored. `keepBytes` and `maxEdge` are what
 * a picture may be and be left alone; `budget` is the most the stored picture may weigh;
 * `steps` are the sizes and qualities tried, gentlest first.
 */
export interface Profile {
  budget: number;
  keepBytes: number;
  maxEdge: number;
  steps: ReadonlyArray<{ max: number; q: number }>;
}

/** A document on a server. The page is 816px wide, so 2400 is a good deal of room to zoom. */
export const SERVER_PROFILE: Profile = {
  budget: LIMITS.assetMaxBytes,
  keepBytes: 1536 * 1024,
  maxEdge: 2400,
  steps: [
    { max: 2400, q: 0.86 },
    { max: 1600, q: 0.8 },
    { max: 1100, q: 0.7 }
  ]
};

/** A document with no server: the picture goes inside the document, which has a cap of its own. */
export const INLINE_PROFILE: Profile = {
  budget: 900 * 1024,
  keepBytes: 400 * 1024,
  maxEdge: 1600,
  steps: [
    { max: 1600, q: 0.82 },
    { max: 1100, q: 0.7 },
    { max: 700, q: 0.6 }
  ]
};

export interface PreparedImage {
  blob: Blob;
  mime: string;
  name: string;
  /** Natural size, after any reduction. */
  width: number;
  height: number;
}

const canEncode = (): boolean => typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function';

async function reduce(file: Blob, mime: string, max: number, quality: number): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (!canEncode()) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // The browser cannot decode it, so it cannot make it smaller either.
    return null;
  }
  try {
    const to = fitWithin(bitmap.width, bitmap.height, max);
    const canvas = new OffscreenCanvas(to.width, to.height);
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(bitmap, 0, 0, to.width, to.height);
    const blob = await canvas.convertToBlob({ type: mime, quality });
    return { blob, ...to };
  } finally {
    bitmap.close();
  }
}

async function sizeOf(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const b = await createImageBitmap(file);
    const out = { width: b.width, height: b.height };
    b.close();
    return out;
  } catch {
    return null;
  }
}

/**
 * Bring a picture within a profile, or refuse it. The type is kept: a PNG with
 * transparency cannot become a JPEG. A GIF is never re-encoded (a canvas would keep only
 * its first frame), so it is stored as it is or not at all. A reduction that came out
 * larger than the original is thrown away.
 */
export async function prepareImage(file: File, profile: Profile = SERVER_PROFILE): Promise<PreparedImage> {
  const name = file.name || 'image';
  const natural = (await sizeOf(file)) ?? { width: DISPLAY_MAX, height: Math.round(DISPLAY_MAX * 0.66) };
  const as = (): PreparedImage => ({ blob: file, mime: file.type, name, ...natural });

  if (file.type === 'image/gif') {
    if (file.size > profile.budget) throw new ImageTooLarge();
    return as();
  }
  if (file.size <= profile.keepBytes && Math.max(natural.width, natural.height) <= profile.maxEdge) return as();

  for (const s of profile.steps) {
    const out = await reduce(file, file.type, s.max, s.q);
    if (!out) break;
    if (out.blob.size < file.size && out.blob.size <= profile.budget) {
      return { blob: out.blob, mime: file.type, name, width: out.width, height: out.height };
    }
  }
  if (file.size <= profile.budget) return as();
  throw new ImageTooLarge();
}

export class ImageTooLarge extends Error {
  constructor() {
    super('That image is too large.');
    this.name = 'ImageTooLarge';
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the image.'));
    r.readAsDataURL(blob);
  });
}

/** Store a picture in the document's assets. The URL in the answer is the document's own. */
export function uploadAsset(documentId: string, image: { blob: Blob; mime: string; name: string }): Promise<AssetMeta> {
  return request<AssetMeta>(PATHS.assets(documentId), {
    method: 'POST',
    headers: { 'content-type': image.mime, 'x-asset-name': encodeURIComponent(image.name) },
    body: image.blob
  });
}
