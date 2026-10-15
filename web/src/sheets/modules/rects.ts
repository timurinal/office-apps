/** Small arithmetic on blocks of cells (`Rect`, inclusive indexes), for rules that cover a selection. */

import type { Rect } from '../grid/types';

export const overlaps = (a: Rect, b: Rect): boolean => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;

/** Whether `inner` lies wholly inside `outer`. */
export const within = (inner: Rect, outer: Rect): boolean =>
  inner.r1 >= outer.r1 && inner.r2 <= outer.r2 && inner.c1 >= outer.c1 && inner.c2 <= outer.c2;

export const hasCell = (r: Rect, row: number, col: number): boolean => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;

/** What is left of `a` when `b` is taken out: up to four blocks, none of them overlapping, and none empty. */
export function subtract(a: Rect, b: Rect): Rect[] {
  if (!overlaps(a, b)) return [a];
  const out: Rect[] = [];
  if (b.r1 > a.r1) out.push({ r1: a.r1, r2: b.r1 - 1, c1: a.c1, c2: a.c2 });
  if (b.r2 < a.r2) out.push({ r1: b.r2 + 1, r2: a.r2, c1: a.c1, c2: a.c2 });
  const r1 = Math.max(a.r1, b.r1);
  const r2 = Math.min(a.r2, b.r2);
  if (b.c1 > a.c1) out.push({ r1, r2, c1: a.c1, c2: b.c1 - 1 });
  if (b.c2 < a.c2) out.push({ r1, r2, c1: b.c2 + 1, c2: a.c2 });
  return out;
}

/** Every block in `rects` with `cut` taken out of each. */
export const subtractAll = (rects: readonly Rect[], cut: Rect): Rect[] => rects.flatMap((r) => subtract(r, cut));

export const cellCount = (r: Rect): number => (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);

/**
 * The block of data around a cell: the nearest empty row and column on every side. Excel's Ctrl+A on
 * a cell, and where a sort or a filter starts when one cell is selected. `filled(row, col)` says
 * whether a cell holds anything; `rows` and `cols` are the grid's sizes.
 */
export function currentRegion(from: { row: number; col: number }, rows: number, cols: number, filled: (row: number, col: number) => boolean): Rect {
  const r: Rect = { r1: from.row, r2: from.row, c1: from.col, c2: from.col };
  const rowHas = (row: number, c1: number, c2: number) => {
    for (let c = Math.max(0, c1); c <= Math.min(cols - 1, c2); c++) if (filled(row, c)) return true;
    return false;
  };
  const colHas = (col: number, r1: number, r2: number) => {
    for (let row = Math.max(0, r1); row <= Math.min(rows - 1, r2); row++) if (filled(row, col)) return true;
    return false;
  };
  // A side at a time to a fixed point, then the next: stepping all four together would rescan the
  // whole height for each row gained, which is quadratic down a long column.
  let grew = true;
  while (grew) {
    grew = false;
    while (r.r1 > 0 && rowHas(r.r1 - 1, r.c1 - 1, r.c2 + 1)) (r.r1--, (grew = true));
    while (r.r2 < rows - 1 && rowHas(r.r2 + 1, r.c1 - 1, r.c2 + 1)) (r.r2++, (grew = true));
    while (r.c1 > 0 && colHas(r.c1 - 1, r.r1 - 1, r.r2 + 1)) (r.c1--, (grew = true));
    while (r.c2 < cols - 1 && colHas(r.c2 + 1, r.r1 - 1, r.r2 + 1)) (r.c2++, (grew = true));
  }
  return r;
}
