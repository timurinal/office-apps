/**
 * Autofit: how wide a column or how tall a row has to be for what is in it, measured the way
 * the grid draws it (grid/text.ts: Inter at the cell's size, 600 for bold, the board's padding).
 *
 * The page measures with a canvas: an `OffscreenCanvas` where there is one, which needs no
 * document, and a detached `<canvas>` otherwise. Without either (a test in Node, a Worker with
 * no OffscreenCanvas) an estimate from the em stands in; it is close for Inter's digits and a
 * little generous for text, which is the side to err on.
 */

import { breakLines, fontFor } from '../grid/text';
import type { CellStyle } from '../grid/types';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from './structure';

export interface Measure {
  /** CSS pixels of `text` in the CSS font `font`. */
  width(font: string, text: string): number;
}

/** The grid's padding (grid/paint.ts `PAD_X`, `PAD_Y`) and its line height (1.25 em). */
const PAD_X = 8;
const PAD_Y = 3;
const LINE = 1.25;
/** About three characters of the default font, as the grid indents. */
const INDENT_PX = 3 * 7;
/** Nobody wants a column autofitted wider than a screen. */
const MAX_WIDTH = 1000;
const MIN_WIDTH = 24;
const MAX_HEIGHT = 409 * (4 / 3);

/** The em estimate: average advance per character for Inter, regular and semibold. */
export function estimateMeasure(): Measure {
  return {
    width(font, text) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 13.33);
      const bold = /\b(600|700|bold)\b/.test(font);
      let w = 0;
      for (const ch of text) {
        const narrow = /[ilIj.,:;'|!1]/.test(ch);
        const wide = /[MWmw@%]/.test(ch);
        w += px * (narrow ? 0.3 : wide ? 0.85 : /\d/.test(ch) ? 0.58 : 0.56);
      }
      return w * (bold ? 1.05 : 1);
    }
  };
}

let shared: Measure | null = null;

/** A canvas's measureText where there is a canvas, the estimate otherwise. One per page. */
export function defaultMeasure(): Measure {
  if (shared) return shared;
  let ctx: { font: string; measureText(t: string): { width: number } } | null = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(1, 1).getContext('2d');
    else if (typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return (shared = estimateMeasure());
  const c = ctx;
  const cache = new Map<string, number>();
  shared = {
    width(font, text) {
      const k = `${font}\u0000${text}`;
      let w = cache.get(k);
      if (w === undefined) {
        if (c.font !== font) c.font = font;
        w = c.measureText(text).width;
        if (cache.size > 20_000) cache.clear();
        cache.set(k, w);
      }
      return w;
    }
  };
  return shared;
}

export interface FitCell {
  text: string;
  style: CellStyle;
}

/** The width a column needs for its cells; the default when it has nothing to show. */
export function fitWidth(cells: Iterable<FitCell>, m: Measure): number {
  let best = 0;
  for (const c of cells) {
    if (!c.text) continue;
    const font = fontFor(c.style, undefined, 1).css;
    let w = 0;
    for (const line of c.text.split('\n')) w = Math.max(w, m.width(font, line));
    w += 2 * PAD_X + (c.style.indent ?? 0) * INDENT_PX + 1;
    best = Math.max(best, w);
  }
  return best === 0 ? DEFAULT_COL_WIDTH : Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, best)));
}

/** The height a row needs for its cells, wrapped ones at their column's width; never under the default. */
export function fitHeight(cells: Iterable<FitCell & { width: number }>, m: Measure): number {
  let best = DEFAULT_ROW_HEIGHT;
  for (const c of cells) {
    if (!c.text) continue;
    const spec = fontFor(c.style, undefined, 1);
    const lines = c.style.wrap
      ? breakLines(c.text, Math.max(1, c.width - 2 * PAD_X), (s) => m.width(spec.css, s)).length
      : c.text.split('\n').length;
    best = Math.max(best, lines * spec.px * LINE + 2 * PAD_Y);
  }
  return Math.round(Math.min(MAX_HEIGHT, best));
}
