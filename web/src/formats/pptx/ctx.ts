/**
 * What a reader of one pptx carries from part to part: the package, the slide space, the warnings,
 * the pictures taken so far, and for the part being read its relationships, theme and colours.
 */

import { LIMITS } from '@shared/api';
import type { AssetRef } from '../../slides/model/deck';
import { assetMimeOf, bytesToBase64, imageSize } from '../images';
import { MAX_IMAGES } from '../limits';
import { plural, Warnings } from '../types';
import type { Rel } from './package';
import type { PptxPackage } from './package';
import type { ColorEnv } from './color';
import type { ParsedTheme } from './theme';
import type { Space } from './units';

/** Pictures taller or wider than this, or with more pixels than this, are not shown. */
const MAX_SIDE = 16_384;
const MAX_PIXELS = 100_000_000;

/** All the text of a deck, in characters. A real one is a few hundred thousand at the very most. */
export const MAX_DECK_CHARS = 4_000_000;

/** Why a picture's bytes are not a picture the deck can hold. */
function whyNot(b: Uint8Array): 'vector' | 'other' {
  const at = (i: number, ...v: number[]): boolean => v.every((x, k) => b[i + k] === x);
  // EMF: record type 1 and " EMF" at 40. WMF: the placeable header, or a plain one. TIFF, BMP. SVG is text.
  if ((at(0, 1, 0, 0, 0) && at(40, 0x20, 0x45, 0x4d, 0x46)) || at(0, 0xd7, 0xcd, 0xc6, 0x9a) || at(0, 1, 0, 9, 0) || at(0, 2, 0, 9, 0)) return 'vector';
  if (at(0, 0x49, 0x49, 0x2a, 0) || at(0, 0x4d, 0x4d, 0, 0x2a) || at(0, 0x42, 0x4d)) return 'vector';
  const head = new TextDecoder('latin1').decode(b.subarray(0, 512)).toLowerCase();
  return head.includes('<svg') ? 'vector' : 'other';
}

/**
 * Pictures by the part they are stored in. A picture is what its bytes say, never what its name
 * or its content type says; only PNG, JPEG, GIF and WebP are kept, each at most the asset limit,
 * and no more than `MAX_IMAGES` different ones. Every loss is counted once and said once.
 */
export class ImageStore {
  private readonly cache = new Map<string, AssetRef | null>();
  private kept = 0;

  constructor(
    private readonly pkg: PptxPackage,
    private readonly warnings: Warnings
  ) {}

  load(path: string | null): AssetRef | null {
    if (!path) return null;
    const hit = this.cache.get(path);
    if (hit !== undefined) return hit;
    const ref = this.read(path);
    this.cache.set(path, ref);
    return ref;
  }

  private read(path: string): AssetRef | null {
    const bytes = this.pkg.bytes(path);
    if (!bytes || bytes.length === 0) {
      this.warnings.add('picture-missing', (n) => `${plural(n, 'picture')} the file points at could not be found and ${n === 1 ? 'was' : 'were'} left out.`);
      return null;
    }
    const mime = assetMimeOf(bytes);
    if (!mime) {
      if (whyNot(bytes) === 'vector') this.warnings.add('picture-format', (n) => `${plural(n, 'picture')} in a format that cannot be shown (EMF, WMF, SVG or TIFF) ${n === 1 ? 'was' : 'were'} left out.`);
      else this.warnings.add('picture-bytes', (n) => `${plural(n, 'picture')} that ${n === 1 ? 'is not a picture file was' : 'are not picture files were'} left out.`);
      return null;
    }
    if (bytes.length > LIMITS.assetMaxBytes) {
      this.warnings.add('picture-size', (n) => `${plural(n, 'picture')} larger than ${LIMITS.assetMaxBytes / (1024 * 1024)} MB ${n === 1 ? 'was' : 'were'} left out.`);
      return null;
    }
    const size = imageSize(bytes);
    // A header that claims a picture the browser cannot hold: a few bytes that ask for gigabytes of pixels.
    if (size && (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS)) {
      this.warnings.add('picture-pixels', (n) => `${plural(n, 'picture')} with more pixels than can be shown ${n === 1 ? 'was' : 'were'} left out.`);
      return null;
    }
    if (this.kept >= MAX_IMAGES) {
      this.warnings.add('picture-count', (n) => `${plural(n, 'picture')} past the ${MAX_IMAGES} a presentation can hold ${n === 1 ? 'was' : 'were'} left out.`);
      return null;
    }
    this.kept++;
    return { data: bytesToBase64(bytes), mime };
  }
}

/** Shared by every part of one file. */
export interface DeckCtx {
  pkg: PptxPackage;
  space: Space;
  warnings: Warnings;
  images: ImageStore;
  /** Characters of text read so far, against `MAX_DECK_CHARS`. */
  chars: number;
}

/** One part being read: a master, a layout, a slide, a notes slide. */
export interface PartCtx {
  deck: DeckCtx;
  part: string;
  rels: Map<string, Rel>;
  theme: ParsedTheme;
  color: ColorEnv;
}

/** The part a relationship id names, if it is inside the package. */
export function relTarget(pc: PartCtx, id: string | undefined): string | null {
  return id ? pc.deck.pkg.target(pc.part, pc.rels.get(id)) : null;
}

/** The picture a relationship id names. */
export function relImage(pc: PartCtx, id: string | undefined): AssetRef | null {
  if (!id) return null;
  const rel = pc.rels.get(id);
  if (rel?.external) {
    pc.deck.warnings.add('picture-linked', (n) => `${plural(n, 'picture')} linked from outside the file ${n === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  return pc.deck.images.load(pc.deck.pkg.target(pc.part, rel));
}

/** The same file and theme, read from another part (a chart, a diagram's drawing), with that part's relationships. */
export const enter = (pc: PartCtx, part: string): PartCtx => ({ ...pc, part, rels: pc.deck.pkg.rels(part) });
