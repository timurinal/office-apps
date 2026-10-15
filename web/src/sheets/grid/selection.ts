/**
 * The selection and the keyboard that moves it, as pure functions over a small context.
 *
 * A selection is an anchor (where it began), a head (the end that Shift and a drag move) and
 * an active cell (where typing goes; Tab and Enter move it inside the rectangle without
 * changing the rectangle). The rectangle is never stored: it is the anchor and head, widened
 * until no merged area is cut by its edge, as Excel does.
 *
 * Nothing here knows the DOM or the canvas, so every key has a test.
 */

import type { Cellpos, Rect } from './types';

export interface SelState {
  anchor: Cellpos;
  head: Cellpos;
  active: Cellpos;
}

/** What navigation needs to know about the sheet, answered lazily. */
export interface NavCtx {
  rows: number;
  cols: number;
  /** Rows and columns frozen at the top and left. */
  frozen: { rows: number; cols: number };
  hidden(axis: 'row' | 'col', i: number): boolean;
  /** The merged area containing a cell, if any. */
  mergeAt(row: number, col: number): Rect | null;
  /** No content to show (a cell with only a style is empty). */
  isEmpty(row: number, col: number): boolean;
  /** How many rows (or columns) a screen holds from a line, in a direction. */
  pageSize(axis: 'row' | 'col', from: number, dir: 1 | -1): number;
  /** The last row and column with content. */
  usedEnd(): Cellpos | null;
}

export interface Mods {
  shift: boolean;
  /** Ctrl, or Cmd on a Mac. */
  ctrl: boolean;
  alt: boolean;
}

export const cell = (row: number, col: number): Cellpos => ({ row, col });

export const single = (c: Cellpos): SelState => ({ anchor: c, head: c, active: c });

export const sameCell = (a: Cellpos, b: Cellpos): boolean => a.row === b.row && a.col === b.col;

export const sameRect = (a: Rect, b: Rect): boolean => a.r1 === b.r1 && a.r2 === b.r2 && a.c1 === b.c1 && a.c2 === b.c2;

export const rectOfCells = (a: Cellpos, b: Cellpos): Rect => ({
  r1: Math.min(a.row, b.row),
  r2: Math.max(a.row, b.row),
  c1: Math.min(a.col, b.col),
  c2: Math.max(a.col, b.col)
});

export const rectContains = (r: Rect, c: Cellpos): boolean => c.row >= r.r1 && c.row <= r.r2 && c.col >= r.c1 && c.col <= r.c2;

export const rectsOverlap = (a: Rect, b: Rect): boolean => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

export const cellsIn = (r: Rect): number => (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);

/** Widen a rectangle until it cuts no merged area. */
export function expandForMerges(r: Rect, merges: readonly Rect[]): Rect {
  if (merges.length === 0) return r;
  let out = r;
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of merges) {
      if (!rectsOverlap(out, m)) continue;
      if (m.r1 < out.r1 || m.r2 > out.r2 || m.c1 < out.c1 || m.c2 > out.c2) {
        out = { r1: Math.min(out.r1, m.r1), r2: Math.max(out.r2, m.r2), c1: Math.min(out.c1, m.c1), c2: Math.max(out.c2, m.c2) };
        changed = true;
      }
    }
  }
  return out;
}

/** The rectangle a selection covers, merged areas included. */
export function selRect(s: SelState, merges: readonly Rect[]): Rect {
  return expandForMerges(rectOfCells(s.anchor, s.head), merges);
}

export const isWholeRows = (r: Rect, cols: number): boolean => r.c1 === 0 && r.c2 === cols - 1;
export const isWholeCols = (r: Rect, rows: number): boolean => r.r1 === 0 && r.r2 === rows - 1;

/** The top-left of a merged area, or the cell itself. */
function anchorOf(c: Cellpos, ctx: NavCtx): Cellpos {
  const m = ctx.mergeAt(c.row, c.col);
  return m ? cell(m.r1, m.c1) : c;
}

/** One step along an axis, over hidden lines. Stays where it is at the edge. */
function stepLine(axis: 'row' | 'col', from: number, dir: 1 | -1, ctx: NavCtx): number {
  const n = axis === 'row' ? ctx.rows : ctx.cols;
  let i = from + dir;
  while (i >= 0 && i < n && ctx.hidden(axis, i)) i += dir;
  return i < 0 || i >= n ? from : i;
}

const lineOf = (c: Cellpos, axis: 'row' | 'col'): number => (axis === 'row' ? c.row : c.col);
const withLine = (c: Cellpos, axis: 'row' | 'col', i: number): Cellpos => (axis === 'row' ? cell(i, c.col) : cell(c.row, i));

/**
 * Ctrl+Arrow: along a run of cells with content, to its end; from the end of a run or from
 * an empty cell, to the next cell with content; with none, to the edge of the sheet.
 */
export function jumpEdge(from: Cellpos, axis: 'row' | 'col', dir: 1 | -1, ctx: NavCtx): Cellpos {
  const n = axis === 'row' ? ctx.rows : ctx.cols;
  const empty = (i: number) => {
    const c = withLine(from, axis, i);
    return ctx.isEmpty(c.row, c.col);
  };
  let i = lineOf(from, axis);
  const next = i + dir;
  if (next < 0 || next >= n) return from;
  if (!empty(i) && !empty(next)) {
    while (i + dir >= 0 && i + dir < n && !empty(i + dir)) i += dir;
    return withLine(from, axis, i);
  }
  i = next;
  while (i >= 0 && i < n && empty(i)) i += dir;
  return withLine(from, axis, i < 0 ? 0 : i >= n ? n - 1 : i);
}

/** Where Ctrl+End goes: the last row and the last column that have content. */
export function usedCorner(ctx: NavCtx): Cellpos {
  const used = ctx.usedEnd();
  if (used) return used;
  let lastRow = -1;
  for (let r = ctx.rows - 1; r >= 0 && lastRow < 0; r--) {
    for (let c = 0; c < ctx.cols; c++) {
      if (!ctx.isEmpty(r, c)) {
        lastRow = r;
        break;
      }
    }
  }
  if (lastRow < 0) return cell(0, 0);
  let lastCol = 0;
  for (let r = 0; r <= lastRow; r++) {
    for (let c = ctx.cols - 1; c > lastCol; c--) {
      if (!ctx.isEmpty(r, c)) {
        lastCol = c;
        break;
      }
    }
  }
  return cell(lastRow, lastCol);
}

export interface NavResult {
  sel: SelState;
  /** A page key: the pane scrolls a screen the same way, so the cell keeps its place in it. */
  page?: { axis: 'row' | 'col'; dir: 1 | -1 };
}

const ARROWS: Record<string, { axis: 'row' | 'col'; dir: 1 | -1 }> = {
  ArrowUp: { axis: 'row', dir: -1 },
  ArrowDown: { axis: 'row', dir: 1 },
  ArrowLeft: { axis: 'col', dir: -1 },
  ArrowRight: { axis: 'col', dir: 1 }
};

/**
 * Moves the selection for a navigation key; null for a key that is not one. Shift moves the
 * head and keeps the anchor; otherwise everything collapses to the new cell. Ctrl jumps to
 * the edge of the data.
 */
export function navigate(s: SelState, key: string, mods: Mods, ctx: NavCtx, merges: readonly Rect[]): NavResult | null {
  const arrow = ARROWS[key];
  const rect = selRect(s, merges);

  // Where a Shift move starts from: the head's corner of the widened rectangle, so a merge
  // is crossed in one press rather than stepped through.
  const headCorner = (): Cellpos => cell(s.head.row >= s.anchor.row ? rect.r2 : rect.r1, s.head.col >= s.anchor.col ? rect.c2 : rect.c1);

  const moveTo = (target: Cellpos): NavResult => {
    if (mods.shift) return { sel: { ...s, head: target } };
    const a = anchorOf(target, ctx);
    return { sel: single(a) };
  };

  if (arrow) {
    const from = mods.shift ? headCorner() : anchorOf(s.active, ctx);
    const m = mods.shift ? null : ctx.mergeAt(s.active.row, s.active.col);
    let target: Cellpos;
    if (mods.ctrl) {
      target = jumpEdge(from, arrow.axis, arrow.dir, ctx);
    } else {
      // From a merged area, leave by its far edge.
      const base = m ? withLine(from, arrow.axis, arrow.dir === 1 ? (arrow.axis === 'row' ? m.r2 : m.c2) : lineOf(from, arrow.axis)) : from;
      target = withLine(base, arrow.axis, stepLine(arrow.axis, lineOf(base, arrow.axis), arrow.dir, ctx));
    }
    return moveTo(target);
  }

  switch (key) {
    case 'Home': {
      const from = mods.shift ? headCorner() : s.active;
      return moveTo(mods.ctrl ? cell(0, 0) : cell(from.row, 0));
    }
    case 'End': {
      const from = mods.shift ? headCorner() : s.active;
      if (mods.ctrl) return moveTo(usedCorner(ctx));
      let last = ctx.cols - 1;
      const used = ctx.usedEnd();
      if (used) last = Math.min(last, used.col);
      while (last > 0 && ctx.isEmpty(from.row, last)) last--;
      return moveTo(cell(from.row, last));
    }
    case 'PageDown':
    case 'PageUp': {
      const dir: 1 | -1 = key === 'PageDown' ? 1 : -1;
      const axis = mods.alt ? 'col' : 'row';
      const from = mods.shift ? headCorner() : s.active;
      const n = axis === 'row' ? ctx.rows : ctx.cols;
      const moved = Math.max(1, ctx.pageSize(axis, lineOf(from, axis), dir));
      const to = Math.max(0, Math.min(n - 1, lineOf(from, axis) + dir * moved));
      const result = moveTo(withLine(from, axis, to));
      return { ...result, page: { axis, dir } };
    }
    default:
      return null;
  }
}

/**
 * Tab and Enter: the next cell along `dir`. With more than one cell selected the active cell
 * walks the rectangle (a row at a time for Tab, a column at a time for Enter) and wraps; with
 * one it is an ordinary move.
 */
export function advance(s: SelState, dir: 'down' | 'up' | 'right' | 'left', ctx: NavCtx, merges: readonly Rect[]): SelState {
  const rect = selRect(s, merges);
  const area = cellsIn(rect);
  const inside = area > 1 && !(ctx.mergeAt(rect.r1, rect.c1) && sameRect(ctx.mergeAt(rect.r1, rect.c1)!, rect));
  const vertical = dir === 'down' || dir === 'up';
  const forward = dir === 'down' || dir === 'right';

  if (!inside) {
    const axis = vertical ? 'row' : 'col';
    const from = anchorOf(s.active, ctx);
    const m = ctx.mergeAt(s.active.row, s.active.col);
    const base = m && forward ? withLine(from, axis, axis === 'row' ? m.r2 : m.c2) : from;
    const next = withLine(base, axis, stepLine(axis, lineOf(base, axis), forward ? 1 : -1, ctx));
    return single(anchorOf(next, ctx));
  }

  // Walk the rectangle, skipping hidden lines and the inside of merged areas.
  const major: 'row' | 'col' = vertical ? 'row' : 'col';
  const minor: 'row' | 'col' = vertical ? 'col' : 'row';
  const lo = (a: 'row' | 'col') => (a === 'row' ? rect.r1 : rect.c1);
  const hi = (a: 'row' | 'col') => (a === 'row' ? rect.r2 : rect.c2);
  const step = forward ? 1 : -1;
  let c = s.active;
  const limit = area + 1;
  for (let n = 0; n < limit; n++) {
    let mj = lineOf(c, major) + step;
    let mn = lineOf(c, minor);
    if (mj > hi(major) || mj < lo(major)) {
      mj = forward ? lo(major) : hi(major);
      mn += step;
      if (mn > hi(minor) || mn < lo(minor)) mn = forward ? lo(minor) : hi(minor);
    }
    c = withLine(withLine(c, major, mj), minor, mn);
    if (ctx.hidden('row', c.row) || ctx.hidden('col', c.col)) continue;
    const m = ctx.mergeAt(c.row, c.col);
    if (m && !(m.r1 === c.row && m.c1 === c.col)) continue;
    return { ...s, active: c };
  }
  return s;
}

/** Select a whole row, column or the whole sheet. */
export function wholeRows(from: number, to: number, ctx: NavCtx): SelState {
  return { anchor: cell(from, 0), head: cell(to, ctx.cols - 1), active: cell(from, 0) };
}

export function wholeCols(from: number, to: number, ctx: NavCtx): SelState {
  return { anchor: cell(0, from), head: cell(ctx.rows - 1, to), active: cell(0, from) };
}

export function selectAll(ctx: NavCtx): SelState {
  return { anchor: cell(0, 0), head: cell(ctx.rows - 1, ctx.cols - 1), active: cell(0, 0) };
}

/** Keep a selection inside a grid that has shrunk. */
export function clampSel(s: SelState, rows: number, cols: number): SelState {
  const c = (p: Cellpos) => cell(Math.max(0, Math.min(rows - 1, p.row)), Math.max(0, Math.min(cols - 1, p.col)));
  return { anchor: c(s.anchor), head: c(s.head), active: c(s.active) };
}
