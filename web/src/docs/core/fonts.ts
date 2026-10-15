/**
 * The fonts and sizes a document can use.
 *
 * The page's policy is `font-src 'self'`, so the only web fonts are the ones the app
 * hosts itself: Inter and JetBrains Mono. Every other family here is a font the reader's
 * machine already has, and each carries the metric-compatible stand-ins Linux and
 * Android ship (Carlito for Calibri, Liberation for Arial, Times New Roman and Courier
 * New), so a document laid out in Word keeps its line breaks on a machine without Word's
 * fonts.
 *
 * A mark stores the family's *name* (`Georgia`), never the stack, so a converter has
 * a name to put in a docx and the stack can improve without touching any document. The
 * stack is added when it is drawn.
 */

import type { Choice } from '../../core/shell/types';
import { safeFamilyName } from './sanitize';

export interface FontFamily {
  /** What the mark stores, and the label. */
  name: string;
  /** What is written into `font-family`. */
  stack: string;
}

/** The document's own font: the one text has before anyone chooses. */
export const DEFAULT_FONT = 'Inter';

export const FONTS: readonly FontFamily[] = [
  { name: 'Inter', stack: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' },
  { name: 'Arial', stack: 'Arial, "Liberation Sans", Arimo, Helvetica, sans-serif' },
  { name: 'Calibri', stack: 'Calibri, Carlito, "Segoe UI", Candara, sans-serif' },
  { name: 'Cambria', stack: 'Cambria, Caladea, "Palatino Linotype", Georgia, serif' },
  { name: 'Garamond', stack: 'Garamond, "EB Garamond", "Palatino Linotype", Georgia, serif' },
  { name: 'Georgia', stack: 'Georgia, "DejaVu Serif", Gelasio, "Times New Roman", serif' },
  { name: 'Times New Roman', stack: '"Times New Roman", "Liberation Serif", Tinos, Times, serif' },
  { name: 'Trebuchet MS', stack: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", sans-serif' },
  { name: 'Verdana', stack: 'Verdana, "DejaVu Sans", Geneva, sans-serif' },
  { name: 'Courier New', stack: '"Courier New", "Liberation Mono", Cousine, Courier, monospace' },
  { name: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' }
];

const BY_NAME = new Map(FONTS.map((f) => [f.name.toLowerCase(), f]));

/** The `font-family` value for a stored name. A name we do not list (a docx's Cambria
 *  Math, a pasted Segoe UI) is tried first and falls back to the page's own font. */
export function stackFor(name: string): string | null {
  const known = BY_NAME.get(name.toLowerCase());
  if (known) return known.stack;
  const safe = safeFamilyName(name);
  return safe ? `"${safe}", ${FONTS[0]!.stack}` : null;
}

/** The name to store for a family a paste or an import brought: the listed spelling when
 *  there is one, so `arial` and `Arial` are one font. */
export function canonicalFamily(name: string | null): string | null {
  if (!name) return null;
  return BY_NAME.get(name.toLowerCase())?.name ?? safeFamilyName(name);
}

/** The ribbon's font list, each name drawn in its own font. */
export const FONT_CHOICES: Choice[] = FONTS.map((f) => ({ value: f.name, label: f.name, style: { fontFamily: f.stack } }));

// ── sizes ───────────────────────────────────────────────────────────────────

/** Word's size list. */
export const SIZES: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/** What text is before anyone chooses: the page's 14.5px is 11pt to the half point. */
export const DEFAULT_SIZE = 11;
export const SIZE_MIN = 1;
export const SIZE_MAX = 400;

/** `12pt` as `12`, and what the size box shows. */
export const sizeNumber = (stored: string | null | undefined): number => {
  const n = stored ? Number.parseFloat(stored) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_SIZE;
};

/** What a typed size means, or null when it is not one: `12`, `10.5`, `12pt`. */
export function parseSize(text: string): number | null {
  const m = /^\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:pt)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return n >= SIZE_MIN && n <= SIZE_MAX ? Math.round(n * 2) / 2 : null;
}

/** The next size up or down the list from `from`, the way the grow and shrink buttons walk it. */
export function stepSize(from: number, direction: 1 | -1): number {
  if (direction === 1) return SIZES.find((s) => s > from) ?? Math.min(SIZE_MAX, Math.floor(from / 10) * 10 + 10);
  const smaller = [...SIZES].reverse().find((s) => s < from);
  return smaller ?? Math.max(SIZE_MIN, from - 1);
}
