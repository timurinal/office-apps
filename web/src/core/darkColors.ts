/**
 * The colours of a document on a dark ground, for the reader who asked for one.
 *
 * A document's colours are the document's: they are hex in the file and they do not change with the
 * theme (docs/core/colors.ts). A dark page is a *view* of them. Two readers of one document, one on
 * a dark page and one on white, see the same file. So these functions are only ever called to
 * draw on screen; nothing here is stored, exported or printed, and print and every export keep
 * the colours as set.
 *
 * ── The map ─────────────────────────────────────────────────────────────────
 * Hue and saturation are kept and lightness is inverted (HSL), so red stays red and a dark blue
 * becomes a light one. Not a CSS filter: a filter also turns pictures and the hue wheel upside down.
 *
 *   ink    (text colour)   inverted, then raised until it reads on the ground at
 *                          INK_CONTRAST_MIN : 1. Never lowered.
 *   fill   (highlight, a   inverted, then lowered until its luminance is at most
 *           cell's fill)   FILL_LUMINANCE_MAX.
 *
 * The two constants are chosen together: an ink at its minimum over a fill at its maximum still
 * reads at 4.5 : 1, so any text colour may sit on any fill without the pair being looked at, which
 * is what a highlight over coloured text, or a coloured cell, is. darkColors.test.ts holds that
 * for every palette pair and for a sweep of random ones.
 */

import { contrast, luminance } from './color';

/** The dark page and the dark sheet, `--paper` in the dark theme (styles.css). */
export const DARK_GROUND = '#232532';
/** Text on the ground: well above the 4.5 : 1 that body text needs, so a pair with a fill holds too. */
export const INK_CONTRAST_MIN = 5.5;
/** The most luminance a mapped fill has. */
export const FILL_LUMINANCE_MAX = 0.03;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` with commas: what safeColor lets in. */
export function parseColour(css: string): Rgba | null {
  const s = css.trim();
  const h = HEX.exec(s);
  if (h) {
    let d = h[1]!;
    if (d.length <= 4) d = [...d].map((c) => c + c).join('');
    const n = (i: number) => parseInt(d.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: d.length === 8 ? n(6) / 255 : 1 };
  }
  const f = FUNC.exec(s);
  if (!f) return null;
  const [r, g, b] = [Number(f[1]), Number(f[2]), Number(f[3])];
  const a = f[4] === undefined ? 1 : Number(f[4]);
  if (r > 255 || g > 255 || b > 255 || a < 0 || a > 1) return null;
  return { r, g, b, a };
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hslOf({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): Hsl {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function rgbOf({ h, s, l }: Hsl): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return { r: to(r), g: to(g), b: to(b) };
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const hexOf = ({ r, g, b }: { r: number; g: number; b: number }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

const out = (rgb: { r: number; g: number; b: number }, a: number): string =>
  a < 1 ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(a * 1000) / 1000})` : hexOf(rgb);

// A sheet paints thousands of cells from a handful of styles; the map is cheap but not free.
const cache = new Map<string, string>();
function memo(key: string, make: () => string): string {
  let v = cache.get(key);
  if (v === undefined) {
    if (cache.size > 4000) cache.clear();
    v = make();
    cache.set(key, v);
  }
  return v;
}

/** The first lightness in `[from, to]` that satisfies `ok`, taking `ok` to be monotonic. */
function search(from: number, to: number, ok: (l: number) => boolean): number {
  let lo = from;
  let hi = to;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A text colour on the dark page. Anything that is not a colour is handed back. */
export function darkInk(css: string, ground: string = DARK_GROUND): string {
  return memo(`i${ground}|${css}`, () => {
    const c = parseColour(css);
    if (!c) return css;
    const { h, s, l } = hslOf(c);
    const reads = (light: number) => contrast(hexOf(rgbOf({ h, s, l: light })), ground) >= INK_CONTRAST_MIN;
    let light = 1 - l;
    if (!reads(light)) light = search(light, 1, reads);
    return out(rgbOf({ h, s, l: light }), c.a);
  });
}

/** A highlight or a cell's fill on the dark page. */
export function darkFill(css: string): string {
  return memo(`f|${css}`, () => {
    const c = parseColour(css);
    if (!c) return css;
    const { h, s, l } = hslOf(c);
    const quiet = (light: number) => luminance(hexOf(rgbOf({ h, s, l: light }))) <= FILL_LUMINANCE_MAX;
    let light = 1 - l;
    if (!quiet(light)) {
      // The brightest lightness that is still quiet: black is, and the inverted one is not.
      let lo = 0;
      let hi = light;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (quiet(mid)) lo = mid;
        else hi = mid;
      }
      light = lo;
    }
    return out(rgbOf({ h, s, l: light }), c.a);
  });
}
