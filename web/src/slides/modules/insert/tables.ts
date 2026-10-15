/**
 * Which cell of a table is being typed in, and which cells are chosen for a merge, a fill or a
 * delete. It is this person's alone and never written to the deck, and it is one value for the page
 * held outside React (as the drawing tool is, tool.ts), so the canvas's cell editor, the ribbon's
 * table items and the Format pane's table tab agree on it without the page re-rendering.
 *
 * It names the model it was made for, so a cell chosen in one presentation is not chosen in the
 * next, and every read checks that the table is still there.
 */

import type { Editor } from '@tiptap/core';
import { useSyncExternalStore } from 'react';
import type { SlideModel } from '../../model/model';
import { rangeOf, type CellPos, type CellRange } from './tableOps';

export interface CellEditing extends CellPos {
  slideId: string;
  elId: string;
}

/** The chosen cells: where the choice began, and where it is now. */
export interface CellChoice {
  slideId: string;
  elId: string;
  a: CellPos;
  b: CellPos;
}

export interface TablesState {
  /** The cell with the caret, if any. */
  editing: CellEditing | null;
  /** The cells chosen: the cell last entered, or a range chosen in the Format pane. */
  chosen: CellChoice | null;
}

const NONE: TablesState = { editing: null, chosen: null };

let owner: SlideModel | null = null;
let state: TablesState = NONE;
const listeners = new Set<() => void>();

function set(model: SlideModel, next: TablesState): void {
  owner = model;
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** What is chosen in `model`'s tables. The same object until it changes. */
export const tablesFor = (model: SlideModel): TablesState => (owner === model ? state : NONE);

export function useTables(model: SlideModel): TablesState {
  return useSyncExternalStore(subscribe, () => tablesFor(model), () => NONE);
}

/** The caret goes into a cell, and the cell is the one chosen. */
export function enterCell(model: SlideModel, slideId: string, elId: string, r: number, c: number): void {
  const cur = tablesFor(model);
  const same = cur.editing && cur.editing.slideId === slideId && cur.editing.elId === elId && cur.editing.r === r && cur.editing.c === c;
  if (same && cur.chosen && cur.chosen.a.r === r && cur.chosen.a.c === c && cur.chosen.b.r === r && cur.chosen.b.c === c) return;
  set(model, { editing: { slideId, elId, r, c }, chosen: { slideId, elId, a: { r, c }, b: { r, c } } });
}

/** The caret leaves the cell; the cell stays chosen. */
export function leaveCell(model: SlideModel): void {
  const cur = tablesFor(model);
  if (cur.editing) set(model, { ...cur, editing: null });
}

/** Cells chosen without the caret: the Format pane's map. `b` defaults to `a`, a single cell. */
export function chooseCells(model: SlideModel, slideId: string, elId: string, a: CellPos, b: CellPos = a): void {
  const cur = tablesFor(model);
  const same = cur.chosen && cur.chosen.elId === elId && cur.chosen.a.r === a.r && cur.chosen.a.c === a.c && cur.chosen.b.r === b.r && cur.chosen.b.c === b.c;
  if (same && !cur.editing) return;
  set(model, { editing: null, chosen: { slideId, elId, a, b } });
}

/** Nothing chosen: a different table is selected, or none. */
export function clearCells(model: SlideModel): void {
  const cur = tablesFor(model);
  if (cur.editing || cur.chosen) set(model, NONE);
}

/** The chosen cells of one table as an ordered range, or null when they are another table's. */
export function chosenRange(s: TablesState, elId: string): CellRange | null {
  const ch = s.chosen;
  return ch && ch.elId === elId ? rangeOf(ch.a, ch.b) : null;
}

// ── the editor in the cell ──────────────────────────────────────────────────

/**
 * The Tiptap editor with the caret in a cell, for the ribbon to format through (editor/format.ts takes
 * the text editor of a box from the page, and a cell's is made here, by the canvas layer). It is
 * `null` when no cell has the caret. `onCellActivity` hears the caret move and the text change.
 */
let cell: Editor | null = null;
const activity = new Set<() => void>();

export const cellEditor = (): Editor | null => (cell && !cell.isDestroyed ? cell : null);

export function setCellEditor(editor: Editor | null): void {
  cell = editor;
  noteCellActivity();
}

export const noteCellActivity = (): void => activity.forEach((l) => l());

export function onCellActivity(cb: () => void): () => void {
  activity.add(cb);
  return () => void activity.delete(cb);
}
