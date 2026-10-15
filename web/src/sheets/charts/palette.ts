/**
 * The colours a chart wears, and the ink it is drawn in.
 *
 * A chart is content, so it keeps its own colours and not the app's green (docs/design/README.md,
 * "Colour"); and it is drawn on white whatever the theme, because it is also a picture people
 * paste into other documents and print. Six series colours, chosen to read on white and to stay
 * apart for a reader with a colour-vision deficiency, then checked with the data-viz skill's
 * validator against #ffffff:
 *
 *   lightness band, chroma floor  pass
 *   adjacent CVD separation       worst pair 8.3 (the target is 8)
 *   normal-vision floor           worst pair 18.5 (the floor is 15)
 *   contrast on the surface       every colour at least 3:1
 *
 * The order is the safety, so a series takes the next colour in turn and a filter that removes
 * one never repaints the rest. More than six series repeat the order; set the colours in the
 * chart pane when there are that many.
 */

export const SERIES_COLORS = ['#2a78d6', '#e0602a', '#14946a', '#b87a00', '#c8467a', '#6a4fc2'] as const;

export const INK = {
  surface: '#ffffff',
  title: '#292b31',
  text: '#595d6c',
  /** Gridlines: a hairline one step off the surface. */
  grid: '#f0f1f8',
  axis: '#e4e7f5'
} as const;

/** The colour of series (or slice) `i`: its own, if one was chosen, else the next of the six. */
export function colorFor(i: number, chosen?: readonly string[]): string {
  const own = chosen?.[i];
  return own && own.trim() !== '' ? own : SERIES_COLORS[i % SERIES_COLORS.length]!;
}

/** `#rrggbb` to a luminance 0 to 1, for choosing white or ink on a fill. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** White on a dark fill, ink on a light one: whichever has the more contrast. */
export const onFill = (hex: string): string => (luminance(hex) > 0.4 ? INK.title : '#ffffff');

/** `#rgb` and `#rrggbb` as `#rrggbb`, anything else as null: what an input of type colour holds. */
export function cleanColor(c: string): string | null {
  const t = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase() : null;
}
