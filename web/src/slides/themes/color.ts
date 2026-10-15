/**
 * Colour arithmetic for a deck: a `Color` (deck.ts) resolved against a theme, and WCAG contrast.
 *
 * Pure, no DOM. The themes' own tests use it to hold every text style to a contrast, and the
 * template sketches use it to draw a slide in its own colours.
 *
 * `lum` mixes the colour toward white (positive) or black (negative) in sRGB, as `model/color.ts`
 * does and the editor's CSS does with `color-mix`. This file repeats that arithmetic so the themes
 * do not depend on the model; `color.test.ts` holds the two to the same answer.
 */

import type { Color, ThemeJSON, ThemeSlot } from '../model/deck';

const HEX = /^#[0-9a-f]{6}$/;

export const isHex = (value: string): boolean => HEX.test(value);

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** A colour mixed `lum` of the way to white (positive) or to black (negative), in sRGB. */
export function withLum(hex: string, lum: number): string {
  if (!lum) return hex;
  const t = Math.min(1, Math.abs(lum));
  const to = lum < 0 ? 0 : 255;
  return toHex(toRgb(hex).map((v) => v + (to - v) * t) as Rgb);
}

/** `#rrggbb` for a colour in a theme. Alpha is not part of it: see `alphaOf`. */
export function resolveColor(color: Color, theme: ThemeJSON): string {
  if (typeof color === 'string') return color;
  return withLum(theme.colors[color.theme], color.lum ?? 0);
}

export const alphaOf = (color: Color): number => (typeof color === 'string' ? 1 : (color.alpha ?? 1));

/** `fg` at `alpha` over `bg`, as the pixel a viewer sees. */
export function blend(fg: string, alpha: number, bg: string): string {
  const [f, b] = [toRgb(fg), toRgb(bg)];
  return toHex(f.map((v, i) => v * alpha + b[i]! * (1 - alpha)) as Rgb);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const THEME_SLOTS: readonly ThemeSlot[] = [
  'dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink'
];
