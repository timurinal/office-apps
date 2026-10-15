/**
 * The status line's sum, count and average of a selection.
 *
 * It reads the grid the way the canvas does, so it adds up what the person sees: the numbers
 * the model marks `kind: 'number'`, by `value` where the model gives it and by reading
 * `text` (`£48,000`, `(12)`, `15%`) where it does not. A selection of a hundred thousand
 * rows is two and a half million cells; `selectionStatsAsync` reads it in slices and gives
 * the main thread back between them, and a new selection abandons the old one.
 */

import type { GridCell, GridData, Rect } from './types';

export interface SelectionStats {
  /** Cells with something in them. */
  count: number;
  /** Cells that are numbers. */
  numbers: number;
  sum: number;
  min: number;
  max: number;
  /** The number format of the first number found, for writing the sum the way the cells are written. */
  numFmt?: string;
}

export const average = (s: SelectionStats): number => (s.numbers > 0 ? s.sum / s.numbers : 0);

const empty = (): SelectionStats => ({ count: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity });

/** A displayed number as a number: `£1,234.50`, `(12)`, `-3`, `15%`. NaN when it is not one. */
export function parseDisplayed(text: string): number {
  let t = text.trim();
  if (t === '') return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  const percent = /%\s*$/.test(t);
  // Currency signs, spaces and the percent sign may surround a number; nothing else may.
  t = t.replace(/[£$€¥%\s]/g, '');
  if (!/^[+-]?[\d.,]*\d[\d.,]*(?:[eE][+-]?\d+)?$/.test(t)) return NaN;
  // Whichever of `,` and `.` comes last is the decimal point; a lone comma before three digits is a thousands separator.
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastComma > lastDot) {
    const commas = (t.match(/,/g) ?? []).length;
    const decimals = t.length - lastComma - 1;
    t = commas === 1 && decimals !== 3 ? t.replace('.', '').replace(',', '.') : t.replace(/,/g, '');
  } else {
    t = t.replace(/,/g, '');
  }
  let n = Number(t);
  if (!Number.isFinite(n)) return NaN;
  if (percent) n /= 100;
  return negative ? -n : n;
}

function add(s: SelectionStats, c: GridCell): void {
  if (c.kind === 'empty' || (c.kind === 'text' && c.text === '')) return;
  s.count++;
  if (c.kind !== 'number') return;
  const n = c.value ?? parseDisplayed(c.text);
  if (Number.isNaN(n)) return;
  if (s.numbers === 0 && c.style.numFmt) s.numFmt = c.style.numFmt;
  s.numbers++;
  s.sum += n;
  if (n < s.min) s.min = n;
  if (n > s.max) s.max = n;
}

function clip(data: GridData, rect: Rect): Rect | null {
  const used = data.usedRange?.();
  if (used === undefined) return rect;
  if (used === null) return null;
  const r = { r1: Math.max(rect.r1, used.r1), r2: Math.min(rect.r2, used.r2), c1: Math.max(rect.c1, used.c1), c2: Math.min(rect.c2, used.c2) };
  return r.r1 > r.r2 || r.c1 > r.c2 ? null : r;
}

function scanRows(s: SelectionStats, data: GridData, r: Rect, from: number, to: number): void {
  for (let row = from; row <= to; row++) {
    for (let col = r.c1; col <= r.c2; col++) {
      const c = data.cell(row, col);
      if (c) add(s, c);
    }
  }
}

/** Everything in a rectangle, now. For a small selection. */
export function selectionStats(data: GridData, rect: Rect): SelectionStats {
  const s = empty();
  const r = clip(data, rect);
  if (r) scanRows(s, data, r, r.r1, r.r2);
  return s;
}

/**
 * The same, in slices of about `slice` cells with a turn of the event loop between, which
 * resolves null if `signal` aborts first.
 */
export async function selectionStatsAsync(
  data: GridData,
  rect: Rect,
  signal: AbortSignal,
  slice = 40_000
): Promise<SelectionStats | null> {
  const s = empty();
  const r = clip(data, rect);
  if (!r) return s;
  const perSlice = Math.max(1, Math.floor(slice / (r.c2 - r.c1 + 1)));
  for (let row = r.r1; row <= r.r2; row += perSlice) {
    if (signal.aborted) return null;
    scanRows(s, data, r, row, Math.min(r.r2, row + perSlice - 1));
    if (row + perSlice <= r.r2) await new Promise<void>((done) => setTimeout(done, 0));
  }
  return signal.aborted ? null : s;
}

export type StatKind = 'sum' | 'average' | 'count' | 'min' | 'max';
export const STAT_KINDS: readonly StatKind[] = ['sum', 'average', 'count', 'min', 'max'];

const LABEL: Record<StatKind, string> = { sum: 'Sum', average: 'Average', count: 'Count', min: 'Min', max: 'Max' };

/** `Sum: £273,000`, or null where there is nothing to say (no numbers; a count of one cell). */
export function statusText(
  s: SelectionStats,
  kind: StatKind,
  format: (n: number, numFmt?: string) => string = plainFormat
): string | null {
  if (kind === 'count') return s.count > 1 ? `Count: ${s.count}` : null;
  if (s.numbers === 0) return null;
  const n = kind === 'sum' ? s.sum : kind === 'average' ? average(s) : kind === 'min' ? s.min : s.max;
  return `${LABEL[kind]}: ${format(n, s.numFmt)}`;
}

const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 });

/** Digits grouped, with no number format: what the status line shows when the host gives none. */
export function plainFormat(n: number): string {
  return NUMBER.format(n);
}
