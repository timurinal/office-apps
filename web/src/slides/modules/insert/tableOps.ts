/**
 * What can be done to a table's structure, and the rules that keep its spans valid.
 *
 * A table is `cols` (px) and `rows`, each `{ h, cells }` with one cell per column. A merge's
 * top-left cell, its owner, carries `rowSpan` and `colSpan`; the cells it covers are `merged: true`
 * and are still there, so every row has exactly `cols.length` cells and a position is always a cell.
 * That is what makes a row or a column insert, delete, merge and split each a small edit of keys and
 * not a rewrite, and what lets two people typing in two cells both land (deck.ts, the Yjs layout).
 *
 * A table is **valid** when every owner's region is inside the table and holds only itself and
 * covered cells, and every covered cell lies in exactly one owner's region (`validateTable`). Every
 * operation here takes a valid table to a valid one; `tableOps.test.ts` runs a few hundred random
 * ones and checks, and that each is one undo entry.
 *
 * ── Why this is not in model.ts ─────────────────────────────────────────────
 * The model's steps cover elements, slides and the design. A table's structure is the Slides
 * Insert module's own, so its steps are written here against the same primitives the model uses
 * (`StepOrigin`, `fixRepeats`, the undo manager's `stopCapturing`): one transaction, between two
 * `stopCapturing`s, so each is one undo entry that never merges with typing. A step that may not run
 * (a reader, a limit) answers a message and writes nothing.
 *
 * Pure of the DOM; it reads and writes the model's `Y.Doc`.
 */

import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import { DECK_LIMITS, type Fill, type TableElement } from '../../model/deck';
import { MESSAGES, StepOrigin, type SlideModel } from '../../model/model';
import { emptyText, isEmptyText } from '../../model/schema';
import { elsOf, fragmentAt, slidesOf, writeText } from '../../model/ydoc';
import { ROW_HEIGHT } from './defaults';

export interface CellPos {
  r: number;
  c: number;
}

/** Inclusive, and in order: `r1 <= r2` and `c1 <= c2`. */
export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export type TableResult = { ok: true; range?: CellRange } | { ok: false; message: string };

type Rows = TableElement['rows'];
type Grid = Pick<TableElement, 'cols' | 'rows'>;

const span = (n: number | undefined): number => Math.max(1, Math.round(typeof n === 'number' && Number.isFinite(n) ? n : 1));

// ── reading the structure ───────────────────────────────────────────────────

/** `owners[r][c]` is the index (`r0 * cols + c0`) of the cell that owns that position, or -1 where the table is broken. */
export function ownersOf(rows: Rows, cols: number): number[][] {
  const owners = rows.map(() => Array.from({ length: cols }, () => -1));
  rows.forEach((row, r) => {
    for (let c = 0; c < cols; c++) {
      const cell = row.cells[c];
      if (!cell || cell.merged) continue;
      for (let rr = r; rr < Math.min(rows.length, r + span(cell.rowSpan)); rr++) {
        for (let cc = c; cc < Math.min(cols, c + span(cell.colSpan)); cc++) if (owners[rr]![cc] === -1) owners[rr]![cc] = r * cols + c;
      }
    }
  });
  return owners;
}

/** The rectangle an owner covers. */
function regionOf(rows: Rows, cols: number, owner: number): CellRange {
  const r = Math.floor(owner / cols);
  const c = owner % cols;
  const cell = rows[r]?.cells[c];
  return { r1: r, c1: c, r2: Math.min(rows.length, r + span(cell?.rowSpan)) - 1, c2: Math.min(cols, c + span(cell?.colSpan)) - 1 };
}

/** What is wrong with a table's spans; nothing for a valid one. */
export function validateTable(t: Grid): string[] {
  const out: string[] = [];
  const cols = t.cols.length;
  const owners = ownersOf(t.rows, cols);
  t.rows.forEach((row, r) => {
    if (row.cells.length !== cols) out.push(`row ${r} has ${row.cells.length} cells, not ${cols}`);
    row.cells.forEach((cell, c) => {
      if (c >= cols) return;
      const own = r * cols + c;
      if (cell.merged) {
        if (owners[r]![c] === -1 || owners[r]![c] === own) out.push(`cell ${r},${c} is covered by nothing`);
        return;
      }
      const rs = span(cell.rowSpan);
      const cs = span(cell.colSpan);
      if (r + rs > t.rows.length || c + cs > cols) out.push(`cell ${r},${c} spans past the table`);
      for (let rr = r; rr < Math.min(t.rows.length, r + rs); rr++) {
        for (let cc = c; cc < Math.min(cols, c + cs); cc++) {
          if (rr === r && cc === c) continue;
          const other = t.rows[rr]?.cells[cc];
          if (!other?.merged) out.push(`cell ${r},${c} spans cell ${rr},${cc}, which is not covered`);
          else if (owners[rr]![cc] !== own) out.push(`cell ${rr},${cc} is covered twice`);
        }
      }
    });
  });
  return out;
}

/** The cell that owns a position: the position itself unless a merge covers it. Null outside the table. */
export function ownerPos(t: Grid, p: CellPos): CellPos | null {
  const cols = t.cols.length;
  if (p.r < 0 || p.c < 0 || p.r >= t.rows.length || p.c >= cols) return null;
  const o = ownersOf(t.rows, cols)[p.r]![p.c]!;
  return o < 0 ? p : { r: Math.floor(o / cols), c: o % cols };
}

export function rangeOf(a: CellPos, b: CellPos): CellRange {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

const clampRange = (t: Grid, r: CellRange): CellRange => ({
  r1: Math.max(0, Math.min(t.rows.length - 1, r.r1)),
  c1: Math.max(0, Math.min(t.cols.length - 1, r.c1)),
  r2: Math.max(0, Math.min(t.rows.length - 1, r.r2)),
  c2: Math.max(0, Math.min(t.cols.length - 1, r.c2))
});

/** `range` grown until it holds every merge it touches whole: what a merge, and the highlight, mean. */
export function expandRange(t: Grid, range: CellRange): CellRange {
  const cols = t.cols.length;
  const owners = ownersOf(t.rows, cols);
  let cur = clampRange(t, range);
  for (let guard = 0; guard < 64; guard++) {
    let next = cur;
    for (let r = cur.r1; r <= cur.r2; r++) {
      for (let c = cur.c1; c <= cur.c2; c++) {
        const o = owners[r]?.[c] ?? -1;
        if (o < 0) continue;
        const g = regionOf(t.rows, cols, o);
        next = { r1: Math.min(next.r1, g.r1), c1: Math.min(next.c1, g.c1), r2: Math.max(next.r2, g.r2), c2: Math.max(next.c2, g.c2) };
      }
    }
    if (next.r1 === cur.r1 && next.c1 === cur.c1 && next.r2 === cur.r2 && next.c2 === cur.c2) break;
    cur = next;
  }
  return cur;
}

/** Whether Merge cells means something for `range`: more than one cell once it holds its merges whole. */
export function canMerge(t: Grid, range: CellRange): boolean {
  const r = expandRange(t, range);
  return r.r2 > r.r1 || r.c2 > r.c1;
}

/** Whether the cell at `p` is a merge that Split cell would undo. */
export function canSplit(t: Grid, p: CellPos): boolean {
  const o = ownerPos(t, p);
  const cell = o ? t.rows[o.r]?.cells[o.c] : undefined;
  return !!cell && (span(cell.rowSpan) > 1 || span(cell.colSpan) > 1);
}

/** The next cell in reading order that is not covered, or the one before; null past either end. */
export function nextCell(t: Grid, p: CellPos, back = false): CellPos | null {
  const cols = t.cols.length;
  const step = back ? -1 : 1;
  for (let i = p.r * cols + p.c + step; i >= 0 && i < t.rows.length * cols; i += step) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (!t.rows[r]?.cells[c]?.merged) return { r, c };
  }
  return null;
}

/** Every position of a range, in reading order. */
export function positionsIn(range: CellRange): CellPos[] {
  const out: CellPos[] = [];
  for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) out.push({ r, c });
  return out;
}

// ── writing ─────────────────────────────────────────────────────────────────

interface Loaded {
  el: TableElement;
  map: Y.Map<unknown>;
  rows: Y.Array<Y.Map<unknown>>;
}

function load(model: SlideModel, slideId: string, elId: string): Loaded | null {
  const el = model.element(slideId, elId);
  if (!el || el.type !== 'table') return null;
  const slide = slidesOf(model.doc).get(slideId);
  const map = slide ? elsOf(slide)?.get(elId) : null;
  const rows = map?.get('rows');
  if (!(map instanceof Y.Map) || !(rows instanceof Y.Array)) return null;
  return { el, map, rows: rows as Y.Array<Y.Map<unknown>> };
}

const fail = (message: string): TableResult => ({ ok: false, message });
const tooMany = `A table holds at most ${DECK_LIMITS.tableCells.toLocaleString('en-GB')} cells.`;
const broken = 'That table cannot be changed.';

/** Roughly what a new cell weighs once encoded, for the size check. */
const CELL_BYTES = 160;

/** One step: refused before it writes anything, then one transaction that is one undo entry. */
function step(model: SlideModel, name: string, bytes: number, run: () => void): TableResult {
  if (model.isReadOnly) return fail(MESSAGES.readOnly);
  if (model.bytes() + bytes > LIMITS.docStateMaxBytes) return fail(MESSAGES.size);
  model.fixRepeats();
  model.undoManager.stopCapturing();
  model.doc.transact(run, new StepOrigin(name));
  model.undoManager.stopCapturing();
  return { ok: true };
}

const cellsOf = (row: Y.Map<unknown>): Y.Array<Y.Map<unknown>> => row.get('cells') as Y.Array<Y.Map<unknown>>;
const cellAt = (rows: Y.Array<Y.Map<unknown>>, r: number, c: number): Y.Map<unknown> => cellsOf(rows.get(r)!).get(c)!;

function setSpan(cell: Y.Map<unknown>, key: 'rowSpan' | 'colSpan', n: number): void {
  if (n > 1) cell.set(key, n);
  else cell.delete(key);
}

/** An empty cell, in a parent that is already in the document, taking the look of `like` when it has one. */
function newCell(parent: Y.Array<Y.Map<unknown>>, at: number, merged: boolean, like?: TableElement['rows'][number]['cells'][number]): void {
  const m = new Y.Map<unknown>();
  parent.insert(at, [m]);
  if (merged) m.set('merged', true);
  else if (like && !like.merged) {
    if (like.fill) m.set('fill', like.fill);
    if (like.anchor) m.set('anchor', like.anchor);
  }
  const frag = new Y.XmlFragment();
  m.set('text', frag);
  writeText(frag, emptyText());
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Rows added before row `at` (the end when `at` is the row count). Each copies the look of the row above, or below the first. */
export function insertRows(model: SlideModel, slideId: string, elId: string, at: number, count = 1): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, map, rows } = t;
  if (validateTable(el).length) return fail(broken);
  const nrows = el.rows.length;
  const ncols = el.cols.length;
  const where = Math.max(0, Math.min(nrows, Math.round(at)));
  const n = Math.max(1, Math.round(count));
  if ((nrows + n) * ncols > DECK_LIMITS.tableCells) return fail(tooMany);
  return step(model, 'table-insert-rows', n * ncols * CELL_BYTES, () => {
    const owners = ownersOf(el.rows, ncols);
    const through = Array.from({ length: ncols }, (_, c) => where > 0 && where < nrows && owners[where - 1]![c]! >= 0 && owners[where - 1]![c] === owners[where]![c]);
    const grown = new Set<number>();
    through.forEach((inside, c) => {
      if (!inside) return;
      const o = owners[where - 1]![c]!;
      if (grown.has(o)) return;
      grown.add(o);
      const owner = cellAt(rows, Math.floor(o / ncols), o % ncols);
      owner.set('rowSpan', span(owner.get('rowSpan') as number | undefined) + n);
    });
    const like = el.rows[where - 1] ?? el.rows[where];
    for (let i = 0; i < n; i++) {
      const row = new Y.Map<unknown>();
      rows.insert(where + i, [row]);
      row.set('h', like?.h ?? ROW_HEIGHT);
      const cells = new Y.Array<Y.Map<unknown>>();
      row.set('cells', cells);
      for (let c = 0; c < ncols; c++) newCell(cells, c, through[c]!, like?.cells[c]);
    }
    map.set('h', round2(el.h + n * (like?.h ?? ROW_HEIGHT)));
  });
}

/** Rows `r1` to `r2` deleted. A merge that loses its first row hands itself to the cell below it. */
export function deleteRows(model: SlideModel, slideId: string, elId: string, r1: number, r2 = r1): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, map, rows } = t;
  if (validateTable(el).length) return fail(broken);
  const nrows = el.rows.length;
  const ncols = el.cols.length;
  const a = Math.max(0, Math.min(r1, r2));
  const b = Math.min(nrows - 1, Math.max(r1, r2));
  if (a > b) return fail(broken);
  if (b - a + 1 >= nrows) return fail('A table needs at least one row.');
  return step(model, 'table-delete-rows', 0, () => {
    const owners = ownersOf(el.rows, ncols);
    const seen = new Set<number>();
    for (let r = a; r <= b; r++) {
      for (let c = 0; c < ncols; c++) {
        const o = owners[r]![c]!;
        if (o < 0 || seen.has(o)) continue;
        seen.add(o);
        const g = regionOf(el.rows, ncols, o);
        const left = g.r2 - g.r1 + 1 - (Math.min(g.r2, b) - Math.max(g.r1, a) + 1);
        if (left <= 0) continue;
        const cs = g.c2 - g.c1 + 1;
        if (g.r1 >= a && g.r1 <= b) {
          const heir = cellAt(rows, b + 1, g.c1);
          heir.delete('merged');
          setSpan(heir, 'rowSpan', left);
          setSpan(heir, 'colSpan', cs);
        } else setSpan(cellAt(rows, g.r1, g.c1), 'rowSpan', left);
      }
    }
    const gone = sum(el.rows.slice(a, b + 1).map((r) => r.h));
    rows.delete(a, b - a + 1);
    map.set('h', round2(Math.max(ROW_HEIGHT, el.h - gone)));
  });
}

/** Columns added before column `at`, the table keeping its width: the others give up room to them equally. */
export function insertColumns(model: SlideModel, slideId: string, elId: string, at: number, count = 1): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, map, rows } = t;
  if (validateTable(el).length) return fail(broken);
  const nrows = el.rows.length;
  const ncols = el.cols.length;
  const where = Math.max(0, Math.min(ncols, Math.round(at)));
  const n = Math.max(1, Math.round(count));
  if (nrows * (ncols + n) > DECK_LIMITS.tableCells) return fail(tooMany);
  return step(model, 'table-insert-columns', n * nrows * CELL_BYTES, () => {
    const owners = ownersOf(el.rows, ncols);
    const grown = new Set<number>();
    const through = el.rows.map((_, r) => where > 0 && where < ncols && owners[r]![where - 1]! >= 0 && owners[r]![where - 1] === owners[r]![where]);
    through.forEach((inside, r) => {
      if (!inside) return;
      const o = owners[r]![where - 1]!;
      if (grown.has(o)) return;
      grown.add(o);
      const owner = cellAt(rows, Math.floor(o / ncols), o % ncols);
      owner.set('colSpan', span(owner.get('colSpan') as number | undefined) + n);
    });
    el.rows.forEach((row, r) => {
      const cells = cellsOf(rows.get(r)!);
      const like = row.cells[where - 1] ?? row.cells[where];
      for (let i = 0; i < n; i++) newCell(cells, where + i, through[r]!, like);
    });
    const total = sum(el.cols);
    const each = total / (ncols + n);
    const keep = ncols / (ncols + n);
    const next = [...el.cols.map((w) => round2(w * keep))];
    next.splice(where, 0, ...Array.from({ length: n }, () => round2(each)));
    map.set('cols', next);
    map.set('w', round2(sum(next)));
  });
}

/** Columns `c1` to `c2` deleted, the table keeping its width. A merge that loses its first column hands itself to the next. */
export function deleteColumns(model: SlideModel, slideId: string, elId: string, c1: number, c2 = c1): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, map, rows } = t;
  if (validateTable(el).length) return fail(broken);
  const ncols = el.cols.length;
  const a = Math.max(0, Math.min(c1, c2));
  const b = Math.min(ncols - 1, Math.max(c1, c2));
  if (a > b) return fail(broken);
  if (b - a + 1 >= ncols) return fail('A table needs at least one column.');
  return step(model, 'table-delete-columns', 0, () => {
    const owners = ownersOf(el.rows, ncols);
    const seen = new Set<number>();
    el.rows.forEach((_, r) => {
      for (let c = a; c <= b; c++) {
        const o = owners[r]![c]!;
        if (o < 0 || seen.has(o)) continue;
        seen.add(o);
        const g = regionOf(el.rows, ncols, o);
        const left = g.c2 - g.c1 + 1 - (Math.min(g.c2, b) - Math.max(g.c1, a) + 1);
        if (left <= 0) continue;
        const rs = g.r2 - g.r1 + 1;
        if (g.c1 >= a && g.c1 <= b) {
          const heir = cellAt(rows, g.r1, b + 1);
          heir.delete('merged');
          setSpan(heir, 'colSpan', left);
          setSpan(heir, 'rowSpan', rs);
        } else setSpan(cellAt(rows, g.r1, g.c1), 'colSpan', left);
      }
    });
    el.rows.forEach((_, r) => cellsOf(rows.get(r)!).delete(a, b - a + 1));
    const total = sum(el.cols);
    const kept = el.cols.filter((_, c) => c < a || c > b);
    const k = total / Math.max(1, sum(kept));
    const next = kept.map((w) => round2(w * k));
    map.set('cols', next);
    map.set('w', round2(sum(next)));
  });
}

/**
 * The cells of `range`, made one: its owner is the top-left cell, and takes the text of the others in
 * reading order, one paragraph after another. The range is first grown to hold every merge it
 * touches whole. Answers the range it merged.
 */
export function mergeCells(model: SlideModel, slideId: string, elId: string, range: CellRange): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, rows } = t;
  if (validateTable(el).length) return fail(broken);
  const r = expandRange(el, range);
  if (r.r1 === r.r2 && r.c1 === r.c2) return fail('Choose more than one cell to merge.');
  const res = step(model, 'table-merge', 0, () => {
    const paragraphs = positionsIn(r)
      .map((p) => el.rows[p.r]!.cells[p.c]!)
      .filter((cell) => !cell.merged && !isEmptyText(cell.text))
      .flatMap((cell) => cell.text.content);
    const owner = cellAt(rows, r.r1, r.c1);
    if (paragraphs.length) {
      const frag = fragmentAt(owner, 'text');
      if (frag) writeText(frag, { type: 'doc', content: paragraphs });
    }
    for (const p of positionsIn(r)) {
      const m = cellAt(rows, p.r, p.c);
      if (p.r === r.r1 && p.c === r.c1) continue;
      m.set('merged', true);
      m.delete('rowSpan');
      m.delete('colSpan');
      const frag = fragmentAt(m, 'text');
      if (frag && !isEmptyText(el.rows[p.r]!.cells[p.c]!.text)) writeText(frag, emptyText());
    }
    owner.delete('merged');
    setSpan(owner, 'rowSpan', r.r2 - r.r1 + 1);
    setSpan(owner, 'colSpan', r.c2 - r.c1 + 1);
  });
  return res.ok ? { ok: true, range: r } : res;
}

/** The merge that holds `p`, undone: its cells are separate again, the first keeping the text. */
export function splitCell(model: SlideModel, slideId: string, elId: string, p: CellPos): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, rows } = t;
  if (validateTable(el).length) return fail(broken);
  const o = ownerPos(el, p);
  if (!o || !canSplit(el, o)) return fail('That cell is not merged.');
  const g = regionOf(el.rows, el.cols.length, o.r * el.cols.length + o.c);
  const res = step(model, 'table-split', 0, () => {
    for (const q of positionsIn(g)) {
      const m = cellAt(rows, q.r, q.c);
      m.delete('merged');
      m.delete('rowSpan');
      m.delete('colSpan');
    }
  });
  return res.ok ? { ok: true, range: g } : res;
}

export interface CellLook {
  /** `null` takes the cell's own fill away, so the table's look shows. */
  fill?: Fill | null;
  anchor?: 'top' | 'middle' | 'bottom' | null;
}

/** A fill or an anchor on every cell of a range, as one step. */
export function setCellLook(model: SlideModel, slideId: string, elId: string, range: CellRange, look: CellLook): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, rows } = t;
  const r = clampRange(el, range);
  return step(model, 'table-cells', JSON.stringify(look).length * (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1), () => {
    for (const p of positionsIn(r)) {
      const m = cellAt(rows, p.r, p.c);
      for (const [key, value] of Object.entries(look)) {
        if (value === undefined) continue;
        if (value === null) m.delete(key);
        else m.set(key, value);
      }
    }
  });
}

/** The table made `w` wide and `h` tall, its columns and rows scaled with it. */
export function resizeTable(model: SlideModel, slideId: string, elId: string, w: number, h: number): TableResult {
  const t = load(model, slideId, elId);
  if (!t) return fail(broken);
  const { el, map, rows } = t;
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return fail(MESSAGES.invalid);
  return step(model, 'table-resize', el.rows.length * 16, () => {
    const kw = w / Math.max(1, sum(el.cols));
    const kh = h / Math.max(1, sum(el.rows.map((r) => r.h)));
    const cols = el.cols.map((c) => round2(c * kw));
    map.set('cols', cols);
    map.set('w', round2(sum(cols)));
    const heights = el.rows.map((r) => round2(r.h * kh));
    heights.forEach((rh, r) => rows.get(r)!.set('h', rh));
    map.set('h', round2(sum(heights)));
  });
}
