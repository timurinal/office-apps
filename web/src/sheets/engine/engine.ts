/**
 * The calculation engine: cells keyed by stable row and column ids, a dependency
 * graph, and incremental recalculation in topological order.
 *
 * It mirrors the model rather than owning it. Phase 4's model keeps structure
 * (each sheet's row and column orders) in Yjs and cells as last-writer-wins ops;
 * whatever applies a change to the model makes the same call here (setCell,
 * insertRows, deleteRows, setOrder, ...) and then calls recalc(). Nothing here
 * writes back, except through what a method returns for the model to apply:
 * planDeleteRows's range rewrites, contentFromInput's stored formula, fill's cells,
 * and a request to grow the grid when a typed reference is past its edge.
 *
 * Deleting a row deletes no cells. They are set aside as orphans, and re-inserting
 * the same id (an undo) brings them back with every formula that pointed at them.
 */

import { type DateOrder, nowSerial } from './dates';
import { Ctx, type Value, type Workbook } from './evaluate';
import { callFunction, functionFlags } from './functions/index';
import { parseValue } from './input';
import {
  type Binder,
  FormulaSyntaxError,
  type Locator,
  type Node,
  type Ref,
  type RefNode,
  MAX_COLS,
  MAX_ROWS,
  mapRefs,
  parseA1,
  parseStored,
  printA1,
  printStored,
  walk,
  walkRefs
} from './parser';
import { type Axis, Cell, type CellContent, type RangeListener, RangeIndex, Sheet } from './sheet';
import { CellError, ERR, type Scalar, compare, errorFromLiteral, isError } from './values';

export interface EngineOptions {
  /** The workbook's time zone, so TODAY() is one date for everyone in it. Default UTC. */
  timeZone?: string;
  /** How 3/4/2024 reads, typed or in a formula's text. Default day first. */
  dateOrder?: DateOrder;
  /** Milliseconds since 1970, for NOW and TODAY. Tests inject a fixed clock. */
  now?: () => number;
  /** In [0, 1), for RAND and RANDBETWEEN. */
  random?: () => number;
}

/** A grid that must be at least this big before the input can be stored. */
export interface Growth {
  sheetId: string;
  rows: number;
  cols: number;
}

export type InputResult =
  | { kind: 'content'; content: CellContent | null; format?: string }
  | { kind: 'grow'; sheets: Growth[] }
  | { kind: 'error'; message: string; at: number };

export interface CellWrite {
  sheetId: string;
  rowId: string;
  colId: string;
  content: CellContent | null;
}

export interface NameWrite {
  name: string;
  scope?: string;
  formula: string;
}

/** What the deleting client writes in the same frame as a delete: range ends moved off the deleted lines. */
export interface DeletePlan {
  cells: CellWrite[];
  names: NameWrite[];
}

export type WriteResult = { kind: 'cells'; cells: CellWrite[] } | { kind: 'grow'; sheets: Growth[] };

/** A block of a sheet by position, inclusive. */
export interface Rect {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

/** What copy returns and paste takes: contents with the position they were copied from. */
export interface Clip {
  sheetId: string;
  r1: number;
  c1: number;
  cells: (CellContent | null)[][];
}

/** One key of a sort: a column of the sheet by position, ascending unless said otherwise. */
export interface SortKey {
  col: number;
  descending?: boolean;
}

/** For each row of the sorted block from the top, the row (by position) its contents came from, and the writes. */
export type SortResult = { kind: 'cells'; from: number[]; cells: CellWrite[] } | { kind: 'grow'; sheets: Growth[] };

interface NameDef {
  name: string;
  scope?: string;
  stored: string;
  node: Node;
}

const NAME = /^[\p{L}_\\][\p{L}\p{N}_.\\?]*$/u;
const nameKey = (name: string, scope?: string) => `${scope ?? ''}\u0000${name.toUpperCase()}`;

export class Engine implements Workbook {
  readonly timeZone: string;
  readonly dateOrder: DateOrder;
  private readonly clock: () => number;
  private readonly rng: () => number;
  private readonly sheets = new Map<string, Sheet>();
  /** Per sheet id; kept when a sheet is removed, so re-adding it reconnects its readers. */
  private readonly ranges = new Map<string, RangeIndex>();
  /** sheet id → column id → row id → the formulas with a single reference there. */
  private readonly dependents = new Map<string, Map<string, Map<string, Set<Cell>>>>();
  /** sheet id → column id → row id → cells whose row or column is not in the order. */
  private readonly orphans = new Map<string, Map<string, Map<string, Cell>>>();
  private readonly names = new Map<string, NameDef>();
  private readonly nameReaders = new Map<string, Set<Cell>>();
  private readonly volatiles = new Set<Cell>();
  private readonly positionals = new Set<Cell>();
  private readonly dirty = new Set<Cell>();
  /** Positions whose content changed since the last recalculation: [sheet, row, col]. */
  private changes: [string, string, string][] = [];
  private pass = 0;
  private passNow: number | undefined;
  private lookups = new Map<string, Map<string, number>>();

  /**
   * Told every position whose value may have changed in a recalculation: each content change
   * and each formula that ran. The model's view keeps a cache per cell and drops exactly these.
   */
  onTouch: ((sheetId: string, rowId: string, colId: string) => void) | null = null;

  constructor(opts: EngineOptions = {}) {
    this.timeZone = opts.timeZone ?? 'UTC';
    this.dateOrder = opts.dateOrder ?? 'dmy';
    this.clock = opts.now ?? Date.now;
    this.rng = opts.random ?? Math.random;
  }

  // ------------------------------------------------------------ Workbook, for evaluation

  sheet(id: string): Sheet | undefined {
    return this.sheets.get(id);
  }

  nameNode(name: string, hostSheetId: string): Node | undefined {
    return (this.names.get(nameKey(name, hostSheetId)) ?? this.names.get(nameKey(name)))?.node;
  }

  lookupIndex(key: string, build: () => Map<string, number>): Map<string, number> {
    let index = this.lookups.get(key);
    if (!index) this.lookups.set(key, (index = build()));
    return index;
  }

  callFunction(name: string, args: Node[], ctx: Ctx): Value {
    return callFunction(name, args, ctx);
  }

  now(): number {
    return this.passNow ?? this.clock();
  }

  random(): number {
    return this.rng();
  }

  // ------------------------------------------------------------ sheets

  /** The engine keeps its own copies of the orders; change them through the methods below. */
  addSheet(id: string, name: string, rowOrder: string[], colOrder: string[]): Sheet {
    if (this.sheets.has(id)) throw new Error(`Sheet ${id} exists`);
    const sheet = new Sheet(id, name, [...rowOrder], [...colOrder]);
    this.sheets.set(id, sheet);
    this.ranges.get(id)?.invalidate();
    this.dirtyReadersOf(id);
    return sheet;
  }

  /** Drops a sheet and its cells; formulas that read it show #REF! until a sheet with its id returns. */
  removeSheet(id: string): void {
    const sheet = this.sheets.get(id);
    if (!sheet) return;
    for (const col of sheet.cols.values()) for (const cell of col.values()) this.unregister(cell);
    this.orphans.delete(id);
    this.sheets.delete(id);
    this.ranges.get(id)?.invalidate();
    this.dirtyReadersOf(id);
  }

  /** Formulas store ids, so a rename changes how they print and nothing they hold. */
  renameSheet(id: string, name: string): void {
    const sheet = this.sheets.get(id);
    if (sheet) sheet.name = name;
  }

  sheetByName(name: string): Sheet | undefined {
    const lower = name.toLowerCase();
    for (const s of this.sheets.values()) if (s.name.toLowerCase() === lower) return s;
    return undefined;
  }

  sheetIds(): string[] {
    return [...this.sheets.keys()];
  }

  private dirtyReadersOf(sheetId: string): void {
    const deps = this.dependents.get(sheetId);
    if (deps) for (const col of deps.values()) for (const set of col.values()) for (const c of set) this.dirty.add(c);
    const ranges = this.ranges.get(sheetId);
    if (ranges) for (const l of ranges.all) this.dirty.add(l.owner);
  }

  private mustSheet(id: string): Sheet {
    const s = this.sheets.get(id);
    if (!s) throw new Error(`Unknown sheet ${id}`);
    return s;
  }

  // ------------------------------------------------------------ cells

  /** The model's cell op: content, or null to clear. */
  setCell(sheetId: string, rowId: string, colId: string, content: CellContent | null): void {
    const sheet = this.mustSheet(sheetId);
    const live = sheet.rowIndex().has(rowId) && sheet.colIndex().has(colId);
    const home = live ? sheet.cols : this.orphanCols(sheetId);
    let col = home.get(colId);
    const old = col?.get(rowId);
    if (old) {
      this.unregister(old);
      col!.delete(rowId);
      if (live) sheet.noteRemoved(colId, rowId);
    }
    if (content && (content.f !== undefined || content.v !== undefined || content.e !== undefined)) {
      const cell = new Cell(sheet, rowId, colId, content);
      this.load(cell);
      if (!col) home.set(colId, (col = new Map()));
      col.set(rowId, cell);
      if (live) sheet.notePlaced(cell);
      if (live && cell.formula) {
        this.register(cell);
        this.dirty.add(cell);
      }
    } else if (col && col.size === 0) {
      home.delete(colId);
      if (live) sheet.noteColumnGone(colId);
    }
    if (live) this.changes.push([sheetId, rowId, colId]);
  }

  /** Reads a cell's content into its formula or value. */
  private load(cell: Cell): void {
    const { content } = cell;
    if (content.f !== undefined) {
      try {
        cell.formula = parseStored(content.f);
        cell.value = null;
      } catch (e) {
        if (!(e instanceof FormulaSyntaxError)) throw e;
        cell.value = new CellError('#NAME?', 'The stored formula does not parse');
      }
    } else if (content.e !== undefined) cell.value = errorFromLiteral(content.e) ?? ERR.value;
    else cell.value = content.v ?? null;
  }

  private orphanCols(sheetId: string): Map<string, Map<string, Cell>> {
    let m = this.orphans.get(sheetId);
    if (!m) this.orphans.set(sheetId, (m = new Map()));
    return m;
  }

  getValue(sheetId: string, rowId: string, colId: string): Scalar {
    return this.sheets.get(sheetId)?.cell(rowId, colId)?.value ?? null;
  }

  getContent(sheetId: string, rowId: string, colId: string): CellContent | null {
    return this.sheets.get(sheetId)?.cell(rowId, colId)?.content ?? null;
  }

  /** A cell's content wherever it is: live, or set aside on a deleted row or column. */
  storedContent(sheetId: string, rowId: string, colId: string): CellContent | null {
    return this.sheets.get(sheetId)?.cell(rowId, colId)?.content ?? this.orphans.get(sheetId)?.get(colId)?.get(rowId)?.content ?? null;
  }

  /** Every cell of a sheet, orphans included: what the model holds when the sheet itself goes. */
  eachCell(sheetId: string, visit: (rowId: string, colId: string, content: CellContent) => void): void {
    const sheet = this.sheets.get(sheetId);
    if (!sheet) return;
    for (const [colId, col] of sheet.cols) for (const [rowId, cell] of col) visit(rowId, colId, cell.content);
    for (const [colId, col] of this.orphans.get(sheetId) ?? []) for (const [rowId, cell] of col) visit(rowId, colId, cell.content);
  }

  // ------------------------------------------------------------ the graph

  private depSet(sheetId: string, colId: string, rowId: string): Set<Cell> {
    let bySheet = this.dependents.get(sheetId);
    if (!bySheet) this.dependents.set(sheetId, (bySheet = new Map()));
    let byCol = bySheet.get(colId);
    if (!byCol) bySheet.set(colId, (byCol = new Map()));
    let set = byCol.get(rowId);
    if (!set) byCol.set(rowId, (set = new Set()));
    return set;
  }

  private rangeIndex(sheetId: string): RangeIndex {
    let r = this.ranges.get(sheetId);
    if (!r) this.ranges.set(sheetId, (r = new RangeIndex()));
    return r;
  }

  /** Records what a formula reads: its references, its ranges, its names, and the functions that need more. */
  private register(cell: Cell): void {
    const host = cell.sheet.id;
    const seen = new Set<string>();
    const addRef = (n: RefNode) => {
      if (n.t === 'ref') {
        const set = this.depSet(n.ref.sheet ?? host, n.ref.col!, n.ref.row!);
        set.add(cell);
        (cell.precedents ??= []).push(set);
        return;
      }
      const sheetId = n.a.sheet ?? host;
      const l: RangeListener = { owner: cell, sheetId, a: n.a, b: n.b, buckets: null };
      this.rangeIndex(sheetId).add(l, this.sheets.get(sheetId));
      (cell.listeners ??= []).push(l);
    };
    const scan = (node: Node) => {
      walkRefs(node, addRef);
      walk(node, (n) => {
        if (n.t === 'call') {
          const flags = functionFlags(n.name);
          if (flags.volatile) cell.volatile = true;
          if (flags.positional) cell.positional = true;
          if (flags.subtotal) cell.subtotal = true;
        } else if (n.t === 'bin' && n.op === ':') {
          // A range whose ends are computed, as in A1:INDEX(A:A, n), has no static extent to listen to.
          cell.volatile = true;
        } else if (n.t === 'name') {
          const key = n.name.toUpperCase();
          if (seen.has(key)) return;
          seen.add(key);
          let readers = this.nameReaders.get(key);
          if (!readers) this.nameReaders.set(key, (readers = new Set()));
          readers.add(cell);
          (cell.names ??= []).push(key);
          const def = this.nameNode(n.name, host);
          if (def) scan(def);
        }
      });
    };
    scan(cell.formula!);
    if (cell.volatile) this.volatiles.add(cell);
    if (cell.positional) this.positionals.add(cell);
  }

  private unregister(cell: Cell): void {
    if (cell.precedents) for (const set of cell.precedents) set.delete(cell);
    if (cell.listeners) for (const l of cell.listeners) this.ranges.get(l.sheetId)?.remove(l);
    if (cell.names) for (const k of cell.names) this.nameReaders.get(k)?.delete(cell);
    cell.precedents = cell.listeners = cell.names = null;
    cell.volatile = cell.positional = cell.subtotal = false;
    this.volatiles.delete(cell);
    this.positionals.delete(cell);
    this.dirty.delete(cell);
  }

  /** Every formula that reads the position, directly or through a range. */
  private dependentsOf(sheetId: string, rowId: string, colId: string, visit: (c: Cell) => void): void {
    const set = this.dependents.get(sheetId)?.get(colId)?.get(rowId);
    if (set) for (const c of set) visit(c);
    const sheet = this.sheets.get(sheetId);
    const ranges = this.ranges.get(sheetId);
    if (sheet && ranges) ranges.containing(sheet, rowId, colId, (l) => visit(l.owner));
  }

  // ------------------------------------------------------------ recalculation

  /** Recalculates what changed since the last call, and every volatile formula. Returns how many formulas ran. */
  recalc(): number {
    const seeds = [...this.dirty, ...this.volatiles];
    const changes = this.changes;
    this.dirty.clear();
    this.changes = [];
    return this.run(seeds, changes);
  }

  /** Recalculates every formula. */
  recalcAll(): number {
    const seeds: Cell[] = [];
    for (const s of this.sheets.values()) for (const col of s.cols.values()) for (const c of col.values()) if (c.formula) seeds.push(c);
    this.dirty.clear();
    this.changes = [];
    return this.run(seeds, []);
  }

  private run(seeds: Cell[], changes: [string, string, string][]): number {
    const pass = ++this.pass;
    this.lookups.clear();
    this.passNow = this.clock();
    const all: Cell[] = [];
    const stack: Cell[] = [];
    const reach = (c: Cell) => {
      if (c.pass === pass) return;
      c.pass = pass;
      c.indeg = 0;
      c.outs = null;
      all.push(c);
      stack.push(c);
    };
    for (const c of seeds) if (c.formula && c.sheet.cell(c.row, c.col) === c) reach(c);
    for (const [s, r, col] of changes) this.dependentsOf(s, r, col, reach);
    // The dirty set and the edges inside it, without recursion: a chain can be 100k long.
    while (stack.length) {
      const c = stack.pop()!;
      this.dependentsOf(c.sheet.id, c.row, c.col, (d) => {
        reach(d);
        (c.outs ??= []).push(d);
        d.indeg++;
      });
    }

    // Kahn's algorithm. What it cannot reach sits on a cycle or behind one.
    let evaluated = 0;
    const ready: Cell[] = [];
    for (const c of all) if (c.indeg === 0) ready.push(c);
    const drain = () => {
      while (ready.length) {
        const c = ready.pop()!;
        this.evaluate(c);
        evaluated++;
        c.indeg = -1;
        if (c.outs) for (const d of c.outs) if (d.indeg > 0 && --d.indeg === 0) ready.push(d);
      }
    };
    drain();
    if (evaluated < all.length) {
      const left = all.filter((c) => c.indeg > 0);
      for (const scc of tarjan(left, (c) => (c.outs ?? []).filter((d) => d.indeg > 0))) {
        if (scc.every((c) => c.indeg < 0)) continue;
        const members = new Set(scc);
        const cyclic = scc.length > 1 || !!scc[0]!.outs?.includes(scc[0]!);
        if (!cyclic) continue;
        for (const c of scc) {
          c.value = ERR.circular;
          c.indeg = -1;
          evaluated++;
        }
        for (const c of scc) for (const d of c.outs ?? []) if (!members.has(d) && d.indeg > 0 && --d.indeg === 0) ready.push(d);
        drain();
      }
    }
    this.passNow = undefined;
    for (const c of all) c.outs = null;
    const touch = this.onTouch;
    if (touch) {
      for (const [s, r, col] of changes) touch(s, r, col);
      for (const c of all) touch(c.sheet.id, c.row, c.col);
    }
    return evaluated;
  }

  private evaluate(cell: Cell): void {
    if (!cell.formula) return;
    const ctx = new Ctx(this, cell);
    let v: Scalar;
    try {
      v = ctx.scalar(ctx.eval(cell.formula));
    } catch (e) {
      // A bug in a function must cost one cell, not the recalculation.
      v = new CellError('#VALUE!', e instanceof Error ? e.message : 'Evaluation failed');
    }
    // A reference to an empty cell shows 0, as in Excel.
    cell.value = v === null ? 0 : v;
  }

  /**
   * A stored formula's value as if it sat at (rowId, colId), without storing it: a conditional
   * format's or a validation's own formula. Nothing registers it, so nothing recalculates it;
   * the caller asks again after a change.
   */
  evaluateAt(sheetId: string, rowId: string, colId: string, stored: string): Scalar {
    const cell = new Cell(this.mustSheet(sheetId), rowId, colId, { f: stored });
    this.load(cell);
    if (cell.formula) this.evaluate(cell);
    return cell.value;
  }

  // ------------------------------------------------------------ rows and columns

  insertRows(sheetId: string, index: number, ids: string[]): void {
    this.insert(sheetId, 'rows', index, ids);
  }

  insertCols(sheetId: string, index: number, ids: string[]): void {
    this.insert(sheetId, 'cols', index, ids);
  }

  deleteRows(sheetId: string, index: number, count: number): void {
    this.remove(sheetId, 'rows', index, count);
  }

  deleteCols(sheetId: string, index: number, count: number): void {
    this.remove(sheetId, 'cols', index, count);
  }

  planDeleteRows(sheetId: string, index: number, count: number): DeletePlan {
    return this.planDelete(sheetId, 'rows', index, count);
  }

  planDeleteCols(sheetId: string, index: number, count: number): DeletePlan {
    return this.planDelete(sheetId, 'cols', index, count);
  }

  /** Mirror of an insert into a sheet's order. No formula is rewritten. */
  private insert(sheetId: string, axis: Axis, index: number, ids: string[]): void {
    const sheet = this.mustSheet(sheetId);
    const order = sheet.order(axis);
    if (index < 0 || index > order.length) throw new Error(`Insert at ${index} is outside the ${axis}`);
    // An id twice in an order is two lines sharing cells. Settling duplicates from concurrent moves is the model's.
    const present = sheet.index(axis);
    const added = new Set(ids);
    if (added.size !== ids.length || ids.some((id) => present.has(id))) throw new Error(`Insert repeats an id in the ${axis}`);
    // A spread of a very long list overflows the call stack.
    if (ids.length < 10_000) order.splice(index, 0, ...ids);
    else {
      const tail = order.splice(index);
      for (const id of ids) order.push(id);
      for (const id of tail) order.push(id);
    }
    sheet.orderChanged(axis);
    if (axis === 'cols') this.ranges.get(sheetId)?.invalidate();
    this.dirtyLines(sheetId, axis, added);
    this.dirtyRanges(sheet, axis, added, (lo, hi) => lo < index && hi >= index + ids.length);
    this.revive(sheet, axis, ids);
    for (const c of this.positionals) this.dirty.add(c);
  }

  /** Mirror of a delete from a sheet's order. The cells in those lines become orphans. */
  private remove(sheetId: string, axis: Axis, index: number, count: number): void {
    const sheet = this.mustSheet(sheetId);
    const order = sheet.order(axis);
    if (count <= 0) return;
    if (index < 0 || index + count > order.length) throw new Error(`Delete of ${count} at ${index} is outside the ${axis}`);
    const gone = new Set(order.slice(index, index + count));
    // Ranges are judged on the positions before the delete.
    this.dirtyRanges(sheet, axis, gone, (lo, hi) => lo <= index + count - 1 && hi >= index);
    this.dirtyLines(sheetId, axis, gone);
    const orphans = this.orphanCols(sheetId);
    const park = (cell: Cell) => {
      this.unregister(cell);
      let col = orphans.get(cell.col);
      if (!col) orphans.set(cell.col, (col = new Map()));
      col.set(cell.row, cell);
    };
    if (axis === 'rows') {
      for (const [colId, col] of sheet.cols) {
        for (const rowId of gone) {
          const cell = col.get(rowId);
          if (cell) {
            park(cell);
            col.delete(rowId);
          }
        }
        if (col.size === 0) {
          sheet.cols.delete(colId);
          sheet.noteColumnGone(colId);
        }
      }
    } else {
      for (const colId of gone) {
        const col = sheet.cols.get(colId);
        if (!col) continue;
        for (const cell of col.values()) park(cell);
        sheet.cols.delete(colId);
        sheet.noteColumnGone(colId);
      }
    }
    order.splice(index, count);
    sheet.orderChanged(axis);
    if (axis === 'cols') this.ranges.get(sheetId)?.invalidate();
    for (const c of this.positionals) this.dirty.add(c);
  }

  /**
   * Replaces an order outright, for a sort or a move. Lines that leave orphan their
   * cells and lines that arrive revive theirs; every range on the sheet re-reads.
   */
  setOrder(sheetId: string, axis: Axis, ids: string[]): void {
    const sheet = this.mustSheet(sheetId);
    const before = new Set(sheet.order(axis));
    const after = new Set(ids);
    if (after.size !== ids.length) throw new Error(`The new order repeats an id in the ${axis}`);
    const leaving = [...before].filter((id) => !after.has(id));
    if (leaving.length) {
      // Park the leavers by deleting them one contiguous run at a time, from the end.
      const order = sheet.order(axis);
      const gone = new Set(leaving);
      for (let i = order.length - 1; i >= 0; ) {
        if (!gone.has(order[i]!)) {
          i--;
          continue;
        }
        let j = i;
        while (j > 0 && gone.has(order[j - 1]!)) j--;
        this.remove(sheetId, axis, j, i - j + 1);
        i = j - 1;
      }
    }
    // What stays takes its new order; arrivals then go in through insert, so they revive like an undo.
    const arriving = new Set(ids.filter((id) => !before.has(id)));
    const order = sheet.order(axis);
    order.length = 0;
    for (const id of ids) if (!arriving.has(id)) order.push(id);
    sheet.orderChanged(axis);
    if (axis === 'cols') this.ranges.get(sheetId)?.invalidate();
    for (let i = 0; i < ids.length; i++) if (arriving.has(ids[i]!)) this.insert(sheetId, axis, i, [ids[i]!]);
    // A single reference follows its cell wherever it moves; a range reads whatever is between its ends now.
    const ranges = this.ranges.get(sheetId);
    if (ranges) for (const l of ranges.all) this.dirty.add(l.owner);
    for (const c of this.positionals) this.dirty.add(c);
  }

  /** Single references into the lines: they turn #REF! (a delete) or heal (an undo). */
  private dirtyLines(sheetId: string, axis: Axis, ids: Set<string>): void {
    const deps = this.dependents.get(sheetId);
    if (!deps) return;
    if (axis === 'rows') {
      for (const col of deps.values()) for (const id of ids) col.get(id)?.forEach((c) => this.dirty.add(c));
    } else {
      for (const id of ids) deps.get(id)?.forEach((set) => set.forEach((c) => this.dirty.add(c)));
    }
  }

  /** Ranges along `axis` on the sheet that `hit` says the change lands inside, by position. */
  private dirtyRanges(sheet: Sheet, axis: Axis, ids: Set<string>, hit: (lo: number, hi: number) => boolean): void {
    const ranges = this.ranges.get(sheet.id);
    if (!ranges) return;
    const index = sheet.index(axis);
    for (const l of ranges.all) {
      const x = axis === 'rows' ? l.a.row : l.a.col;
      const y = axis === 'rows' ? l.b.row : l.b.col;
      // A whole column spans every row (and a whole row every column).
      if (x === undefined || y === undefined) {
        this.dirty.add(l.owner);
        continue;
      }
      if (ids.has(x) || ids.has(y)) {
        this.dirty.add(l.owner);
        continue;
      }
      const i = index.get(x);
      const j = index.get(y);
      if (i !== undefined && j !== undefined && hit(Math.min(i, j), Math.max(i, j))) this.dirty.add(l.owner);
    }
  }

  /** Brings back orphans on lines that are in the order again, for an undo of a delete. */
  private revive(sheet: Sheet, axis: Axis, ids: string[]): void {
    const orphans = this.orphans.get(sheet.id);
    if (!orphans || orphans.size === 0) return;
    const ri = sheet.rowIndex();
    const ci = sheet.colIndex();
    const back: Cell[] = [];
    if (axis === 'rows') {
      for (const col of orphans.values()) for (const id of ids) {
        const c = col.get(id);
        if (c && ci.has(c.col)) back.push(c);
      }
    } else {
      for (const id of ids) for (const c of orphans.get(id)?.values() ?? []) if (ri.has(c.row)) back.push(c);
    }
    for (const c of back) {
      const oc = orphans.get(c.col)!;
      oc.delete(c.row);
      if (oc.size === 0) orphans.delete(c.col);
      let col = sheet.cols.get(c.col);
      if (!col) sheet.cols.set(c.col, (col = new Map()));
      col.set(c.row, c);
      sheet.notePlaced(c);
      if (c.formula) {
        this.register(c);
        this.dirty.add(c);
      }
      this.changes.push([sheet.id, c.row, c.col]);
    }
  }

  /**
   * Before a delete: the formula rewrites the deleting client sends with it. A range
   * end on a deleted line moves to the nearest line that survives inside the range,
   * as Excel shrinks a range. A single reference to a deleted line is left alone and
   * shows #REF!, so an undo (the same ids back) restores it untouched.
   */
  private planDelete(sheetId: string, axis: Axis, index: number, count: number): DeletePlan {
    const sheet = this.mustSheet(sheetId);
    const order = sheet.order(axis);
    const gone = new Set(order.slice(index, index + count));
    const pos = sheet.index(axis);
    const last = index + count - 1;
    const end = (r: Ref) => (axis === 'rows' ? r.row : r.col);
    const touches = (a: Ref, b: Ref) => {
      const x = end(a);
      const y = end(b);
      return (x !== undefined && gone.has(x)) || (y !== undefined && gone.has(y));
    };
    const shrink = (n: RefNode, hostSheet: string): Node => {
      if (n.t !== 'range' || (n.a.sheet ?? hostSheet) !== sheetId || !touches(n.a, n.b)) return n;
      const x = pos.get(end(n.a)!);
      const y = pos.get(end(n.b)!);
      if (x === undefined || y === undefined) return n;
      const lo = Math.min(x, y);
      const hi = Math.max(x, y);
      if (lo >= index && hi <= last) return n; // all of it goes: #REF! until an undo
      const top = order[lo < index ? lo : last + 1]!;
      const bottom = order[hi > last ? hi : index - 1]!;
      const [na, nb] = x <= y ? [top, bottom] : [bottom, top];
      const key = axis === 'rows' ? 'row' : 'col';
      return { t: 'range', a: { ...n.a, [key]: na }, b: { ...n.b, [key]: nb } };
    };
    const cells: CellWrite[] = [];
    const owners = new Set<Cell>();
    const ranges = this.ranges.get(sheetId);
    if (ranges) for (const l of ranges.all) if (touches(l.a, l.b)) owners.add(l.owner);
    for (const owner of owners) {
      // A formula in a deleted line goes with it, unchanged, for the undo.
      if (owner.sheet.id === sheetId && gone.has(axis === 'rows' ? owner.row : owner.col)) continue;
      let changed = false;
      const f = mapRefs(owner.formula!, (n) => {
        const m = shrink(n, owner.sheet.id);
        if (m !== n) changed = true;
        return m;
      });
      // A range it reads through a name is the name's to rewrite, below.
      if (changed) cells.push({ sheetId: owner.sheet.id, rowId: owner.row, colId: owner.col, content: { ...owner.content, f: printStored(f) } });
    }
    const names: NameWrite[] = [];
    for (const def of this.names.values()) {
      let changed = false;
      const f = mapRefs(def.node, (n) => {
        const m = shrink(n, '');
        if (m !== n) changed = true;
        return m;
      });
      if (changed) {
        const w: NameWrite = { name: def.name, formula: printStored(f) };
        if (def.scope !== undefined) w.scope = def.scope;
        names.push(w);
      }
    }
    return { cells, names };
  }

  // ------------------------------------------------------------ names

  /** Defines (or with null, removes) a name from its stored formula. `scope` is a sheet id for a sheet-level name. */
  setName(name: string, scope: string | undefined, stored: string | null): void {
    const key = nameKey(name, scope);
    if (stored === null) this.names.delete(key);
    else {
      let node: Node;
      try {
        node = parseStored(stored);
      } catch (e) {
        if (!(e instanceof FormulaSyntaxError)) throw e;
        node = { t: 'err', v: new CellError('#NAME?', 'The stored name does not parse') };
      }
      const def: NameDef = { name, stored, node };
      if (scope !== undefined) def.scope = scope;
      this.names.set(key, def);
    }
    // Everything that reads the name re-registers, so the graph follows the new definition.
    const readers = this.nameReaders.get(name.toUpperCase());
    if (!readers) return;
    for (const c of [...readers]) {
      if (c.sheet.cell(c.row, c.col) !== c) continue;
      this.unregister(c);
      this.register(c);
      this.dirty.add(c);
    }
  }

  /** A name's formula from A1 text, every reference pinned to a sheet so it reads the same from anywhere. */
  nameFromInput(name: string, scope: string | undefined, text: string, hostSheetId?: string): InputResult {
    if (!NAME.test(name) || /^[A-Za-z]{1,3}\d+$/.test(name) || /^R\d*C\d*$/i.test(name) || /^(TRUE|FALSE)$/i.test(name)) {
      return { kind: 'error', message: `${name} cannot be a name`, at: 0 };
    }
    const host = scope ?? hostSheetId ?? this.sheets.keys().next().value;
    if (!host) return { kind: 'error', message: 'There is no sheet', at: 0 };
    const r = this.parseInput(host, text.startsWith('=') ? text : `=${text}`);
    if (r.kind !== 'node') return r;
    const node = mapRefs(r.node, (n) =>
      n.t === 'ref' ? { ...n, ref: { ...n.ref, sheet: n.ref.sheet ?? host } } : { ...n, a: { ...n.a, sheet: n.a.sheet ?? host } }
    );
    return { kind: 'content', content: { f: printStored(node) } };
  }

  displayName(name: string, scope?: string): string | undefined {
    const def = this.names.get(nameKey(name, scope));
    const host = def?.scope ?? this.sheets.keys().next().value;
    const sheet = host ? this.sheets.get(host) : undefined;
    return def && sheet ? printA1(def.node, this.locator(sheet)) : undefined;
  }

  // ------------------------------------------------------------ A1, for people

  locator(host: Sheet): Locator {
    return {
      sheetName: (id) => this.sheets.get(id)?.name,
      rowIndex: (sid, rid) => (sid ? this.sheets.get(sid) : host)?.rowIndex().get(rid),
      colIndex: (sid, cid) => (sid ? this.sheets.get(sid) : host)?.colIndex().get(cid)
    };
  }

  /** A stored formula that is not in a cell (a rule's, a name's) printed in A1 at today's positions; undefined if it does not read. */
  displayStored(sheetId: string, stored: string): string | undefined {
    const sheet = this.sheets.get(sheetId);
    if (!sheet) return undefined;
    try {
      return printA1(parseStored(stored), this.locator(sheet));
    } catch (e) {
      if (e instanceof FormulaSyntaxError) return undefined;
      throw e;
    }
  }

  /** The formula as a person sees it: its ids printed in A1 at today's positions. */
  displayFormula(sheetId: string, rowId: string, colId: string): string | undefined {
    const sheet = this.sheets.get(sheetId);
    const cell = sheet?.cell(rowId, colId);
    return sheet && cell?.formula ? printA1(cell.formula, this.locator(sheet)) : undefined;
  }

  private binder(host: Sheet, growth: Map<string, Growth>): Binder {
    return (sheetName, row, col) => {
      const target = sheetName === undefined ? host : this.sheetByName(sheetName);
      if (!target) return null;
      const out: { sheet?: string; row?: string; col?: string } = {};
      // A typed sheet name stays, even its own, so the formula reads that sheet wherever it is copied.
      if (sheetName !== undefined) out.sheet = target.id;
      const need = (rows: number, cols: number) => {
        const g = growth.get(target.id) ?? { sheetId: target.id, rows: target.rowOrder.length, cols: target.colOrder.length };
        g.rows = Math.max(g.rows, rows);
        g.cols = Math.max(g.cols, cols);
        growth.set(target.id, g);
      };
      if (row !== undefined) {
        if (row >= target.rowOrder.length) need(row + 1, 0);
        out.row = target.rowOrder[row] ?? '_';
      }
      if (col !== undefined) {
        if (col >= target.colOrder.length) need(0, col + 1);
        out.col = target.colOrder[col] ?? '_';
      }
      return out;
    };
  }

  private parseInput(sheetId: string, text: string): { kind: 'node'; node: Node } | InputResult {
    const sheet = this.mustSheet(sheetId);
    const growth = new Map<string, Growth>();
    let node: Node;
    try {
      node = parseA1(text, this.binder(sheet, growth));
    } catch (e) {
      if (e instanceof FormulaSyntaxError) return { kind: 'error', message: e.message, at: e.at };
      throw e;
    }
    if (growth.size) return { kind: 'grow', sheets: [...growth.values()] };
    return { kind: 'node', node };
  }

  /**
   * What typed text becomes. A formula's references are bound to ids; a reference
   * past the grid's edge asks the model to grow the grid first (then call again).
   */
  contentFromInput(sheetId: string, text: string): InputResult {
    if (text.startsWith('=') && text.length > 1) {
      const r = this.parseInput(sheetId, text);
      return r.kind === 'node' ? { kind: 'content', content: { f: printStored(r.node) } } : r;
    }
    const p = parseValue(text, this.dateOrder);
    const out: InputResult = { kind: 'content', content: p.content };
    if (p.format) out.format = p.format;
    return out;
  }

  // ------------------------------------------------------------ copy, paste and fill

  /**
   * A stored formula as it reads when copied from one cell to another: relative
   * parts move by the distance between them, absolute ones stay. A reference
   * without a sheet stays without one, so it reads the sheet it lands on.
   */
  shiftFormula(
    stored: string,
    from: { sheetId: string; row: number; col: number },
    to: { sheetId: string; row: number; col: number }
  ): { kind: 'formula'; formula: string } | { kind: 'grow'; sheets: Growth[] } {
    const source = this.mustSheet(from.sheetId);
    const target = this.mustSheet(to.sheetId);
    const dr = to.row - from.row;
    const dc = to.col - from.col;
    const growth = new Map<string, Growth>();
    const node = parseStored(stored);
    const move = (r: Ref): Ref | null => {
      const home = r.sheet ? this.sheets.get(r.sheet) : source;
      const land = r.sheet ? home : target;
      if (!home || !land) return r;
      const out: Ref = { ...r };
      const axis = (id: string | undefined, abs: boolean, d: number, rows: boolean): string | undefined | null => {
        if (id === undefined || abs || d === 0) {
          // Unmoved, but an unqualified reference rebinds to the same position on the target sheet.
          if (id === undefined || r.sheet || land === home) return id;
          const i = (rows ? home.rowIndex() : home.colIndex()).get(id);
          return i === undefined ? id : (rows ? land.rowOrder : land.colOrder)[i] ?? id;
        }
        const i = (rows ? home.rowIndex() : home.colIndex()).get(id);
        if (i === undefined) return id; // already #REF!; moving it cannot fix it
        const j = i + d;
        const max = rows ? MAX_ROWS : MAX_COLS;
        if (j < 0 || j >= max) return null;
        const ids = rows ? land.rowOrder : land.colOrder;
        if (j >= ids.length) {
          const g = growth.get(land.id) ?? { sheetId: land.id, rows: land.rowOrder.length, cols: land.colOrder.length };
          if (rows) g.rows = Math.max(g.rows, j + 1);
          else g.cols = Math.max(g.cols, j + 1);
          growth.set(land.id, g);
          return '_';
        }
        return ids[j]!;
      };
      const row = axis(r.row, r.rowAbs, dr, true);
      const col = axis(r.col, r.colAbs, dc, false);
      if (row === null || col === null) return null;
      if (row !== undefined) out.row = row;
      if (col !== undefined) out.col = col;
      return out;
    };
    const shifted = mapRefs(node, (n): Node => {
      if (n.t === 'ref') {
        const r = move(n.ref);
        return r ? { t: 'ref', ref: r } : { t: 'err', v: ERR.ref };
      }
      const a = move(n.a);
      const b = move({ ...n.b, sheet: n.a.sheet });
      if (!a || !b) return { t: 'err', v: ERR.ref };
      const end: Ref = { rowAbs: b.rowAbs, colAbs: b.colAbs };
      if (b.row !== undefined) end.row = b.row;
      if (b.col !== undefined) end.col = b.col;
      return { t: 'range', a, b: end };
    });
    if (growth.size) return { kind: 'grow', sheets: [...growth.values()] };
    return { kind: 'formula', formula: printStored(shifted) };
  }

  /**
   * A stored formula after a cut and paste moved the cells of `move.rect` on `move.sheetId`
   * by (`dr`, `dc`) onto `move.toSheetId`, as Excel has it: a reference that lies wholly inside
   * the block follows it, anything else keeps pointing where it did. `host` is the sheet the
   * formula lives on now and `landsOn` the one it lives on afterwards (a moved cell's own
   * formula changes sheet with it). Null when nothing changes.
   */
  movedFormula(
    stored: string,
    host: string,
    move: { sheetId: string; rect: Rect; toSheetId: string; dr: number; dc: number },
    landsOn = host
  ): string | null {
    const from = this.sheets.get(move.sheetId);
    const to = this.sheets.get(move.toSheetId);
    if (!from || !to) return null;
    const { rect, dr, dc } = move;
    const ri = from.rowIndex();
    const ci = from.colIndex();
    const inside = (r: Ref, sheet: string): [number, number] | null => {
      if (sheet !== move.sheetId || r.row === undefined || r.col === undefined) return null;
      const i = ri.get(r.row);
      const j = ci.get(r.col);
      if (i === undefined || j === undefined || i < rect.r1 || i > rect.r2 || j < rect.c1 || j > rect.c2) return null;
      return [i, j];
    };
    let changed = false;
    const place = (r: Ref, at: [number, number] | null, was: string): Ref => {
      const now = at ? move.toSheetId : was;
      const out: Ref = { ...r };
      if (at) {
        out.row = to.rowOrder[at[0] + dr] ?? r.row;
        out.col = to.colOrder[at[1] + dc] ?? r.col;
      }
      if (r.sheet === undefined && now === landsOn) delete out.sheet;
      else out.sheet = now;
      if (out.row !== r.row || out.col !== r.col || out.sheet !== r.sheet) changed = true;
      return out;
    };
    const node = parseStored(stored);
    const moved = mapRefs(node, (n): Node => {
      if (n.t === 'ref') {
        const was = n.ref.sheet ?? host;
        return { t: 'ref', ref: place(n.ref, inside(n.ref, was), was) };
      }
      const was = n.a.sheet ?? host;
      const a = inside(n.a, was);
      const b = inside({ ...n.b, sheet: was }, was);
      // A range follows only when all of it moved.
      const both = a && b;
      const na = place(n.a, both ? a : null, was);
      const nb = place({ ...n.b, sheet: n.a.sheet }, both ? b : null, was);
      const end: Ref = { rowAbs: nb.rowAbs, colAbs: nb.colAbs };
      if (nb.row !== undefined) end.row = nb.row;
      if (nb.col !== undefined) end.col = nb.col;
      return { t: 'range', a: na, b: end };
    });
    return changed ? printStored(moved) : null;
  }

  copy(sheetId: string, rect: Rect): Clip {
    const sheet = this.mustSheet(sheetId);
    const cells: (CellContent | null)[][] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const row: (CellContent | null)[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) {
        const rowId = sheet.rowOrder[r];
        const colId = sheet.colOrder[c];
        row.push(rowId && colId ? (sheet.cell(rowId, colId)?.content ?? null) : null);
      }
      cells.push(row);
    }
    return { sheetId, r1: rect.r1, c1: rect.c1, cells };
  }

  /** The writes that paste a clip with its top-left at (row, col). */
  paste(clip: Clip, sheetId: string, row: number, col: number): WriteResult {
    const writes: { r: number; c: number; content: CellContent | null; from: [number, number] }[] = [];
    clip.cells.forEach((cells, i) =>
      cells.forEach((content, j) => writes.push({ r: row + i, c: col + j, content, from: [clip.r1 + i, clip.c1 + j] }))
    );
    return this.write(clip.sheetId, sheetId, writes);
  }

  /** The writes that fill `target` by repeating `source` (both on one sheet), as the fill handle does. */
  fill(sheetId: string, source: Rect, target: Rect): WriteResult {
    const sheet = this.mustSheet(sheetId);
    const h = source.r2 - source.r1 + 1;
    const w = source.c2 - source.c1 + 1;
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    const writes: { r: number; c: number; content: CellContent | null; from: [number, number] }[] = [];
    for (let r = target.r1; r <= target.r2; r++) {
      for (let c = target.c1; c <= target.c2; c++) {
        if (r >= source.r1 && r <= source.r2 && c >= source.c1 && c <= source.c2) continue;
        const sr = source.r1 + mod(r - source.r1, h);
        const sc = source.c1 + mod(c - source.c1, w);
        const rowId = sheet.rowOrder[sr];
        const colId = sheet.colOrder[sc];
        const content = rowId && colId ? (sheet.cell(rowId, colId)?.content ?? null) : null;
        writes.push({ r, c, content, from: [sr, sc] });
      }
    }
    return this.write(sheetId, sheetId, writes);
  }

  private write(
    fromSheet: string,
    toSheet: string,
    writes: { r: number; c: number; content: CellContent | null; from: [number, number] }[]
  ): WriteResult {
    const sheet = this.mustSheet(toSheet);
    const growth = new Map<string, Growth>();
    const grow = (g: Growth) => {
      const cur = growth.get(g.sheetId) ?? { ...g };
      cur.rows = Math.max(cur.rows, g.rows);
      cur.cols = Math.max(cur.cols, g.cols);
      growth.set(g.sheetId, cur);
    };
    let maxR = -1;
    let maxC = -1;
    for (const w of writes) {
      maxR = Math.max(maxR, w.r);
      maxC = Math.max(maxC, w.c);
    }
    if (maxR >= sheet.rowOrder.length || maxC >= sheet.colOrder.length) {
      grow({ sheetId: toSheet, rows: Math.max(sheet.rowOrder.length, maxR + 1), cols: Math.max(sheet.colOrder.length, maxC + 1) });
    }
    const cells: CellWrite[] = [];
    for (const w of writes) {
      let content = w.content;
      if (content?.f !== undefined) {
        const s = this.shiftFormula(content.f, { sheetId: fromSheet, row: w.from[0], col: w.from[1] }, { sheetId: toSheet, row: w.r, col: w.c });
        if (s.kind === 'grow') {
          s.sheets.forEach(grow);
          continue;
        }
        content = { ...content, f: s.formula };
      }
      if (growth.size) continue;
      cells.push({ sheetId: toSheet, rowId: sheet.rowOrder[w.r]!, colId: sheet.colOrder[w.c]!, content });
    }
    if (growth.size) return { kind: 'grow', sheets: [...growth.values()] };
    return { kind: 'cells', cells };
  }

  /**
   * A sort as Excel and Google Sheets have it: the contents move and the rows stay, so the
   * row order is untouched and a reference from outside the block keeps its position, reading
   * whatever lands there. A formula that moves is shifted like a copy (`=B2*2` sorted into
   * row 5 reads `=B5*2`). Blanks go last either way; otherwise numbers, then text (ignoring
   * case), then logicals, then errors, reversed for a descending key. Ties keep their order.
   */
  sort(sheetId: string, rect: Rect, keys: SortKey[]): SortResult {
    const sheet = this.mustSheet(sheetId);
    const n = rect.r2 - rect.r1 + 1;
    const value = (r: number, c: number): Scalar => {
      const rowId = sheet.rowOrder[r];
      const colId = sheet.colOrder[c];
      return rowId && colId ? (sheet.cell(rowId, colId)?.value ?? null) : null;
    };
    const columns = keys.map((k) => Array.from({ length: n }, (_, i) => value(rect.r1 + i, k.col)));
    const from = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      for (let k = 0; k < keys.length; k++) {
        const d = sortOrder(columns[k]![a]!, columns[k]![b]!, !!keys[k]!.descending);
        if (d) return d;
      }
      return a - b;
    });
    const growth = new Map<string, Growth>();
    const cells: CellWrite[] = [];
    for (let i = 0; i < n; i++) {
      const to = rect.r1 + i;
      const src = rect.r1 + from[i]!;
      if (src === to) continue;
      const rowId = sheet.rowOrder[to];
      const srcRow = sheet.rowOrder[src];
      if (!rowId || !srcRow) continue;
      for (let c = rect.c1; c <= rect.c2; c++) {
        const colId = sheet.colOrder[c];
        if (!colId) continue;
        let content: CellContent | null = sheet.cell(srcRow, colId)?.content ?? null;
        if (content === null && !sheet.cell(rowId, colId)) continue;
        if (content?.f !== undefined) {
          const s = this.shiftFormula(content.f, { sheetId, row: src, col: c }, { sheetId, row: to, col: c });
          if (s.kind === 'grow') {
            for (const g of s.sheets) {
              const cur = growth.get(g.sheetId) ?? { ...g };
              cur.rows = Math.max(cur.rows, g.rows);
              cur.cols = Math.max(cur.cols, g.cols);
              growth.set(g.sheetId, cur);
            }
            continue;
          }
          content = { ...content, f: s.formula };
        }
        cells.push({ sheetId, rowId, colId, content });
      }
    }
    if (growth.size) return { kind: 'grow', sheets: [...growth.values()] };
    return { kind: 'cells', from: from.map((i) => rect.r1 + i), cells };
  }

  /** For tests and tools: NOW and TODAY as this engine would compute them. */
  nowSerial(): number {
    return nowSerial(this.timeZone, this.now());
  }
}

function sortRank(v: Scalar): number {
  return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3;
}

/** Excel's sort order: blanks last whichever way, errors all equal. */
function sortOrder(a: Scalar, b: Scalar, descending: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const ra = sortRank(a);
  const rb = sortRank(b);
  const d = ra !== rb ? ra - rb : isError(a) ? 0 : compare(a, b);
  return descending ? -d : d;
}

/** Iterative Tarjan: strongly connected components, sources first, without recursion. */
function tarjan<T>(nodes: T[], edges: (n: T) => T[]): T[][] {
  const index = new Map<T, number>();
  const low = new Map<T, number>();
  const on = new Set<T>();
  const stack: T[] = [];
  const out: T[][] = [];
  let i = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: { n: T; it: T[]; k: number }[] = [{ n: root, it: edges(root), k: 0 }];
    index.set(root, i);
    low.set(root, i);
    i++;
    stack.push(root);
    on.add(root);
    while (work.length) {
      const top = work[work.length - 1]!;
      if (top.k < top.it.length) {
        const m = top.it[top.k++]!;
        if (!index.has(m)) {
          index.set(m, i);
          low.set(m, i);
          i++;
          stack.push(m);
          on.add(m);
          work.push({ n: m, it: edges(m), k: 0 });
        } else if (on.has(m)) low.set(top.n, Math.min(low.get(top.n)!, index.get(m)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.n, Math.min(low.get(parent.n)!, low.get(top.n)!));
      if (low.get(top.n) === index.get(top.n)) {
        const scc: T[] = [];
        let m: T;
        do {
          m = stack.pop()!;
          on.delete(m);
          scc.push(m);
        } while (m !== top.n);
        out.push(scc);
      }
    }
  }
  // Tarjan emits sinks first.
  return out.reverse();
}
