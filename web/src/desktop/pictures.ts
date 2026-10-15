/**
 * A presentation's pictures, kept with the file instead of on a server.
 *
 * A slide names a picture by an asset id (`slides/model/deck.ts`), as it does upstream of the
 * room; here the id names an entry in the window's `PictureStore`, which the file carries beside
 * the deck (`container.ts`). The editor draws one through `documentAssets` (a blob: address made
 * when it is first drawn) and adds one through the insert module's upload step, both pointed at
 * the window's store by `slidesPictures.ts`.
 */

import { LIMITS } from '@shared/api';

export interface StoredPicture {
  id: string;
  mime: string;
  name: string;
  bytes: Uint8Array;
}

export const isPictureId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
export const isPictureMime = (mime: unknown): mime is string => typeof mime === 'string' && LIMITS.assetMimes.includes(mime);

/** A new picture's id: unlike any the store has. */
export function newPictureId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return `p${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export class PictureStore {
  private readonly items = new Map<string, StoredPicture>();
  private readonly urls = new Map<string, string>();
  private readonly listeners = new Set<(p: StoredPicture) => void>();

  constructor(pictures: readonly StoredPicture[] = []) {
    for (const p of pictures) this.items.set(p.id, p);
  }

  add(p: StoredPicture): void {
    if (this.items.has(p.id)) return;
    this.items.set(p.id, p);
    for (const l of this.listeners) l(p);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** An address the page can draw it from, or null for an id the store does not have. */
  url(id: string): string | null {
    const have = this.urls.get(id);
    if (have) return have;
    const p = this.items.get(id);
    if (!p) return null;
    const made = URL.createObjectURL(new Blob([p.bytes as BlobPart], { type: p.mime }));
    this.urls.set(id, made);
    return made;
  }

  /** Every picture, or only those `ids` names. */
  list(ids?: ReadonlySet<string>): StoredPicture[] {
    return [...this.items.values()].filter((p) => !ids || ids.has(p.id));
  }

  onAdd(listener: (p: StoredPicture) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.listeners.clear();
  }
}

/** Every asset id a deck (or any part of one) names: `{ asset: { id } }` wherever it is. */
export function pictureIdsIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) pictureIdsIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'asset' && v && typeof v === 'object' && isPictureId((v as { id?: unknown }).id)) out.add((v as { id: string }).id);
      else pictureIdsIn(v, out);
    }
  }
  return out;
}
