/**
 * A1 addresses for the grid: the name box, the formula bar's reference colouring and the
 * status of a selection. The grid draws what a person reads, so it knows `B3` and never an
 * id; this is the small part of the engine's parser that a view needs, written again here
 * so the grid imports nothing from the engine.
 */

import type { Cellpos, Rect } from './types';

/** Excel's own limits, which the name box and typed references are held to. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export function colToLetters(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function lettersToCol(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const cellAddress = (row: number, col: number): string => `${colToLetters(col)}${row + 1}`;

/** `B3`, or `B3:D5` for more than one cell. */
export function rectAddress(r: Rect): string {
  const a = cellAddress(r.r1, r.c1);
  return r.r1 === r.r2 && r.c1 === r.c2 ? a : `${a}:${cellAddress(r.r2, r.c2)}`;
}

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;
const COLUMN = /^\$?([A-Za-z]{1,3})$/;
const ROW = /^\$?(\d{1,7})$/;

function cellOf(s: string): Cellpos | null {
  const m = CELL.exec(s);
  if (!m) return null;
  const col = lettersToCol(m[1]!);
  const row = Number(m[2]) - 1;
  return col < MAX_COLS && row >= 0 && row < MAX_ROWS ? { row, col } : null;
}

/**
 * What the name box accepts: `B3`, `B3:D9`, `$B$3`, a column `A:C` or a row `2:4`, in either
 * case. A column or row spans the grid it is typed into. null for anything else, and for an
 * address outside `rows` by `cols`.
 */
export function parseAddress(text: string, rows: number, cols: number): Rect | null {
  const t = text.trim();
  if (t === '') return null;
  const [a = '', b, ...rest] = t.split(':');
  if (rest.length > 0) return null;

  const first = cellOf(a);
  if (first) {
    const second = b === undefined ? first : cellOf(b);
    if (!second) return null;
    const rect = {
      r1: Math.min(first.row, second.row),
      r2: Math.max(first.row, second.row),
      c1: Math.min(first.col, second.col),
      c2: Math.max(first.col, second.col)
    };
    return rect.r2 < rows && rect.c2 < cols ? rect : null;
  }
  if (b === undefined) return null;

  const ca = COLUMN.exec(a);
  const cb = COLUMN.exec(b);
  if (ca && cb) {
    const x = lettersToCol(ca[1]!);
    const y = lettersToCol(cb[1]!);
    const c1 = Math.min(x, y);
    const c2 = Math.max(x, y);
    return c2 < cols ? { r1: 0, r2: rows - 1, c1, c2 } : null;
  }
  const ra = ROW.exec(a);
  const rb = ROW.exec(b);
  if (ra && rb) {
    const x = Number(ra[1]) - 1;
    const y = Number(rb[1]) - 1;
    const r1 = Math.min(x, y);
    const r2 = Math.max(x, y);
    return r1 >= 0 && r2 < rows ? { r1, r2, c1: 0, c2: cols - 1 } : null;
  }
  return null;
}
