/**
 * A sheet as the engine holds it: the row and column orders (arrays of stable
 * ids, mirroring the model's), and the cells, column-major, keyed by those ids.
 *
 * Every cell in `cols` is live: its row and its column are both in the orders.
 * Cells whose row or column was deleted are kept aside by the engine as orphans
 * (see Engine), so the maps here never need a membership check.
 */

import type { Node, Ref } from './parser';
import type { ErrorCode, Scalar } from './values';

/** One cell as the model stores it: a value, an error, or a stored (id-based) formula. */
export interface CellContent {
  v?: number | string | boolean;
  e?: ErrorCode;
  f?: string;
}

export interface RangeListener {
  owner: Cell;
  sheetId: string;
  a: Ref;
  b: Ref;
  /** The column buckets this listener sits in, so removing it is not a rebuild. */
  buckets: Set<RangeListener>[] | null;
}

export class Cell {
  formula: Node | null = null;
  value: Scalar = null;
  /** The dependents sets this formula is registered in, one per single reference. */
  precedents: Set<Cell>[] | null = null;
  listeners: RangeListener[] | null = null;
  /** Keys of the defined names this formula reads, so redefining one re-registers it. */
  names: string[] | null = null;
  volatile = false;
  positional = false;
  /** Holds SUBTOTAL or AGGREGATE, which SUBTOTAL skips. */
  subtotal = false;
  // Recalculation scratch, meaningful only while `pass` is the engine's current pass.
  pass = 0;
  indeg = 0;
  outs: Cell[] | null = null;

  constructor(
    readonly sheet: Sheet,
    readonly row: string,
    readonly col: string,
    public content: CellContent
  ) {}
}

export type Axis = 'rows' | 'cols';

export class Sheet {
  readonly cols = new Map<string, Map<string, Cell>>();
  private rIdx: Map<string, number> | null = null;
  private cIdx: Map<string, number> | null = null;
  /**
   * A column's cells in row order, for the scans of a tall range that read most of it (`RangeValue.eachCell`). A
   * `Map.get` for each of 100,000 rows is what a whole-column SUM costs, and the totals over such a column are
   * recalculated by every change to it. Built the first time a scan asks, kept in step by the `note*` calls that the
   * engine makes beside each change to `cols`, and dropped whenever the row order changes. A hole is an empty row.
   * It holds the same cells in the same order as the scan it replaces, so a sum is the same float.
   */
  private dense = new Map<string, (Cell | undefined)[]>();
  /** A range of at least this many rows may be scanned through a dense column. Tests lower it. */
  static denseFrom = 4096;

  constructor(
    readonly id: string,
    public name: string,
    public rowOrder: string[],
    public colOrder: string[]
  ) {}

  rowIndex(): Map<string, number> {
    if (!this.rIdx) this.rIdx = indexOf(this.rowOrder);
    return this.rIdx;
  }

  colIndex(): Map<string, number> {
    if (!this.cIdx) this.cIdx = indexOf(this.colOrder);
    return this.cIdx;
  }

  order(axis: Axis): string[] {
    return axis === 'rows' ? this.rowOrder : this.colOrder;
  }

  index(axis: Axis): Map<string, number> {
    return axis === 'rows' ? this.rowIndex() : this.colIndex();
  }

  /** Call after changing an order in place. */
  orderChanged(axis: Axis): void {
    if (axis === 'rows') {
      this.rIdx = null;
      this.dense.clear();
    } else this.cIdx = null;
  }

  /** The column's cells by row position, built on first use; undefined when the column has none. */
  denseColumn(colId: string): (Cell | undefined)[] | undefined {
    const col = this.cols.get(colId);
    if (!col) return undefined;
    let d = this.dense.get(colId);
    // A length that is not the row count means an order changed without telling us: rebuild rather than trust it.
    if (!d || d.length !== this.rowOrder.length) {
      d = new Array<Cell | undefined>(this.rowOrder.length);
      const ri = this.rowIndex();
      for (const [rowId, cell] of col) {
        const i = ri.get(rowId);
        if (i !== undefined) d[i] = cell;
      }
      this.dense.set(colId, d);
    }
    return d;
  }

  /** A live cell was put in `cols`. */
  notePlaced(cell: Cell): void {
    const d = this.dense.get(cell.col);
    if (!d) return;
    const i = this.rowIndex().get(cell.row);
    if (i !== undefined) d[i] = cell;
  }

  /** A live cell was taken out of `cols`. */
  noteRemoved(colId: string, rowId: string): void {
    const d = this.dense.get(colId);
    if (!d) return;
    const i = this.rowIndex().get(rowId);
    if (i !== undefined) d[i] = undefined;
  }

  /** A column's map was deleted from `cols`. */
  noteColumnGone(colId: string): void {
    this.dense.delete(colId);
  }

  cell(rowId: string, colId: string): Cell | undefined {
    return this.cols.get(colId)?.get(rowId);
  }
}

function indexOf(ids: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) m.set(ids[i]!, i);
  return m;
}

/**
 * A rectangle of one sheet at the positions it had when a formula evaluated it.
 * Lazy: nothing is copied until a function asks.
 */
export class RangeValue {
  constructor(
    readonly sheet: Sheet,
    readonly r1: number,
    readonly r2: number,
    readonly c1: number,
    readonly c2: number
  ) {}

  get rows(): number {
    return this.r2 - this.r1 + 1;
  }

  get cols(): number {
    return this.c2 - this.c1 + 1;
  }

  cellAt(r: number, c: number): Cell | undefined {
    const s = this.sheet;
    const colId = s.colOrder[this.c1 + c];
    const rowId = s.rowOrder[this.r1 + r];
    return colId === undefined || rowId === undefined ? undefined : s.cols.get(colId)?.get(rowId);
  }

  at(r: number, c: number): Scalar {
    return this.cellAt(r, c)?.value ?? null;
  }

  /** Every non-empty cell, in no particular order. */
  eachCell(fn: (cell: Cell) => void): void {
    const s = this.sheet;
    const rows = this.rows;
    for (let c = this.c1; c <= this.c2; c++) {
      const col = s.cols.get(s.colOrder[c]!);
      if (!col) continue;
      if (col.size < rows) {
        const ri = s.rowIndex();
        for (const [rowId, cell] of col) {
          const r = ri.get(rowId)!;
          if (r >= this.r1 && r <= this.r2) fn(cell);
        }
      } else if (rows >= Sheet.denseFrom) {
        // A tall range over a column that has cells for all of it: its cells by row position, in the same order.
        const d = s.denseColumn(s.colOrder[c]!)!;
        for (let r = this.r1; r <= this.r2; r++) {
          const cell = d[r];
          if (cell) fn(cell);
        }
      } else {
        for (let r = this.r1; r <= this.r2; r++) {
          const cell = col.get(s.rowOrder[r]!);
          if (cell) fn(cell);
        }
      }
    }
  }

  /** Every position, row by row, empties as null. */
  toArray(): Scalar[][] {
    const s = this.sheet;
    const out: Scalar[][] = [];
    for (let r = 0; r < this.rows; r++) out.push(new Array<Scalar>(this.cols).fill(null));
    for (let c = 0; c < this.cols; c++) {
      const col = s.cols.get(s.colOrder[this.c1 + c]!);
      if (!col) continue;
      for (let r = 0; r < this.rows; r++) {
        const cell = col.get(s.rowOrder[this.r1 + r]!);
        if (cell) out[r]![c] = cell.value;
      }
    }
    return out;
  }
}

/**
 * The ranges that read one sheet, bucketed by column, so a changed cell checks only
 * the ranges over its column. Whole-row ranges sit in their own bucket. A range is
 * checked for row membership through the sheet's index, so a row insert never
 * touches this structure; a column insert rebuilds it.
 */
export class RangeIndex {
  readonly all = new Set<RangeListener>();
  private byCol: Map<string, Set<RangeListener>> | null = null;
  private readonly rowWide = new Set<RangeListener>();

  add(l: RangeListener, sheet: Sheet | undefined): void {
    this.all.add(l);
    if (this.byCol && sheet) this.bucket(l, sheet);
  }

  remove(l: RangeListener): void {
    this.all.delete(l);
    if (l.buckets) for (const b of l.buckets) b.delete(l);
    l.buckets = null;
  }

  /** Column positions changed, or the sheet came or went. */
  invalidate(): void {
    this.byCol = null;
    this.rowWide.clear();
    for (const l of this.all) l.buckets = null;
  }

  private bucket(l: RangeListener, sheet: Sheet): void {
    if (!l.a.col) {
      this.rowWide.add(l);
      l.buckets = [this.rowWide];
      return;
    }
    const ci = sheet.colIndex();
    const x = ci.get(l.a.col);
    const y = ci.get(l.b.col!);
    // A dangling end evaluates to #REF!, and no edit can change that.
    if (x === undefined || y === undefined) return;
    l.buckets = [];
    for (let c = Math.min(x, y); c <= Math.max(x, y); c++) {
      const id = sheet.colOrder[c]!;
      let set = this.byCol!.get(id);
      if (!set) this.byCol!.set(id, (set = new Set()));
      set.add(l);
      l.buckets.push(set);
    }
  }

  /** The ranges that contain the cell at (rowId, colId). */
  containing(sheet: Sheet, rowId: string, colId: string, visit: (l: RangeListener) => void): void {
    if (this.all.size === 0) return;
    if (!this.byCol) {
      this.byCol = new Map();
      this.rowWide.clear();
      for (const l of this.all) this.bucket(l, sheet);
    }
    const set = this.byCol.get(colId);
    if (!set && this.rowWide.size === 0) return;
    const ri = sheet.rowIndex();
    const r = ri.get(rowId);
    if (r === undefined) return;
    const check = (l: RangeListener) => {
      if (!l.a.row) return true;
      const x = ri.get(l.a.row);
      const y = ri.get(l.b.row!);
      return x !== undefined && y !== undefined && r >= Math.min(x, y) && r <= Math.max(x, y);
    };
    if (set) for (const l of set) if (check(l)) visit(l);
    for (const l of this.rowWide) if (check(l)) visit(l);
  }
}
