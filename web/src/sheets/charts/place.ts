/**
 * Where a chart is: from its anchor to a box on screen, and back.
 *
 * A chart is stored against the cell its top-left corner sits in (row id, column id) and how far
 * into it (`dx`, `dy`, CSS px at 100%), so inserting rows above it moves it and the zoom scales it.
 * Positions on screen are the grid's own: the viewport's coordinates, headers included, which the
 * grid's `follow` turns into a transform on every frame.
 */

import type { GridLayout } from '../grid/geometry';
import type { Box } from '../grid/geometry';
import type { Rect } from '../grid/types';
import type { SheetModel } from '../model';
import { resolveRect } from '../model/structure';
import { MIN_H, MIN_W } from './layout';
import type { ChartSpec } from './types';

/** A chart is never made bigger than this: a card the size of a sheet is a mistake, not a chart. */
export const MAX_W = 2400;
export const MAX_H = 1800;

export const clampSize = (w: number, h: number): { w: number; h: number } => ({
  w: Math.round(Math.min(MAX_W, Math.max(MIN_W, w))),
  h: Math.round(Math.min(MAX_H, Math.max(MIN_H, h)))
});

/**
 * The cell a chart's corner is in today. A chart whose anchor line is gone (the delete reached the
 * end of the sheet, or two people deleted and moved at once) is drawn at its data instead, and one
 * with neither is not drawn.
 */
export function anchorCell(model: SheetModel, host: string, spec: ChartSpec): { row: number; col: number; dx: number; dy: number } | null {
  const sh = model.engine.sheet(host);
  if (!sh) return null;
  const row = sh.rowIndex().get(spec.anchor.row);
  const col = sh.colIndex().get(spec.anchor.col);
  if (row !== undefined && col !== undefined) return { row, col, dx: spec.anchor.dx, dy: spec.anchor.dy };
  if (spec.sheet !== host) return null;
  const rect = resolveRect(sh, spec.data);
  return rect ? { row: rect.r1, col: rect.c1, dx: 0, dy: 0 } : null;
}

/** The chart's box in the viewport's coordinates, or null when it has no cell to sit in. */
export function boxOf(model: SheetModel, host: string, spec: ChartSpec, L: GridLayout): Box | null {
  const a = anchorCell(model, host, spec);
  if (!a) return null;
  return { x: L.colX(a.col) + a.dx * L.zoom, y: L.rowY(a.row) + a.dy * L.zoom, w: spec.w * L.zoom, h: spec.h * L.zoom };
}

/**
 * The anchor for a card whose top-left corner is at (x, y) in the viewport: the cell under it, and
 * the offset into that cell. A corner above or left of the cells is put on the first one, and a
 * corner past the last row or column on the last, with the offset that reaches it.
 */
export function anchorFor(model: SheetModel, host: string, L: GridLayout, x: number, y: number): ChartSpec['anchor'] | null {
  const sh = model.engine.sheet(host);
  if (!sh) return null;
  const px = Math.max(x, L.headerW);
  const py = Math.max(y, L.headerH);
  const at = L.nearest(px, py);
  const rowId = sh.rowOrder[at.row];
  const colId = sh.colOrder[at.col];
  if (rowId === undefined || colId === undefined) return null;
  return {
    row: rowId,
    col: colId,
    dx: Math.max(0, Math.round((px - L.colX(at.col)) / L.zoom)),
    dy: Math.max(0, Math.round((py - L.rowY(at.row)) / L.zoom))
  };
}

/**
 * Where a new chart goes: to the right of its data, a column clear of it, if it fits on screen; else
 * below the data; else at the top left of what is on screen. One that would land exactly on another
 * is stepped down and right, as a window is.
 */
export function defaultAnchor(
  model: SheetModel,
  host: string,
  region: Rect,
  size: { w: number; h: number },
  L: GridLayout | null,
  taken: readonly ChartSpec['anchor'][]
): ChartSpec['anchor'] | null {
  const sh = model.engine.sheet(host);
  if (!sh) return null;
  const cols = sh.colOrder.length;
  const rows = sh.rowOrder.length;
  const at = (r: number, c: number) => ({ row: Math.max(0, Math.min(rows - 1, r)), col: Math.max(0, Math.min(cols - 1, c)) });
  let spot = at(region.r1, region.c2 + 2);
  if (L) {
    const fits = (p: { row: number; col: number }): boolean => {
      const x = L.colX(p.col);
      const y = L.rowY(p.row);
      return x >= L.headerW && y >= L.headerH && x + size.w * L.zoom <= L.viewW && y + size.h * L.zoom <= L.viewH;
    };
    if (!fits(spot)) {
      const below = at(region.r2 + 2, region.c1);
      spot = fits(below) ? below : at(L.scrolledRows()?.[0] ?? 0, L.scrolledCols()?.[0] ?? 0);
    }
  }
  const rowId = sh.rowOrder[spot.row];
  const colId = sh.colOrder[spot.col];
  if (rowId === undefined || colId === undefined) return null;
  let step = 0;
  while (taken.some((a) => a.row === rowId && a.col === colId && a.dx === step * 24 && a.dy === step * 24)) step++;
  return { row: rowId, col: colId, dx: step * 24, dy: step * 24 };
}
