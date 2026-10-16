/**
 * Where a table's cells are on the slide, in slide px.
 *
 * The renderer lays a table out with CSS grid and lets a row grow past its stored height to hold its
 * text, so the true box of a cell is known only to the browser. `measureCells` asks it; `modelCell`
 * is what the stored columns and rows say, which is the answer when the page has not been laid out
 * (a test, a first frame) and a good one when no row has grown.
 *
 * A cell is found in the DOM by the grid position the renderer gives it (`grid-row: 2 / span 1`), not
 * by its place among its siblings, because a covered cell is not drawn.
 */

import type { TableElement } from '../../model/deck';
import type { Box } from '../../model/model';
import { ownerPos, type CellPos } from './tableOps';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const span = (n: number | undefined): number => Math.max(1, Math.round(n ?? 1));

/** The box a cell's owner covers, by the stored columns and rows. */
export function modelCell(t: TableElement, p: CellPos): Box {
  const o = ownerPos(t, p) ?? p;
  const cell = t.rows[o.r]?.cells[o.c];
  const cs = span(cell?.colSpan);
  const rs = span(cell?.rowSpan);
  return {
    x: t.x + sum(t.cols.slice(0, o.c)),
    y: t.y + sum(t.rows.slice(0, o.r).map((r) => r.h)),
    w: sum(t.cols.slice(o.c, o.c + cs)),
    h: sum(t.rows.slice(o.r, o.r + rs).map((r) => r.h))
  };
}

/** The drawn element with this id, in the slide's canvas element. */
function hostOf(canvas: Element, elId: string): Element | null {
  for (const n of canvas.querySelectorAll('[data-el]')) if (n.getAttribute('data-el') === elId) return n;
  return null;
}

/** The first number of a `grid-row` or `grid-column` value: `2 / span 1` is 2. */
const lineOf = (v: string): number => Number.parseInt(v, 10);

export interface MeasuredCell extends CellPos {
  box: Box;
}

/** Every drawn cell of a table, with its box in slide px, or null when the page has not been laid out. */
export function measureCells(canvas: Element, elId: string, scale: number): MeasuredCell[] | null {
  const host = hostOf(canvas, elId);
  if (!host) return null;
  const base = canvas.getBoundingClientRect();
  const out: MeasuredCell[] = [];
  for (const n of host.querySelectorAll<HTMLElement>('.sl-cell')) {
    const r = lineOf(n.style.gridRow) - 1;
    const c = lineOf(n.style.gridColumn) - 1;
    if (!(r >= 0) || !(c >= 0)) continue;
    const rect = n.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    out.push({ r, c, box: { x: (rect.left - base.left) / scale, y: (rect.top - base.top) / scale, w: rect.width / scale, h: rect.height / scale } });
  }
  return out.length ? out : null;
}

/** The drawn cell at a grid position, for marking it while it is typed in. */
export function cellElement(canvas: Element, elId: string, r: number, c: number): HTMLElement | null {
  const host = hostOf(canvas, elId);
  if (!host) return null;
  for (const n of host.querySelectorAll<HTMLElement>('.sl-cell')) if (lineOf(n.style.gridRow) === r + 1 && lineOf(n.style.gridColumn) === c + 1) return n;
  return null;
}

/** Whether two measurements agree to a tenth of a px: a render that changed nothing changes nothing. */
export function sameMeasure(a: readonly MeasuredCell[] | null, b: readonly MeasuredCell[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.1;
  return a.every((m, i) => {
    const n = b[i]!;
    return m.r === n.r && m.c === n.c && near(m.box.x, n.box.x) && near(m.box.y, n.box.y) && near(m.box.w, n.box.w) && near(m.box.h, n.box.h);
  });
}

/** The box of one cell: as drawn when it can be measured, else as stored. */
export function cellBox(t: TableElement, p: CellPos, measured: readonly MeasuredCell[] | null): Box {
  const o = ownerPos(t, p) ?? p;
  return measured?.find((m) => m.r === o.r && m.c === o.c)?.box ?? modelCell(t, o);
}

/** The cell under a point (slide px), or null outside every cell. */
export function cellAtPoint(t: TableElement, at: { x: number; y: number }, measured: readonly MeasuredCell[] | null): CellPos | null {
  for (let r = 0; r < t.rows.length; r++) {
    for (let c = 0; c < t.cols.length; c++) {
      if (t.rows[r]!.cells[c]?.merged) continue;
      const b = cellBox(t, { r, c }, measured);
      if (at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h) return { r, c };
    }
  }
  return null;
}

/** The box a range of cells covers: from its first cell's corner to its last cell's. */
export function rangeBox(t: TableElement, from: CellPos, to: CellPos, measured: readonly MeasuredCell[] | null): Box {
  const a = cellBox(t, from, measured);
  const b = cellBox(t, to, measured);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
