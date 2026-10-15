/**
 * The arithmetic of the mouse gestures that change the sheet: dragging the fill handle,
 * resizing a header, moving whole lines. Each is a pure function from where the pointer is to
 * what the gesture would do, so a test can drag without a browser and the component only
 * has to carry the answer to an intent.
 */

import type { Cellpos, Rect } from './types';

// ── the fill handle ─────────────────────────────────────────────────────────

/**
 * The rectangle a fill drag covers. It always contains `source` and grows in one direction:
 * the one the pointer has gone furthest outside it, measured in pixels so that a wide cell
 * does not outweigh a tall one. `out` is how far the pointer is outside the source on each
 * axis (0 inside), and `at` is the cell under it, already clamped to the grid.
 */
export function fillTarget(source: Rect, at: Cellpos, out: { x: number; y: number }): Rect {
  if (out.x === 0 && out.y === 0) return source;
  if (Math.abs(out.y) >= Math.abs(out.x)) {
    return at.row > source.r2 ? { ...source, r2: at.row } : at.row < source.r1 ? { ...source, r1: at.row } : source;
  }
  return at.col > source.c2 ? { ...source, c2: at.col } : at.col < source.c1 ? { ...source, c1: at.col } : source;
}

/** Signed distance outside the interval `[lo, hi]`: negative before it, positive after, 0 within. */
export function outside(pos: number, lo: number, hi: number): number {
  return pos < lo ? pos - lo : pos > hi ? pos - hi : 0;
}

// ── resizing ────────────────────────────────────────────────────────────────

/** The smallest a line is dragged to, in CSS px at 100%. */
export const MIN_LINE = 6;

/** The size a header drag gives, in CSS px at 100%, from the size at the press and the pixels moved. */
export function draggedSize(startZoomed: number, delta: number, zoom: number): number {
  return Math.max(MIN_LINE, Math.round((startZoomed + delta) / zoom));
}

/**
 * The lines a resize or autofit applies to: the whole selected run when the edge belongs to
 * a line inside a selection of whole lines, else that one line.
 */
export function lineRange(axis: 'row' | 'col', line: number, sel: Rect, rows: number, cols: number): { from: number; to: number } {
  const whole = axis === 'row' ? sel.c1 === 0 && sel.c2 === cols - 1 : sel.r1 === 0 && sel.r2 === rows - 1;
  const lo = axis === 'row' ? sel.r1 : sel.c1;
  const hi = axis === 'row' ? sel.r2 : sel.c2;
  return whole && line >= lo && line <= hi && hi > lo ? { from: lo, to: hi } : { from: line, to: line };
}

// ── moving lines ────────────────────────────────────────────────────────────

/**
 * Dropping the lines `[from, from + count)` into the gap before line `gap` (0 is the top, the
 * line count the very end). The intent's `to`, or null when the drop leaves them where they
 * are: onto themselves or beside them.
 */
export function moveTarget(from: number, count: number, gap: number): number | null {
  if (gap >= from && gap <= from + count) return null;
  return gap > from ? gap - count : gap;
}

/** The gap nearest a position inside a line: the near edge in its first half, the far edge in its second. */
export function nearestGap(line: number, within: number, size: number): number {
  return within * 2 < size ? line : line + 1;
}
