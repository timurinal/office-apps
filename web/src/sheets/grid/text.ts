/**
 * Text on the canvas: measuring it, breaking it, and choosing where it goes. Measuring is the
 * costly part of a frame, so widths are cached by font and text; the cache is dropped when the
 * fonts finish loading, because Inter arriving changes every width.
 */

import { DEFAULT_FONT_PT, FONT_FAMILY } from './theme';
import type { CellStyle, GridCell } from './types';

export type Align = 'left' | 'center' | 'right';

/** `general` puts numbers on the right and text on the left, and booleans and errors in the middle, as Excel does. */
export function alignOf(cell: Pick<GridCell, 'kind'> & { style: Pick<CellStyle, 'h'> }): Align {
  const h = cell.style.h ?? 'general';
  if (h !== 'general') return h;
  return cell.kind === 'number' ? 'right' : cell.kind === 'boolean' || cell.kind === 'error' ? 'center' : 'left';
}

export interface FontSpec {
  /** A CSS font shorthand at the pixel size to draw at. */
  css: string;
  /** The em in pixels, for lines and baselines. */
  px: number;
}

const PX_PER_PT = 4 / 3;

/** The font a cell draws in, at `scale` pixels per CSS pixel (zoom times the device's ratio). */
export function fontFor(
  style: CellStyle,
  cond: GridCell['conditional'] | undefined,
  scale: number
): FontSpec {
  const px = (style.size ?? DEFAULT_FONT_PT) * PX_PER_PT * scale;
  const bold = cond?.bold ?? style.bold;
  const italic = cond?.italic ?? style.italic;
  const family = style.font && style.font !== 'Inter' ? `"${style.font.replace(/"/g, '')}", ${FONT_FAMILY}` : FONT_FAMILY;
  return { css: `${italic ? 'italic ' : ''}${bold ? 600 : 400} ${px}px ${family}`, px };
}

export class TextMeter {
  private widths = new Map<string, Map<string, number>>();
  private entries = 0;
  private wraps = new Map<string, string[]>();
  private current = '';

  constructor(private readonly ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>) {}

  /** Select a font on the context, skipping the call (which is not free) when it is already set. */
  setFont(css: string): void {
    if (this.current !== css) {
      this.ctx.font = css;
      this.current = css;
    }
  }

  /** The context's font was changed behind the meter's back (a `restore()`): select it again next time. */
  forgetFont(): void {
    this.current = '';
  }

  width(font: string, text: string): number {
    let m = this.widths.get(font);
    if (!m) {
      m = new Map();
      this.widths.set(font, m);
    }
    let w = m.get(text);
    if (w === undefined) {
      this.setFont(font);
      w = this.ctx.measureText(text).width;
      m.set(text, w);
      if (++this.entries > 40_000) this.reset();
    }
    return w;
  }

  /** Lines of `text` no wider than `max`, broken at spaces and, for a word too long, anywhere. */
  wrap(font: string, text: string, max: number): string[] {
    const key = `${font}\u0000${Math.round(max)}\u0000${text}`;
    let lines = this.wraps.get(key);
    if (!lines) {
      lines = breakLines(text, max, (s) => this.width(font, s));
      if (this.wraps.size > 4_000) this.wraps.clear();
      this.wraps.set(key, lines);
    }
    return lines;
  }

  /** Forget everything: the fonts changed, or the zoom did. */
  reset(): void {
    this.widths.clear();
    this.wraps.clear();
    this.entries = 0;
    this.current = '';
  }
}

/** Greedy line breaking over a width function. A newline in the text always breaks. */
export function breakLines(text: string, max: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const tryLine = line === '' ? word : `${line} ${word}`;
      if (width(tryLine) <= max) {
        line = tryLine;
        continue;
      }
      if (line !== '') out.push(line);
      line = '';
      if (width(word) <= max) {
        line = word;
        continue;
      }
      // A word wider than the cell: break it where it overflows.
      let piece = '';
      for (const ch of word) {
        if (piece !== '' && width(piece + ch) > max) {
          out.push(piece);
          piece = ch;
        } else piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

/** Excel's answer to a number that does not fit its column: hashes, as many as fit. */
export function hashes(avail: number, hashWidth: number): string {
  return '#'.repeat(Math.max(1, Math.floor(avail / Math.max(1, hashWidth))));
}
