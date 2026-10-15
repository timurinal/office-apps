/**
 * Where a pptx's numbers go: EMU and hundredths of a point to the deck's logical pixels and points.
 *
 * deck.ts states the deck's space: 1920 px wide, the height following the aspect, 1 pt = 2 px,
 * and "a deck of another width is scaled to 1920 on import and back on export". `Space` is that
 * scale for one file. It is made once, from `p:sldSz`, and everything the reader converts goes
 * through it, so a Google Slides deck (10 in wide) and a PowerPoint one (13.33 in) land in the same
 * space and a 44 pt title is the same share of the slide in both.
 *
 * Type scales with the slide, not with the pixel: a 10 in wide slide set in 18 pt is the same
 * picture as a 13.33 in one set in 24 pt, and the deck stores the second. Spacing in points
 * scales the same way. Sizes are kept to the half point, which is what the model keeps.
 */

import { SLIDE_HEIGHT, SLIDE_WIDTH, type Aspect } from '../../slides/model/deck';

export const EMU_PER_POINT = 12700;
/** PowerPoint refuses a slide wider than 56 inches. */
export const MAX_SLIDE_EMU = 56 * 914_400;

/** What each aspect is written as. 4:3 and 16:10 are the sizes PowerPoint's own presets use. */
export const PAGE_EMU: Record<Aspect, { cx: number; cy: number }> = {
  '16:9': { cx: 12_192_000, cy: 6_858_000 },
  '4:3': { cx: 9_144_000, cy: 6_858_000 },
  '16:10': { cx: 9_144_000, cy: 5_715_000 }
};

const RATIO: Record<Aspect, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '16:10': 16 / 10 };

/** Nothing on a slide is further than this from its corner, or larger than this: a hostile file's 9e15 is cut. */
const MAX_COORD = 20_000;

export interface Space {
  aspect: Aspect;
  /** The slide as the file states it, in EMU. */
  cx: number;
  cy: number;
  /** Deck px per EMU. */
  k: number;
  /** Deck points per file point. */
  font: number;
  /** Deck height in px. */
  height: number;
}

function make(aspect: Aspect, cx: number, cy: number): Space {
  const height = SLIDE_HEIGHT[aspect];
  const k = Math.min(SLIDE_WIDTH / cx, height / cy);
  return { aspect, cx, cy, k, font: (EMU_PER_POINT / 2) * k, height };
}

/** The aspect whose ratio is nearest, in the ratio's own terms (so 1.5 is not nearer 16:9 than 16:10 by accident). */
export function nearestAspect(cx: number, cy: number): Aspect {
  const r = cx / cy;
  let best: Aspect = '16:9';
  let bestD = Infinity;
  for (const a of Object.keys(RATIO) as Aspect[]) {
    const d = Math.abs(Math.log(r / RATIO[a]));
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/** The space of a file's `p:sldSz`, or null when it is not a size a slide can be. */
export function spaceOf(cx: number, cy: number): Space | null {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx < 914_400 / 4 || cy < 914_400 / 4 || cx > MAX_SLIDE_EMU || cy > MAX_SLIDE_EMU) return null;
  return make(nearestAspect(cx, cy), cx, cy);
}

/** The space the writer uses for a deck's aspect. */
export const spaceFor = (aspect: Aspect): Space => make(aspect, PAGE_EMU[aspect].cx, PAGE_EMU[aspect].cy);

/** Whether the deck's px per EMU is 16:9's, within a percent. Insets are only spelled out when it is not. */
export const isReferenceScale = (s: Space): boolean => Math.abs(s.k * 6350 - 1) < 0.01;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** EMU to deck px, to a hundredth, and never more than `MAX_COORD` from the origin. */
export const toPx = (s: Space, emu: number): number => round2(Math.max(-MAX_COORD, Math.min(MAX_COORD, emu * s.k)));

/** A length that cannot be negative. */
export const toLen = (s: Space, emu: number): number => round2(Math.max(0, Math.min(MAX_COORD, emu * s.k)));

/** Deck px to EMU. */
export const toEmu = (s: Space, px: number): number => Math.round(px / s.k);

/** A point size as the deck keeps it, from a file's hundredths of a point: scaled, to the half point, 1 to 400. */
export function deckPt(s: Space, hundredths: number): number | undefined {
  if (!Number.isFinite(hundredths) || hundredths <= 0) return undefined;
  const pt = Math.round((hundredths / 100) * s.font * 2) / 2;
  return Math.min(400, Math.max(1, pt));
}

/** Points of spacing, from a file's hundredths of a point, scaled like type. */
export function deckSpacing(s: Space, hundredths: number): number {
  return round2(Math.max(0, Math.min(400, (hundredths / 100) * s.font)));
}

/**
 * A deck point size back to a file's hundredths. A deck that is not at PowerPoint's own scale
 * lands on a quarter-point after dividing; it is snapped to the half point, which is where the
 * original was.
 */
export function filePt(s: Space, pt: number): number {
  const scaled = pt / s.font;
  const snapped = Math.abs(s.font - 1) < 1e-9 ? scaled : Math.round(scaled * 2) / 2;
  return Math.round(Math.min(4000, Math.max(1, snapped)) * 100);
}

/** Deck points of spacing back to hundredths of a point. */
export const fileSpacing = (s: Space, pt: number): number => Math.round(Math.max(0, (pt / s.font) * 100));
