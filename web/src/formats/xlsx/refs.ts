/** A1 ranges as a file writes them: `A1`, `$A$1:$B$4`, `C:C`, `3:5`, `Sheet2!A1:A5`, `'My sheet'!A1`. */

import { MAX_COLS, MAX_ROWS, lettersToCol, parseCellAddress } from '../../sheets/engine';
import type { Rect } from '../../sheets/grid/types';

/** `Sheet2!A1:A5` to its sheet and the rest. An unqualified reference has no sheet. */
export function splitSheet(ref: string): { sheet: string | null; range: string } {
  const bang = ref.lastIndexOf('!');
  if (bang < 0) return { sheet: null, range: ref.trim() };
  let sheet = ref.slice(0, bang).trim();
  if (sheet.startsWith("'") && sheet.endsWith("'") && sheet.length >= 2) sheet = sheet.slice(1, -1).replace(/''/g, "'");
  return { sheet, range: ref.slice(bang + 1).trim() };
}

const COL = /^\$?([A-Za-z]{1,3})$/;
const ROW = /^\$?(\d{1,7})$/;

function end(part: string): { row?: number; col?: number } | null {
  const cell = parseCellAddress(part);
  if (cell) return cell;
  const c = COL.exec(part.trim());
  if (c) {
    const col = lettersToCol(c[1]!);
    return col < MAX_COLS ? { col } : null;
  }
  const r = ROW.exec(part.trim());
  if (r) {
    const row = Number(r[1]) - 1;
    return row >= 0 && row < MAX_ROWS ? { row } : null;
  }
  return null;
}

/**
 * One range, as a rectangle of zero-based indexes. A whole column runs the sheet's height and a
 * whole row its width, at the largest the engine allows; `clamp` brings it to the sheet.
 */
export function parseRange(text: string): Rect | null {
  const parts = text.split(':');
  const a = parts[0];
  const b = parts[1] ?? a;
  if (a === undefined || b === undefined) return null;
  const x = end(a);
  const y = end(b);
  if (!x || !y) return null;
  // `C:C` has columns and no rows, so it runs the whole height; `3:5` the whole width.
  const r1 = x.row ?? 0;
  const c1 = x.col ?? 0;
  const r2 = y.row ?? (y.col !== undefined && x.row === undefined ? MAX_ROWS - 1 : r1);
  const c2 = y.col ?? (y.row !== undefined && x.col === undefined ? MAX_COLS - 1 : c1);
  return { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
}

/** The space-separated ranges of a `sqref`, each within the sheet, those wholly outside dropped. */
export function parseSqref(sqref: string, rows: number, cols: number): Rect[] {
  const out: Rect[] = [];
  for (const part of sqref.split(/\s+/)) {
    if (!part) continue;
    const r = parseRange(part);
    const c = r && clamp(r, rows, cols);
    if (c) out.push(c);
  }
  return out;
}

/** `rect` held to a sheet of `rows` by `cols`, or null when none of it is inside. */
export function clamp(rect: Rect, rows: number, cols: number): Rect | null {
  if (rect.r1 >= rows || rect.c1 >= cols) return null;
  return { r1: rect.r1, c1: rect.c1, r2: Math.min(rect.r2, rows - 1), c2: Math.min(rect.c2, cols - 1) };
}
