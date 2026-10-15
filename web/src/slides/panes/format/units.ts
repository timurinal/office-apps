/**
 * The pane's numbers: what a person types and reads, and what the deck stores.
 *
 * A slide is 1920 logical px across and 33.867 cm (13.333 in), so 1 cm is 1920 / 33.867 px. Lengths
 * are shown in centimetres to two places ("8.76 cm") and accept what a person may type: another unit
 * (`3 in`, `25 mm`, `12 pt`), a comma for a point. Type is in points (1 pt is 2 px), a line's width
 * in points too, rotation in degrees from 0 up to 360, and fractions as per cent.
 *
 * Pure: no DOM.
 */

import { PX_PER_PT, SLIDE_WIDTH } from '../../model/deck';

/** A slide's width in centimetres, as PowerPoint's 16:9 is. */
export const SLIDE_CM = 33.867;
export const PX_PER_CM = SLIDE_WIDTH / SLIDE_CM;

const UNITS = { cm: PX_PER_CM, mm: PX_PER_CM / 10, in: PX_PER_CM * 2.54, pt: PX_PER_PT, px: 1 } as const;
type Unit = keyof typeof UNITS;

export const pxToCm = (px: number): number => px / PX_PER_CM;
export const cmToPx = (cm: number): number => cm * PX_PER_CM;

export const round = (n: number, places = 2): number => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};

/** `8.76 cm`. */
export const formatCm = (px: number): string => `${pxToCm(px).toFixed(2)} cm`;

/** A length as typed, in pixels, or null when it is not one. A bare number is in `unit`. */
export function parseLength(text: string, unit: Unit = 'cm'): number | null {
  const m = /^\s*(-?(?:\d+[.,]?\d*|[.,]\d+))\s*(cm|mm|in|"|pt|px)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const u = (m[2] ?? unit).toLowerCase();
  const k = u === '"' ? UNITS.in : UNITS[u as Unit];
  return Number.isFinite(n) ? n * k : null;
}

/** `45°`, with no trailing zeros. */
export const formatDegrees = (deg: number): string => `${round(deg, 1)}°`;

/** Degrees as typed, turned into 0 up to 360, or null. */
export function parseDegrees(text: string): number | null {
  const m = /^\s*(-?(?:\d+[.,]?\d*|[.,]\d+))\s*(?:°|deg|degrees)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? round((((n % 360) + 360) % 360), 2) : null;
}

/** A line's width: stored in px, shown in points. */
export const formatPt = (px: number): string => `${round(px / PX_PER_PT, 2)} pt`;

/** Points as typed, in px, or null. A bare number is points. */
export function parsePt(text: string): number | null {
  const px = parseLength(text, 'pt');
  return px === null ? null : px;
}

/** A size in points, as the ribbon shows it. */
export const formatPoints = (pt: number): string => `${round(pt, 1)} pt`;

/** A number of points as typed, or null. */
export function parsePoints(text: string): number | null {
  const m = /^\s*(-?(?:\d+[.,]?\d*|[.,]\d+))\s*(?:pt)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** A fraction as a per cent: 0.25 is `25%`. */
export const formatPercent = (fraction: number): string => `${round(fraction * 100, 1)}%`;

/** A per cent as typed, as a fraction, or null. */
export function parsePercent(text: string): number | null {
  const m = /^\s*(-?(?:\d+[.,]?\d*|[.,]\d+))\s*%?\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n / 100 : null;
}

/** A multiple of single spacing: `1.2`. */
export const formatMultiple = (n: number): string => String(round(n, 2));

export function parseMultiple(text: string): number | null {
  const m = /^\s*(\d+[.,]?\d*|[.,]\d+)\s*(?:x|×)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
