/**
 * What the core module's buttons, menu rows and keys do, as plain functions over the context.
 *
 * They are kept out of `core.tsx` so each has a test against a real model (`actions.test.ts`)
 * and so a key and a button that mean the same thing call the same code. Each makes one model
 * call, so each is one undoable step and one frame to the room; the model says no, with a notice,
 * where this person cannot edit.
 */

import { rectAddress } from '../grid/a1';
import { pastedRect } from '../grid/Grid';
import { pasteFrom } from '../grid/clipboard';
import { isWholeCols, isWholeRows } from '../grid/selection';
import type { Cellpos, Rect } from '../grid/types';
import type { SheetsContext } from './types';

/** The part of the context these functions read, so a test need not build the rest. */
export type ActionContext = Pick<SheetsContext, 'model' | 'sheetId' | 'data' | 'session' | 'selection' | 'notify'>;

const count = (from: number, to: number): number => to - from + 1;

// ── rows, columns and sheets ────────────────────────────────────────────────

/** The selection's rows, as a start and a count. */
const rowSpan = (r: Rect): [number, number] => [r.r1, count(r.r1, r.r2)];
const colSpan = (r: Rect): [number, number] => [r.c1, count(r.c1, r.c2)];

/** Blank rows above or below the selection, as many as it has rows. */
export function insertRows(c: ActionContext, where: 'above' | 'below'): void {
  const { rect } = c.selection();
  const [at, n] = rowSpan(rect);
  c.model.insertRows(c.sheetId, where === 'above' ? at : rect.r2 + 1, n);
}

/** Blank columns left or right of the selection, as many as it has columns. */
export function insertCols(c: ActionContext, where: 'left' | 'right'): void {
  const { rect } = c.selection();
  const [at, n] = colSpan(rect);
  c.model.insertCols(c.sheetId, where === 'left' ? at : rect.c2 + 1, n);
}

export function deleteRows(c: ActionContext): void {
  const [at, n] = rowSpan(c.selection().rect);
  c.model.deleteRows(c.sheetId, at, n);
}

export function deleteCols(c: ActionContext): void {
  const [at, n] = colSpan(c.selection().rect);
  c.model.deleteCols(c.sheetId, at, n);
}

/**
 * The keys' version of Insert and Delete. Excel asks what to shift when cells are selected, and
 * does not ask when whole rows or columns are: so a key acts only on those, and otherwise is left
 * to the browser, whose Ctrl+- and Ctrl++ are zoom. Returns false when it did nothing.
 */
export function insertByKey(c: ActionContext): boolean {
  const { rect } = c.selection();
  if (isWholeRows(rect, c.data.colCount())) insertRows(c, 'above');
  else if (isWholeCols(rect, c.data.rowCount())) insertCols(c, 'left');
  else return false;
  return true;
}

export function deleteByKey(c: ActionContext): boolean {
  const { rect } = c.selection();
  if (isWholeRows(rect, c.data.colCount())) deleteRows(c);
  else if (isWholeCols(rect, c.data.rowCount())) deleteCols(c);
  else return false;
  return true;
}

/** A sheet after the active one, and showing it. */
export function insertSheet(c: ActionContext & Pick<SheetsContext, 'showSheet' | 'sheets'>): void {
  const at = c.sheets.findIndex((s) => s.id === c.sheetId) + 1;
  const id = c.model.addSheet(undefined, at > 0 ? at : undefined);
  if (id) c.showSheet(id);
}

/**
 * Removing a sheet keeps its cells in the room, so Undo brings it back whole: it asks nothing
 * and offers the Undo. If it was the one on screen, the next tab (or the one before, at the end)
 * takes its place.
 */
export function deleteSheet(c: ActionContext & Pick<SheetsContext, 'sheets' | 'showSheet'>, id = c.sheetId): void {
  const visible = c.sheets.filter((s) => !s.hidden);
  const at = visible.findIndex((s) => s.id === id);
  const name = c.sheets.find((s) => s.id === id)?.name ?? 'the sheet';
  const before = c.model.sheets().length;
  c.model.removeSheet(id);
  // A refusal (the last visible sheet, or a reader) leaves it in place, and says so itself.
  if (c.model.sheets().length >= before) return;
  if (id === c.sheetId) {
    const next = visible[at + 1] ?? visible[at - 1];
    if (next) c.showSheet(next.id);
  }
  c.notify({ text: `Deleted “${name}”.`, action: { label: 'Undo', run: () => void c.model.undo() } });
}

// ── clearing ────────────────────────────────────────────────────────────────

export function clearContents(c: ActionContext): void {
  c.model.clear(c.sheetId, c.selection().rect);
}

// ── AutoSum ─────────────────────────────────────────────────────────────────

export type AutoFunction = 'SUM' | 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN';

const isNumber = (c: ActionContext, row: number, col: number): boolean => c.data.cell(row, col)?.kind === 'number';

/** The numbers that run unbroken from the cell above `at`, upwards, or null when the cell above is not one. */
function runAbove(c: ActionContext, at: Cellpos): Rect | null {
  let r = at.row - 1;
  if (r < 0 || !isNumber(c, r, at.col)) return null;
  while (r > 0 && isNumber(c, r - 1, at.col)) r--;
  return { r1: r, r2: at.row - 1, c1: at.col, c2: at.col };
}

/** The same, from the cell to the left of `at`, leftwards. */
function runLeft(c: ActionContext, at: Cellpos): Rect | null {
  let k = at.col - 1;
  if (k < 0 || !isNumber(c, at.row, k)) return null;
  while (k > 0 && isNumber(c, at.row, k - 1)) k--;
  return { r1: at.row, r2: at.row, c1: k, c2: at.col - 1 };
}

const formula = (fn: AutoFunction, r: Rect): string => `=${fn}(${rectAddress(r)})`;

/**
 * Excel's AutoSum, as far as it goes. On one cell it adds up the numbers directly above it, else
 * those directly to its left, and writes the formula there; with neither it opens an edit of
 * `=SUM(` for the person to point at the cells. On a block it writes the total under each column
 * of it, or beside it when it is one row. All of it is one step.
 */
export function autoSum(c: ActionContext, fn: AutoFunction): void {
  const { rect, active } = c.selection();
  const one = rect.r1 === rect.r2 && rect.c1 === rect.c2;

  if (one) {
    const run = runAbove(c, active) ?? runLeft(c, active);
    if (run) c.model.input(c.sheetId, active, formula(fn, run));
    else if (c.session.beginEdit('type', `=${fn}(`)) {
      // The cell's editor is always mounted, so it can take the keyboard in the same breath.
      document.querySelector<HTMLTextAreaElement>(`[data-sg-editor="${c.session.id}"] textarea`)?.focus({ preventScroll: true });
    }
    return;
  }

  if (rect.r1 === rect.r2) {
    c.model.input(c.sheetId, { row: rect.r1, col: rect.c2 + 1 }, formula(fn, rect));
    return;
  }
  if (rect.c1 === rect.c2) {
    c.model.input(c.sheetId, { row: rect.r2 + 1, col: rect.c1 }, formula(fn, rect));
    return;
  }
  // A block: a total under each column, written as one paste so that it is one step.
  const row: string[] = [];
  for (let col = rect.c1; col <= rect.c2; col++) row.push(formula(fn, { ...rect, c1: col, c2: col }));
  c.model.paste(c.sheetId, { row: rect.r2 + 1, col: rect.c1 }, row.join('\t'));
}

// ── freezing ────────────────────────────────────────────────────────────────

export type FreezeKind = 'row' | 'column' | 'selection' | 'none';

/**
 * Freeze the top row, the first column, everything above and to the left of the selection, or
 * nothing. Each replaces the freeze there was, as Excel's do. A selection in the corner has
 * nothing above or left of it, and says so.
 */
export function freeze(c: ActionContext, kind: FreezeKind): void {
  const { rect } = c.selection();
  switch (kind) {
    case 'row':
      c.model.freeze(c.sheetId, 1, 0);
      return;
    case 'column':
      c.model.freeze(c.sheetId, 0, 1);
      return;
    case 'none':
      c.model.freeze(c.sheetId, 0, 0);
      return;
    case 'selection':
      if (rect.r1 === 0 && rect.c1 === 0) {
        c.notify({ text: 'Select a cell below or to the right of what to freeze.' });
        return;
      }
      c.model.freeze(c.sheetId, rect.r1, rect.c1);
  }
}

/** Which freeze is in force, for a menu to tick. */
export function frozenAs(c: Pick<ActionContext, 'data'>): FreezeKind {
  const { rows, cols } = c.data.frozen();
  if (rows === 0 && cols === 0) return 'none';
  if (rows === 1 && cols === 0) return 'row';
  if (rows === 0 && cols === 1) return 'column';
  return 'selection';
}

// ── the clipboard ───────────────────────────────────────────────────────────

/**
 * Copy or cut the selection, through the page's clipboard path (the grid's own, so what lands on
 * the clipboard is what Ctrl+C puts there): text for everything, and a table with styles for
 * Excel and Google. Cut does not remove anything until the paste lands. Where the browser has no
 * async clipboard it falls back to the old command, which fires the grid's own copy handler.
 */
export async function copySelection(c: ActionContext, cut: boolean): Promise<void> {
  const rect = c.selection().rect;
  const { text, html } = c.data.copy(rect);
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('no async clipboard');
    const parts: Record<string, Blob> = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
    if (html) parts['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(parts)]);
    c.session.setClip({ rect, cut, text });
  } catch {
    c.session.focusGrid();
    if (!document.execCommand(cut ? 'cut' : 'copy')) c.notify({ text: cut ? 'Cut with Ctrl+X.' : 'Copy with Ctrl+C.' });
  }
}

/** Paste what the clipboard holds at the selection, as Ctrl+V does; where the browser will not say, ask for Ctrl+V. */
export async function pasteHere(c: ActionContext): Promise<void> {
  let text = '';
  let html = '';
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      c.notify({ text: 'Paste with Ctrl+V.' });
      return;
    }
  }
  const r = c.selection().rect;
  const at = { row: r.r1, col: r.c1 };
  const intent = pasteFrom({ getData: (type) => (type === 'text/html' ? html : text) }, at, c.session.clip);
  if (!intent || intent.type !== 'paste') return;
  c.model.paste(c.sheetId, intent.at, intent.text, intent.html, intent.cut);
  if (intent.cut) c.session.setClip(null);
  const block = pastedRect(intent.text, at, c.data.rowCount(), c.data.colCount());
  if (block) c.session.selectRect(block);
}
