/**
 * A presentation file to a new deck: the entry point the page calls, as `importSheets.ts` is for
 * spreadsheets.
 *
 *     const out = importSlides('Kick-off.pptx', bytes);
 *     const doc = await documents.create({ kind: 'slides', title: out.title, state: out.stateBase64 });
 *
 * Everything is worked out here, off the main thread when the page calls it from its worker: the file
 * is read (`pptx/read.ts`, with its own caps), the deck is written as the new document's Yjs state and
 * checked against the room's cap, and nothing is sent until the whole file has been accepted.
 *
 * A picture cannot be uploaded before the document exists, so the state names each one by a
 * placeholder asset id (`import-3`), and `images` carries its bytes under that id. The page uploads them
 * and rewrites the placeholders in the room (home/importFiles.ts), as it does for a Word document.
 */

import { fromBase64, toBase64 } from '../crypto/primitives';
import type { AssetRef, DeckJSON } from '../slides/model/deck';
import { DeckInvalid, DeckTooLarge, deckToY } from '../slides/model/ydoc';
import { FormatError } from './errors';
import { MAX_FILE_BYTES } from './limits';
import { readPptx } from './pptx';
import type { Warning } from './types';

/** A placeholder asset id: what the state names a picture by until it is uploaded. */
export const SLIDE_IMAGE_TOKEN_PREFIX = 'import-';
export const isSlideImageToken = (id: unknown): id is string => typeof id === 'string' && /^import-\d{1,4}$/.test(id);

export interface SlidesImportImage {
  /** The placeholder id the state names it by. */
  token: string;
  bytes: Uint8Array;
  mime: string;
  name: string;
}

export interface SlidesImportOutcome {
  title: string;
  /** `POST /documents`' `state`: the deck as a Yjs update, base64. */
  stateBase64: string;
  /** How many slides the deck has, for a walk and a toast. */
  slides: number;
  images: SlidesImportImage[];
  warnings: Warning[];
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** The presentations Home takes: a deck, a show and a template are one package. */
export const SLIDES_EXTENSIONS = ['pptx', 'ppsx', 'potx'] as const;

export const isSlidesFileName = (name: string): boolean => {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase();
  return !!ext && (SLIDES_EXTENSIONS as readonly string[]).includes(ext);
};

/** The file's name as a title: no extension, no path, no stray whitespace. The file's own title when the name is empty. */
export function slidesTitleOf(fileName: string, fromFile: string | null = null): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || fromFile?.replace(/[\u0000-\u001f]/g, ' ').trim() || 'Untitled presentation').slice(0, 200);
}

/**
 * Give each picture the deck holds inline a placeholder id, in place, and take its bytes out. The
 * reader shares one `AssetRef` object between every element that shows a picture; two objects with
 * the same bytes are one picture as well.
 */
export function takeImages(deck: DeckJSON): SlidesImportImage[] {
  const images: SlidesImportImage[] = [];
  const byObject = new Map<AssetRef, string>();
  const byData = new Map<string, string>();
  const take = (ref: AssetRef): void => {
    let token = byObject.get(ref);
    if (!token && typeof ref.data === 'string') {
      token = byData.get(ref.data);
      if (!token) {
        const mime = ref.mime ?? '';
        token = `${SLIDE_IMAGE_TOKEN_PREFIX}${images.length}`;
        images.push({ token, bytes: fromBase64(ref.data), mime, name: `picture-${images.length + 1}.${EXT[mime] ?? 'png'}` });
        byData.set(ref.data, token);
      }
      byObject.set(ref, token);
    }
    if (!token) return;
    delete ref.data;
    delete ref.mime;
    ref.id = token;
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'asset' && v && typeof v === 'object' && !Array.isArray(v)) take(v as AssetRef);
        else walk(v);
      }
    }
  };
  walk(deck);
  return images;
}

export function importSlides(fileName: string, bytes: Uint8Array): SlidesImportOutcome {
  if (!isSlidesFileName(fileName)) throw new FormatError('unsupported');
  if (bytes.length === 0) throw new FormatError('empty');
  if (bytes.length > MAX_FILE_BYTES) throw new FormatError('too_large', `${bytes.length} bytes`);
  const read = readPptx(bytes);
  const images = takeImages(read.deck);
  let state: Uint8Array;
  try {
    state = deckToY(read.deck);
  } catch (err) {
    if (err instanceof DeckTooLarge || err instanceof DeckInvalid) throw new FormatError('deck_too_large', err.message);
    throw err;
  }
  return {
    title: slidesTitleOf(fileName, read.title),
    stateBase64: toBase64(state),
    slides: read.deck.slides.length,
    images,
    warnings: read.details
  };
}
