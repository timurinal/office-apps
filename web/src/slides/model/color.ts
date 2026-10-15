/**
 * A deck's colours, resolved against its theme.
 *
 * A stored colour is `#rrggbb` or a theme slot with a tint (deck.ts, `Color`). `lum` mixes the
 * slot's colour toward black (negative) or white (positive) in sRGB, and `alpha` fades it; the
 * editor's CSS does the same with `color-mix(in srgb, …)` (`cssColorVar`), so a tint reads the
 * same in a thumbnail drawn here and in a text box Tiptap draws. Changing a theme changes every
 * slot colour in the deck, which is the point of storing slots.
 *
 * Pure: no DOM.
 */

import type { Color, ThemeJSON, ThemeSlot } from './deck';
import { safeColor } from './safe';

const parse = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16)
];

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** `#rrggbb` mixed toward black (lum < 0) or white (lum > 0). */
export function tint(hex: string, lum: number): string {
  if (!lum) return hex;
  const [r, g, b] = parse(hex);
  const t = Math.min(1, Math.abs(lum));
  const to = lum < 0 ? 0 : 255;
  return `#${hex2(r + (to - r) * t)}${hex2(g + (to - g) * t)}${hex2(b + (to - b) * t)}`;
}

const FALLBACK: Record<ThemeSlot, string> = {
  dk1: '#000000',
  lt1: '#ffffff',
  dk2: '#44546a',
  lt2: '#e7e6e6',
  accent1: '#4472c4',
  accent2: '#ed7d31',
  accent3: '#a5a5a5',
  accent4: '#ffc000',
  accent5: '#5b9bd5',
  accent6: '#70ad47',
  hlink: '#0563c1'
};

/** A theme slot's own colour, checked: a theme is stored data too. */
export function slotColor(theme: ThemeJSON | null | undefined, slot: ThemeSlot): string {
  const raw = theme?.colors?.[slot];
  const ok = safeColor(raw);
  return typeof ok === 'string' ? ok : FALLBACK[slot];
}

/**
 * A colour as CSS: `#rrggbb`, or `rgba(…)` when it has alpha. Null for no colour, or for a
 * stored value that is not a colour.
 */
export function resolveColor(c: Color | null | undefined, theme: ThemeJSON | null | undefined): string | null {
  const safe = safeColor(c);
  if (safe === null) return null;
  if (typeof safe === 'string') return safe;
  const hex = tint(slotColor(theme, safe.theme), safe.lum ?? 0);
  if (safe.alpha === undefined) return hex;
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(safe.alpha * 1000) / 1000})`;
}

/** The theme's slots as CSS custom properties (`--th-accent1`), for the text editor's own DOM. */
export function themeVars(theme: ThemeJSON | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of Object.keys(FALLBACK) as ThemeSlot[]) out[`--th-${slot}`] = slotColor(theme, slot);
  return out;
}

/**
 * A colour as CSS that reads the theme from `--th-*` variables, for markup that is rendered
 * without the theme to hand (a mark's `renderHTML`). The same arithmetic as `resolveColor`.
 */
export function cssColorVar(c: Color | null | undefined): string | null {
  const safe = safeColor(c);
  if (safe === null) return null;
  if (typeof safe === 'string') return safe;
  let css = `var(--th-${safe.theme})`;
  if (safe.lum) {
    const keep = Math.round((1 - Math.min(1, Math.abs(safe.lum))) * 1000) / 10;
    css = `color-mix(in srgb, ${css} ${keep}%, ${safe.lum < 0 ? '#000000' : '#ffffff'})`;
  }
  if (safe.alpha !== undefined) css = `color-mix(in srgb, ${css} ${Math.round(safe.alpha * 1000) / 10}%, transparent)`;
  return css;
}

/** Relative luminance, for choosing a readable ink on a fill. */
export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
