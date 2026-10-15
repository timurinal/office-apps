/**
 * Evaluating one formula.
 *
 * A subexpression evaluates either in scalar mode or in array mode, which is the
 * difference between Excel before and after dynamic arrays, and what keeps both
 * kinds of workbook right:
 *
 *   · At the top of a cell, and in a scalar argument there, a range where one
 *     value is wanted is implicitly intersected with the cell's row or column, as
 *     pre-365 Excel did: =A1:A10*2 in row 5 is A5*2. A file saved by older Excel
 *     means exactly that.
 *   · Inside an argument that takes a range or array (SUM, SUMPRODUCT, MATCH's
 *     lookup_array, INDEX's array, ...), operators and scalar functions work
 *     element by element, broadcasting a row or column: =SUMPRODUCT((A1:A9="x")*B1:B9)
 *     and =SUM(IF(A1:A9>0,1,0)) work without Ctrl+Shift+Enter, as in 365.
 *
 * There is no spill: a formula whose result is an array shows its first value.
 */

import { type DateOrder, parseDateTime } from './dates';
import type { Node } from './parser';
import { type Cell, RangeValue, type Sheet } from './sheet';
import { type CellError, ERR, type Scalar, compare, isError, parseNumber, toBool, toText } from './values';

export type ArrayValue = Scalar[][];

/** (A1:A3,C1:C3): several ranges as one argument, which only the aggregates take. */
export class UnionValue {
  constructor(readonly ranges: RangeValue[]) {}
}

export type Value = Scalar | RangeValue | ArrayValue | UnionValue;

/** What evaluation needs from the engine. */
export interface Workbook {
  sheet(id: string): Sheet | undefined;
  /** A defined name's formula, local to the host sheet first; undefined if not defined. */
  nameNode(name: string, hostSheetId: string): Node | undefined;
  /** An exact-match index over a range, built once per recalculation pass. */
  lookupIndex(key: string, build: () => Map<string, number>): Map<string, number>;
  callFunction(name: string, args: Node[], ctx: Ctx): Value;
  readonly timeZone: string;
  readonly dateOrder: DateOrder;
  now(): number;
  random(): number;
}

export const isMulti = (v: Value | undefined): boolean =>
  v instanceof RangeValue ? v.rows * v.cols > 1 : Array.isArray(v) ? v.length > 1 || (v[0]?.length ?? 0) > 1 : v instanceof UnionValue;

/** Rows and columns of a range, array or scalar. */
export function dims(v: Value): [number, number] {
  if (v instanceof RangeValue) return [v.rows, v.cols];
  if (Array.isArray(v)) return [v.length, v[0]?.length ?? 0];
  return [1, 1];
}

/** The value at a position of a range, array or scalar (which is the same everywhere). */
export function valueAt(v: Value, r: number, c: number): Scalar {
  if (v instanceof RangeValue) return v.at(r, c);
  if (Array.isArray(v)) return v[r]?.[c] ?? null;
  if (v instanceof UnionValue) return ERR.value;
  return v;
}

/**
 * Broadcasts `vals` over the largest shape among them: an argument with one row
 * or column repeats, and a position past a shorter argument is #N/A.
 */
export function broadcast(vals: Value[], f: (xs: Scalar[]) => Scalar): ArrayValue {
  let rows = 1;
  let cols = 1;
  const shapes = vals.map((v) => {
    const d = dims(v);
    rows = Math.max(rows, d[0]);
    cols = Math.max(cols, d[1]);
    return d;
  });
  const out: ArrayValue = [];
  const xs: Scalar[] = new Array<Scalar>(vals.length);
  for (let r = 0; r < rows; r++) {
    const row: Scalar[] = [];
    for (let c = 0; c < cols; c++) {
      let missing = false;
      for (let i = 0; i < vals.length; i++) {
        const [vr, vc] = shapes[i]!;
        const rr = vr === 1 ? 0 : r;
        const cc = vc === 1 ? 0 : c;
        if (rr >= vr || cc >= vc) {
          missing = true;
          break;
        }
        xs[i] = valueAt(vals[i]!, rr, cc);
      }
      row.push(missing ? ERR.na : f(xs));
    }
    out.push(row);
  }
  return out;
}

export class Ctx {
  /** Array mode for the subexpression being evaluated. */
  array = false;
  private names: string[] = [];

  constructor(
    readonly book: Workbook,
    readonly host: Cell
  ) {}

  eval(n: Node): Value {
    switch (n.t) {
      case 'num':
      case 'str':
      case 'bool':
      case 'err':
      case 'arr':
        return n.v;
      case 'missing':
        return null;
      case 'paren':
        return this.eval(n.e);
      case 'ref': {
        const sheet = n.ref.sheet ? this.book.sheet(n.ref.sheet) : this.host.sheet;
        if (!sheet || !sheet.rowIndex().has(n.ref.row!) || !sheet.colIndex().has(n.ref.col!)) return ERR.ref;
        return sheet.cell(n.ref.row!, n.ref.col!)?.value ?? null;
      }
      case 'range':
        return this.range(n);
      case 'name':
        return this.withName(n.name, (def) => this.eval(def));
      case 'union': {
        const ranges: RangeValue[] = [];
        for (const item of n.items) {
          const r = this.reference(item);
          if (!(r instanceof RangeValue)) return isError(r) ? r : ERR.value;
          ranges.push(r);
        }
        return new UnionValue(ranges);
      }
      case 'un':
        return this.lift1(this.eval(n.e), (x) => {
          const v = this.toNumber(x);
          return isError(v) ? v : n.op === '-' ? -v : v;
        });
      case 'pct':
        return this.lift1(this.eval(n.e), (x) => {
          const v = this.toNumber(x);
          return isError(v) ? v : v / 100;
        });
      case 'bin': {
        if (n.op === ':') return this.rangeOp(n.l, n.r);
        const l = this.eval(n.l);
        const r = this.eval(n.r);
        if (this.array && (isMulti(l) || isMulti(r))) return broadcast([l, r], ([x, y]) => this.binary(n.op, x!, y!));
        return this.binary(n.op, this.scalar(l), this.scalar(r));
      }
      case 'call':
        return this.book.callFunction(n.name, n.args, this);
    }
  }

  /** In array mode; a single reference stays a reference, so SUM(A1) ignores text in A1 as Excel does. */
  evalArray(n: Node): Value {
    const prev = this.array;
    this.array = true;
    const v = this.reference(n);
    this.array = prev;
    return v;
  }

  /** In scalar mode, intersected down to one value. */
  evalScalar(n: Node): Scalar {
    const prev = this.array;
    this.array = false;
    const v = this.scalar(this.eval(n));
    this.array = prev;
    return v;
  }

  /** Evaluates to a reference: a single cell becomes a one-cell range. */
  reference(n: Node): Value {
    if (n.t === 'ref') {
      const sheet = n.ref.sheet ? this.book.sheet(n.ref.sheet) : this.host.sheet;
      const r = sheet?.rowIndex().get(n.ref.row!);
      const c = sheet?.colIndex().get(n.ref.col!);
      return sheet && r !== undefined && c !== undefined ? new RangeValue(sheet, r, r, c, c) : ERR.ref;
    }
    if (n.t === 'name') return this.withName(n.name, (def) => this.reference(def));
    if (n.t === 'paren') return this.reference(n.e);
    return this.eval(n);
  }

  private withName(name: string, f: (def: Node) => Value): Value {
    const def = this.book.nameNode(name, this.host.sheet.id);
    if (!def) return ERR.name;
    const key = name.toUpperCase();
    if (this.names.includes(key)) return ERR.circular;
    this.names.push(key);
    const v = f(def);
    this.names.pop();
    return v;
  }

  private range(n: Extract<Node, { t: 'range' }>): RangeValue | CellError {
    const sheet = n.a.sheet ? this.book.sheet(n.a.sheet) : this.host.sheet;
    if (!sheet) return ERR.ref;
    let r1 = 0;
    let r2 = sheet.rowOrder.length - 1;
    let c1 = 0;
    let c2 = sheet.colOrder.length - 1;
    if (n.a.row) {
      const ri = sheet.rowIndex();
      const x = ri.get(n.a.row);
      const y = ri.get(n.b.row!);
      if (x === undefined || y === undefined) return ERR.ref;
      r1 = Math.min(x, y);
      r2 = Math.max(x, y);
    }
    if (n.a.col) {
      const ci = sheet.colIndex();
      const x = ci.get(n.a.col);
      const y = ci.get(n.b.col!);
      if (x === undefined || y === undefined) return ERR.ref;
      c1 = Math.min(x, y);
      c2 = Math.max(x, y);
    }
    if (r2 < r1 || c2 < c1) return ERR.ref;
    return new RangeValue(sheet, r1, r2, c1, c2);
  }

  /** A1:INDEX(B:B,5): the smallest range holding both ends, which must be on one sheet. */
  private rangeOp(l: Node, r: Node): Value {
    const prev = this.array;
    this.array = true;
    const a = this.reference(l);
    const b = this.reference(r);
    this.array = prev;
    if (isError(a)) return a;
    if (isError(b)) return b;
    if (!(a instanceof RangeValue) || !(b instanceof RangeValue) || a.sheet !== b.sheet) return ERR.value;
    return new RangeValue(a.sheet, Math.min(a.r1, b.r1), Math.max(a.r2, b.r2), Math.min(a.c1, b.c1), Math.max(a.c2, b.c2));
  }

  /** Implicit intersection: the one value a range or array means where one value is wanted. */
  scalar(v: Value | undefined): Scalar {
    if (v === undefined) return null;
    if (v instanceof RangeValue) {
      if (v.rows === 1 && v.cols === 1) return v.at(0, 0);
      const host = this.host;
      if (v.cols === 1) {
        const r = host.sheet.rowIndex().get(host.row);
        if (r !== undefined && r >= v.r1 && r <= v.r2) return v.at(r - v.r1, 0);
      }
      if (v.rows === 1) {
        const c = host.sheet.colIndex().get(host.col);
        if (c !== undefined && c >= v.c1 && c <= v.c2) return v.at(0, c - v.c1);
      }
      return ERR.value;
    }
    if (Array.isArray(v)) return v[0]?.[0] ?? null;
    if (v instanceof UnionValue) return ERR.value;
    return v;
  }

  /** The first value of a range or array, for a lifted function's own result. */
  first(v: Value): Scalar {
    if (v instanceof RangeValue) return v.at(0, 0);
    if (Array.isArray(v)) return v[0]?.[0] ?? null;
    if (v instanceof UnionValue) return ERR.value;
    return v;
  }

  lift1(v: Value, f: (x: Scalar) => Scalar): Value {
    if (this.array && isMulti(v)) return broadcast([v], ([x]) => f(x!));
    return f(this.scalar(v));
  }

  // ------------------------------------------------------------ coercion

  /** Excel's implicit number: text that reads as a number, date or time counts. */
  toNumber(v: Scalar): number | CellError {
    if (typeof v === 'number') return v;
    if (v === null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isError(v)) return v;
    const n = parseNumber(v);
    if (n !== undefined) return n;
    const d = parseDateTime(v, this.book.dateOrder);
    return d ? d.serial : ERR.value;
  }

  /** A scalar argument as a number; `dflt` when it was omitted. */
  num(v: Value | undefined, dflt?: number): number | CellError {
    if (v === undefined) return dflt ?? 0;
    return this.toNumber(this.scalar(v));
  }

  /** An integer argument, truncated toward zero as Excel does. */
  int(v: Value | undefined, dflt?: number): number | CellError {
    const n = this.num(v, dflt);
    return isError(n) ? n : Math.trunc(n);
  }

  str(v: Value | undefined, dflt = ''): string | CellError {
    if (v === undefined) return dflt;
    return toText(this.scalar(v));
  }

  bool(v: Value | undefined, dflt = false): boolean | CellError {
    if (v === undefined) return dflt;
    return toBool(this.scalar(v));
  }

  binary(op: string, l: Scalar, r: Scalar): Scalar {
    if (isError(l)) return l;
    if (isError(r)) return r;
    switch (op) {
      case '&':
        return (toText(l) as string) + (toText(r) as string);
      case '=':
        return compare(l, r) === 0;
      case '<>':
        return compare(l, r) !== 0;
      case '<':
        return compare(l, r) < 0;
      case '>':
        return compare(l, r) > 0;
      case '<=':
        return compare(l, r) <= 0;
      case '>=':
        return compare(l, r) >= 0;
    }
    const a = this.toNumber(l);
    if (isError(a)) return a;
    const b = this.toNumber(r);
    if (isError(b)) return b;
    let v: number;
    switch (op) {
      case '+':
        v = a + b;
        break;
      case '-':
        v = a - b;
        break;
      case '*':
        v = a * b;
        break;
      case '/':
        if (b === 0) return ERR.div0;
        v = a / b;
        break;
      case '^':
        if (a === 0 && b === 0) return ERR.num;
        if (a === 0 && b < 0) return ERR.div0;
        v = Math.pow(a, b);
        break;
      default:
        return ERR.value;
    }
    return Number.isFinite(v) ? v : ERR.num;
  }
}
