/**
 * Find and replace over a sheet or a whole workbook.
 *
 * Find reads what a cell shows (its text after the number format), or with "formulas" what a person
 * would type into it, which for a formula is the formula. A search walks only the cells that hold
 * something, so an empty sheet of a million rows costs nothing, and it gives the main thread back
 * every ten milliseconds or so, so typing in the search box is never behind a search of a big workbook.
 * It reads what a cell shows without drawing the cell, so the grid's cache is as it was after.
 *
 * Replace changes the cells found, as one step however many there are. It works on what would be
 * typed into a cell: a text cell's own text, a number or a date as it is edited (`48000`, not
 * `£48,000`), and a formula only when "formulas" is on, since the result of a formula is not
 * something to type over. A match inside a number's formatting alone (the pound sign) is found and
 * cannot be replaced, and is counted as skipped.
 */

import type { ActionContext } from './actions';

export interface FindOptions {
  query: string;
  matchCase: boolean;
  /** The whole of the cell, not part of it. */
  wholeCell: boolean;
  /** Look in what is typed into a cell (formulas included) rather than in what it shows. */
  inFormulas: boolean;
  scope: 'sheet' | 'workbook';
}

export const DEFAULT_FIND: FindOptions = { query: '', matchCase: false, wholeCell: false, inFormulas: false, scope: 'sheet' };

export interface Match {
  sheet: string;
  row: number;
  col: number;
}

type Ctx = Pick<ActionContext, 'model' | 'sheetId'>;

/** Whether `text` is what the options look for. */
export function matches(text: string, o: FindOptions): boolean {
  if (o.query === '' || text === '') return false;
  const a = o.matchCase ? text : text.toLowerCase();
  const q = o.matchCase ? o.query : o.query.toLowerCase();
  return o.wholeCell ? a === q : a.includes(q);
}

/** `text` with every occurrence of the query replaced; case is ignored unless `matchCase`. A whole-cell match replaces the whole text. */
export function replaceIn(text: string, o: FindOptions, replacement: string): string {
  if (o.query === '') return text;
  if (o.wholeCell) return matches(text, o) ? replacement : text;
  const a = o.matchCase ? text : text.toLowerCase();
  const q = o.matchCase ? o.query : o.query.toLowerCase();
  let out = '';
  let at = 0;
  for (;;) {
    const i = a.indexOf(q, at);
    if (i < 0) break;
    out += text.slice(at, i) + replacement;
    at = i + q.length;
  }
  return out + text.slice(at);
}

/** The sheets a search covers, in tab order. */
function sheetsFor(c: Ctx, o: FindOptions): string[] {
  return o.scope === 'sheet' ? [c.sheetId] : c.model.sheets().map((s) => s.id);
}

/** How long one stretch of searching may hold the page, in milliseconds, before it gives the page back. */
const SLICE_MS = 10;
const later = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Every match, in the order a person reads a workbook: by sheet, then row by row. `cancelled` is
 * asked between slices of the work, so a search that the next keystroke has made out of date stops.
 * Null when it was cancelled.
 */
export async function findAll(c: Ctx, o: FindOptions, cancelled: () => boolean = () => false): Promise<Match[] | null> {
  if (o.query === '') return [];
  const found: Match[] = [];
  const sheets = sheetsFor(c, o);
  for (const id of sheets) {
    const sheet = c.model.engine.sheet(id);
    if (!sheet) continue;
    const rows = sheet.rowIndex();
    const cols = sheet.colIndex();
    // The cells that hold something, in whatever order the engine has them: only the matches are put in reading order.
    const rowIds: string[] = [];
    const colIds: string[] = [];
    c.model.engine.eachCell(id, (rowId, colId) => {
      rowIds.push(rowId);
      colIds.push(colId);
    });
    const view = c.model.view(id);
    const here: Match[] = [];
    let began = performance.now();
    for (let i = 0; i < rowIds.length; i++) {
      // Asked every few hundred cells, so a slow cell cannot hold the page for a whole slice.
      if (i % 256 === 255 && performance.now() - began > SLICE_MS) {
        await later();
        if (cancelled()) return null;
        began = performance.now();
      }
      const rowId = rowIds[i]!;
      const colId = colIds[i]!;
      const row = rows.get(rowId);
      const col = cols.get(colId);
      if (row === undefined || col === undefined) continue;
      // What a cell shows is read without drawing it, so a search of a big sheet leaves the grid's cache as it was.
      const text = o.inFormulas ? view.editText(row, col) : view.textOf(rowId, colId);
      if (matches(text, o)) here.push({ sheet: id, row, col });
    }
    here.sort((a, b) => a.row - b.row || a.col - b.col);
    found.push(...here);
    if (cancelled()) return null;
  }
  return found;
}

/**
 * The match after (or before) `from`, wrapping round, or the first one when `from` is no match.
 * `matches` is in reading order and so is every sheet's cells, so this is a position comparison.
 */
export function stepMatch(list: readonly Match[], sheetOrder: readonly string[], from: Match | null, dir: 1 | -1): number {
  if (list.length === 0) return -1;
  if (!from) return dir === 1 ? 0 : list.length - 1;
  const rank = (m: Match) => [sheetOrder.indexOf(m.sheet), m.row, m.col] as const;
  const cmp = (a: Match, b: Match) => {
    const x = rank(a);
    const y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  if (dir === 1) {
    const at = list.findIndex((m) => cmp(m, from) > 0);
    return at < 0 ? 0 : at;
  }
  for (let i = list.length - 1; i >= 0; i--) if (cmp(list[i]!, from) < 0) return i;
  return list.length - 1;
}

export interface Replaced {
  /** Cells changed. */
  cells: number;
  /** Matches that could not be replaced: a formula's result, or formatting that is not typed. */
  skipped: number;
}

/** The text to type over one cell, or null when there is nothing in it to replace. */
function replacementFor(c: Ctx, m: Match, o: FindOptions, replacement: string): string | null {
  const view = c.model.view(m.sheet);
  const stored = c.model.stored(
    m.sheet,
    c.model.engine.sheet(m.sheet)?.rowOrder[m.row] ?? '',
    c.model.engine.sheet(m.sheet)?.colOrder[m.col] ?? ''
  );
  if (stored?.f !== undefined && !o.inFormulas) return null;
  const typed = view.editText(m.row, m.col);
  // A whole-cell match is on what is shown; against what is typed it can differ, and then nothing matches.
  if (!matches(typed, o)) return null;
  const next = replaceIn(typed, o, replacement);
  return next === typed ? null : next;
}

/** Replaces in each of `list`'s cells, as one step. */
export function replaceMatches(c: ActionContext, list: readonly Match[], o: FindOptions, replacement: string): Replaced {
  let cells = 0;
  let skipped = 0;
  c.model.batch(() => {
    for (const m of list) {
      const next = replacementFor(c, m, o, replacement);
      if (next === null) {
        skipped++;
        continue;
      }
      if (c.model.input(m.sheet, { row: m.row, col: m.col }, next)) cells++;
      else skipped++;
    }
  });
  return { cells, skipped };
}

/** What to tell the person after a replace: once, and only the part that is not a plain success. */
export function replacedText(r: Replaced): string {
  const cells = r.cells === 1 ? '1 cell' : `${r.cells.toLocaleString('en-GB')} cells`;
  if (r.cells === 0) return r.skipped ? 'Nothing could be replaced here.' : 'Nothing to replace.';
  return r.skipped ? `Replaced in ${cells}. ${r.skipped.toLocaleString('en-GB')} left as they are.` : `Replaced in ${cells}.`;
}
