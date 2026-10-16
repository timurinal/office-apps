/**
 * What the table buttons do, on whichever cells are chosen (tables.ts): the ribbon's, the Format
 * pane's map, the command box's and the context menu's all end here. Each is one table step
 * (tableOps.ts), and each leaves the chosen cells where the person would expect them: an insert above
 * moves the choice down with its cell, a delete leaves it on the nearest cell, a merge on the merged
 * cell and a split on the cells it freed. A step that is refused says so in a toast.
 */

import type { Toast } from '../../../core/ui';
import type { TableElement } from '../../model/deck';
import type { SlideModel } from '../../model/model';
import type { SelectionStore } from '../../editor/selection';
import { canMerge, canSplit, deleteColumns, deleteRows, insertColumns, insertRows, mergeCells, splitCell, type CellRange, type TableResult } from './tableOps';
import { chooseCells, chosenRange, tablesFor } from './tables';

export interface TableHost {
  model: SlideModel;
  selection: SelectionStore;
  notify: (t: Toast) => void;
}

/** The table that is the only thing chosen on the slide, or null. */
export function selectedTable(h: Pick<TableHost, 'model' | 'selection'>): TableElement | null {
  const s = h.selection.get();
  if (!s.slide || s.els.length !== 1) return null;
  const el = h.model.element(s.slide, s.els[0]!);
  return el?.type === 'table' ? el : null;
}

/** The chosen cells of the chosen table; the first cell when none were chosen, so a button always has something to act on. */
export function chosenCells(h: Pick<TableHost, 'model' | 'selection'>, el: TableElement): CellRange {
  return chosenRange(tablesFor(h.model), el.id!) ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
}

const clamp = (n: number, max: number): number => Math.max(0, Math.min(max, n));

function run(h: TableHost, res: TableResult, then?: (el: TableElement) => void): boolean {
  if (!res.ok) {
    h.notify({ text: res.message, tone: 'danger' });
    return false;
  }
  const el = selectedTable(h);
  if (el && then) then(el);
  return true;
}

/** A row above the chosen cells, or below them. */
export function addRow(h: TableHost, below: boolean): boolean {
  const el = selectedTable(h);
  const slide = h.selection.get().slide;
  if (!el || !slide) return false;
  const r = chosenCells(h, el);
  const at = below ? r.r2 + 1 : r.r1;
  return run(h, insertRows(h.model, slide, el.id!, at), (now) => {
    const shift = below ? 0 : 1;
    chooseCells(h.model, slide, el.id!, { r: clamp(r.r1 + shift, now.rows.length - 1), c: r.c1 }, { r: clamp(r.r2 + shift, now.rows.length - 1), c: r.c2 });
  });
}

/** A column left of the chosen cells, or right of them. */
export function addColumn(h: TableHost, right: boolean): boolean {
  const el = selectedTable(h);
  const slide = h.selection.get().slide;
  if (!el || !slide) return false;
  const r = chosenCells(h, el);
  const at = right ? r.c2 + 1 : r.c1;
  return run(h, insertColumns(h.model, slide, el.id!, at), (now) => {
    const shift = right ? 0 : 1;
    chooseCells(h.model, slide, el.id!, { r: r.r1, c: clamp(r.c1 + shift, now.cols.length - 1) }, { r: r.r2, c: clamp(r.c2 + shift, now.cols.length - 1) });
  });
}

/** The rows the chosen cells are in, deleted. */
export function removeRows(h: TableHost): boolean {
  const el = selectedTable(h);
  const slide = h.selection.get().slide;
  if (!el || !slide) return false;
  const r = chosenCells(h, el);
  return run(h, deleteRows(h.model, slide, el.id!, r.r1, r.r2), (now) => {
    const at = { r: clamp(r.r1, now.rows.length - 1), c: clamp(r.c1, now.cols.length - 1) };
    chooseCells(h.model, slide, el.id!, at);
  });
}

/** The columns the chosen cells are in, deleted. */
export function removeColumns(h: TableHost): boolean {
  const el = selectedTable(h);
  const slide = h.selection.get().slide;
  if (!el || !slide) return false;
  const r = chosenCells(h, el);
  return run(h, deleteColumns(h.model, slide, el.id!, r.c1, r.c2), (now) => {
    const at = { r: clamp(r.r1, now.rows.length - 1), c: clamp(r.c1, now.cols.length - 1) };
    chooseCells(h.model, slide, el.id!, at);
  });
}

export function mergeChosen(h: TableHost): boolean {
  const el = selectedTable(h);
  const slide = h.selection.get().slide;
  if (!el || !slide) return false;
  const res = mergeCells(h.model, slide, el.id!, chosenCells(h, el));
  return run(h, res, () => {
    if (res.ok && res.range) chooseCells(h.model, slide, el.id!, { r: res.range.r1, c: res.range.c1 });
  });
}

export function splitChosen(h: TableHost): boolean {
  const el = selectedTable(h);
  const slide = h.selection.get().slide;
  if (!el || !slide) return false;
  const r = chosenCells(h, el);
  const res = splitCell(h.model, slide, el.id!, { r: r.r1, c: r.c1 });
  return run(h, res, () => {
    if (res.ok && res.range) chooseCells(h.model, slide, el.id!, { r: res.range.r1, c: res.range.c1 }, { r: res.range.r2, c: res.range.c2 });
  });
}

/** Whether Merge cells has something to merge: more than one cell is chosen. */
export function mergeable(h: Pick<TableHost, 'model' | 'selection'>): boolean {
  const el = selectedTable(h);
  return !!el && canMerge(el, chosenCells(h, el));
}

/** Whether Split cell has a merge to undo at the chosen cell. */
export function splittable(h: Pick<TableHost, 'model' | 'selection'>): boolean {
  const el = selectedTable(h);
  if (!el) return false;
  const r = chosenCells(h, el);
  return canSplit(el, { r: r.r1, c: r.c1 });
}

/** The header row, or the banded rows, on or off for the chosen table. */
export function setTableLook(h: Pick<TableHost, 'model' | 'selection'>, key: 'firstRow' | 'bandRows', on: boolean): boolean {
  const el = selectedTable(h);
  const slide = h.selection.get().slide;
  return !!el && !!slide && h.model.updateElements(slide, [{ id: el.id!, patch: { [key]: on } }]);
}
