/**
 * What every function file shares: the definition shape, and Excel's rules for
 * reading arguments.
 *
 * The rule that makes the core functions ours rather than formulajs's: what a
 * value means depends on where it came from. SUM ignores the text "3" in a cell
 * of its range but adds the text "3" written as an argument, and ignores an empty
 * cell but counts an omitted argument as 0. formulajs receives plain arrays and
 * cannot tell the two apart.
 */

import type { Ctx, Value } from '../evaluate';
import { UnionValue } from '../evaluate';
import type { Node } from '../parser';
import { RangeValue } from '../sheet';
import { type CellError, ERR, type Scalar, isError, parseNumber } from '../values';

/**
 * An evaluated argument. Omitted (past the last one written) is undefined; written
 * but empty, as in ROUND(1.5,), is null, which reads as 0, FALSE or "" as in Excel.
 */
export type Args = (Value | undefined)[];

export interface FnDef {
  min: number;
  max: number;
  /**
   * One letter per parameter. `s`, the default, is one value: a range there is
   * intersected with the formula's row or column, or, in array mode, the call runs
   * once per element. `a` is a range or array, passed whole; a single reference
   * stays a reference.
   */
  kinds?: string;
  /** How many of the last kinds repeat for further arguments. */
  repeat?: number;
  fn?: (args: Args, ctx: Ctx) => Value;
  /** Gets the unevaluated arguments, for IF and others that must not evaluate every one. */
  lazy?: (args: Node[], ctx: Ctx) => Value;
  /** Changes without its inputs changing, so every recalculation runs it. */
  volatile?: true;
  /** Reads where its cell or a reference is, so an insert or delete re-runs it. */
  positional?: true;
}

export type FnTable = Record<string, FnDef>;

export const given = (v: Value | undefined): boolean => v !== undefined && v !== null;

/** Every position of a range, array or scalar, row by row, empties as null. */
export function flat(v: Value | undefined): Scalar[] {
  if (v === undefined) return [];
  if (v instanceof RangeValue) return v.toArray().flat();
  if (Array.isArray(v)) return v.flat();
  if (v instanceof UnionValue) return v.ranges.flatMap((r) => r.toArray().flat());
  return [v];
}

export interface Collect {
  /** In a range, text counts as 0 and a logical as 1 or 0 (AVERAGEA, MAXA, ...). */
  a?: boolean;
  /** Skip cells that hold SUBTOTAL or AGGREGATE. */
  skipSubtotals?: boolean;
  /** Keep the order of the cells (row by row), for MODE's tie-break. */
  ordered?: boolean;
}

/**
 * Hand every number an aggregate sees to `add`, in order, and return the first error that stops it. In a range or
 * array: numbers, and the first error stops it; text, logicals and empties are skipped. A direct argument is
 * coerced, so "3" is 3 and TRUE is 1, and "x" is #VALUE!.
 */
function feed(args: Args, ctx: Ctx, opts: Collect, add: (n: number) => void): CellError | undefined {
  let err: CellError | undefined;
  const take = (x: Scalar) => {
    if (err) return;
    if (typeof x === 'number') add(x);
    else if (isError(x)) err = x;
    else if (opts.a && x !== null) add(typeof x === 'boolean' ? (x ? 1 : 0) : 0);
  };
  for (const v of args) {
    if (v instanceof RangeValue && opts.ordered) {
      for (const row of v.toArray()) for (const x of row) take(x);
    } else if (v instanceof RangeValue) {
      if (opts.skipSubtotals) v.eachCell((c) => c.subtotal || take(c.value));
      else v.eachCell((c) => take(c.value));
    } else if (v instanceof UnionValue) {
      for (const r of v.ranges) r.eachCell((c) => (opts.skipSubtotals && c.subtotal) || take(c.value));
    } else if (Array.isArray(v)) {
      for (const row of v) for (const x of row) take(x);
    } else {
      const n = ctx.toNumber(v ?? 0);
      if (isError(n)) return n;
      add(n);
    }
    if (err) return err;
  }
  return undefined;
}

/** The numbers an aggregate sees (see `feed`), as a list. */
export function numbers(args: Args, ctx: Ctx, opts: Collect = {}): number[] | CellError {
  const out: number[] = [];
  return feed(args, ctx, opts, (n) => out.push(n)) ?? out;
}

/**
 * The sum and the count of the numbers an aggregate sees, without the list `numbers` builds. SUM and AVERAGE over
 * a whole column are the heaviest thing a big sheet recalculates, and the list is 100,000 numbers made to be added
 * once. The same cells in the same order, so the same float as summing the list.
 */
export function sumAndCount(args: Args, ctx: Ctx, opts: Collect = {}): { sum: number; count: number } | CellError {
  let total = 0;
  let count = 0;
  const err = feed(args, ctx, opts, (n) => {
    total += n;
    count++;
  });
  return err ?? { sum: total, count };
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** A number result; an infinity or NaN is #NUM!, as Excel never shows either. */
export function finite(n: number): number | CellError {
  return Number.isFinite(n) ? n : ERR.num;
}

/** A range or array argument as something indexable by row and column. */
export type Grid = RangeValue | Scalar[][];

export function grid(v: Value | undefined): Grid | CellError {
  if (v instanceof RangeValue || Array.isArray(v)) return v;
  if (v instanceof UnionValue) return ERR.value;
  if (isError(v)) return v;
  return [[v ?? null]];
}

export function gridDims(g: Grid): [number, number] {
  return g instanceof RangeValue ? [g.rows, g.cols] : [g.length, g[0]?.length ?? 0];
}

export function gridAt(g: Grid, r: number, c: number): Scalar {
  return g instanceof RangeValue ? g.at(r, c) : (g[r]?.[c] ?? null);
}

/** One row or column of a grid as a list. */
export interface Line {
  length: number;
  get(i: number): Scalar;
}

export function line(g: Grid, horizontal: boolean, k: number): Line {
  const [rows, cols] = gridDims(g);
  return horizontal ? { length: cols, get: (i) => gridAt(g, k, i) } : { length: rows, get: (i) => gridAt(g, i, k) };
}

/** A one-row or one-column grid as a list; undefined for a block. */
export function vector(g: Grid): { line: Line; horizontal: boolean } | undefined {
  const [rows, cols] = gridDims(g);
  if (rows !== 1 && cols !== 1) return undefined;
  const horizontal = rows === 1 && cols > 1;
  return { line: line(g, horizontal, 0), horizontal };
}

// ---------------------------------------------------------------- criteria

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** Excel's wildcards: * any run, ? one character, ~ escapes the next. Case-insensitive. */
export function wildcard(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '~' && i + 1 < pattern.length) re += pattern[++i]!.replace(RE_SPECIAL, '\\$&');
    else if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(RE_SPECIAL, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is');
}

export const hasWildcard = (s: string): boolean => /[*?~]/.test(s);

/**
 * A COUNTIF-family criterion: 5, ">5", "<>x", "a*", "", "=", ">1/1/2024", "#N/A".
 * A number matches numbers and numeric text; an inequality on a number matches
 * only numbers; text compares without case and takes wildcards on = and <>.
 */
export function criterion(c: Scalar, ctx: Ctx): (v: Scalar) => boolean {
  if (typeof c === 'number') return (v) => v === c || (typeof v === 'string' && parseNumber(v) === c);
  if (typeof c === 'boolean') return (v) => v === c;
  if (c === null) return (v) => v === null || v === '';
  if (isError(c)) return (v) => isError(v) && v.code === c.code;
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!;
  const op = m[1] ?? '=';
  const rest = m[2]!;
  if (rest === '') {
    if (op === '=') return (v) => v === null || v === '';
    if (op === '<>') return (v) => v !== null && v !== '';
    return () => false;
  }
  const n = ctx.toNumber(rest);
  if (!isError(n) && rest.trim() !== '') {
    const test = (x: number) =>
      op === '=' ? x === n : op === '<>' ? x !== n : op === '<' ? x < n : op === '>' ? x > n : op === '<=' ? x <= n : x >= n;
    return (v) => {
      if (typeof v === 'number') return test(v);
      if (typeof v === 'string' && (op === '=' || op === '<>')) {
        const p = parseNumber(v);
        return p !== undefined ? test(p) : op === '<>';
      }
      return op === '<>';
    };
  }
  const upper = rest.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') {
    const b = upper === 'TRUE';
    return (v) => (op === '<>' ? v !== b : op === '=' ? v === b : false);
  }
  if (/^#/.test(rest)) {
    const code = upper;
    return (v) => (op === '<>' ? !(isError(v) && v.code === code) : op === '=' && isError(v) && v.code === code);
  }
  if (op === '=' || op === '<>') {
    const re = wildcard(rest);
    return op === '=' ? (v) => typeof v === 'string' && re.test(v) : (v) => !(typeof v === 'string' && re.test(v));
  }
  const lower = rest.toLowerCase();
  return (v) => {
    if (typeof v !== 'string') return false;
    const s = v.toLowerCase();
    return op === '<' ? s < lower : op === '>' ? s > lower : op === '<=' ? s <= lower : s >= lower;
  };
}

/** Excel's ROUND: half away from zero, on the decimal the person sees rather than the binary one. */
export function roundHalfAway(n: number, digits: number): number {
  if (!Number.isFinite(n) || n === 0) return n;
  const f = Math.pow(10, digits);
  const x = parseFloat((Math.abs(n) * f).toPrecision(15));
  return (Math.sign(n) * Math.round(x)) / f;
}

export function roundToward(n: number, digits: number, up: boolean): number {
  const f = Math.pow(10, digits);
  const x = parseFloat((Math.abs(n) * f).toPrecision(15));
  return (Math.sign(n) * (up ? Math.ceil(x) : Math.floor(x))) / f;
}

/** Reads one or several scalar arguments as numbers, stopping at the first error. */
export function nums(ctx: Ctx, ...vs: (Value | undefined)[]): number[] | CellError {
  const out: number[] = [];
  for (const v of vs) {
    const n = ctx.num(v);
    if (isError(n)) return n;
    out.push(n);
  }
  return out;
}
