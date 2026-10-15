/**
 * Lookups. Exact matches into a range go through an index built once per
 * recalculation pass and shared by every formula that searches the same range
 * the same way: 10,000 VLOOKUPs into one table cost one scan of it, not 10,000.
 * Within a pass a range cannot change under a lookup, because the cells in it are
 * calculated before anything that reads it.
 */

import { type Ctx, type Value, UnionValue } from '../evaluate';
import { RangeValue } from '../sheet';
import { type CellError, ERR, type Scalar, compare, isError, round15 } from '../values';
import {
  type FnDef,
  type FnTable,
  type Grid,
  type Line,
  given,
  grid,
  gridAt,
  gridDims,
  hasWildcard,
  line,
  vector,
  wildcard
} from './helpers';

/** Equal keys for values an exact match treats as equal: text ignores case, numbers compare at 15 digits. */
function keyOf(v: Scalar): string | null {
  if (typeof v === 'string') return 's' + v.toLowerCase();
  if (typeof v === 'number') return 'n' + round15(v);
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  return null;
}

function buildIndex(ln: Line, last: boolean): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < ln.length; i++) {
    const k = keyOf(ln.get(i));
    if (k !== null && (last || !index.has(k))) index.set(k, i);
  }
  return index;
}

/** The position of an exact match along row or column `k` of a grid, or -1. */
function exact(ctx: Ctx, g: Grid, horizontal: boolean, k: number, needle: Scalar, wild: boolean, last: boolean): number {
  const ln = line(g, horizontal, k);
  if (wild && typeof needle === 'string' && hasWildcard(needle)) {
    const re = wildcard(needle);
    for (let n = 0; n < ln.length; n++) {
      const i = last ? ln.length - 1 - n : n;
      const v = ln.get(i);
      if (typeof v === 'string' && re.test(v)) return i;
    }
    return -1;
  }
  const key = keyOf(needle);
  if (key === null) return -1;
  if (g instanceof RangeValue) {
    const id = `${g.sheet.id}|${g.r1}|${g.r2}|${g.c1}|${g.c2}|${horizontal ? 'h' : 'v'}${k}|${last ? 'last' : 'first'}`;
    return ctx.book.lookupIndex(id, () => buildIndex(ln, last)).get(key) ?? -1;
  }
  for (let n = 0; n < ln.length; n++) {
    const i = last ? ln.length - 1 - n : n;
    if (keyOf(ln.get(i)) === key) return i;
  }
  return -1;
}

const sameType = (v: Scalar, needle: Scalar) => v !== null && !isError(v) && typeof v === typeof needle;

/**
 * Excel's approximate match: a binary search for the last value at most the needle
 * (at least it, when descending), looking only at values of the needle's type.
 * On unsorted data it answers what Excel answers, rather than an error.
 */
function approx(ln: Line, needle: Scalar, descending: boolean): number {
  if (needle === null || isError(needle)) return -1;
  let lo = 0;
  let hi = ln.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let j = mid;
    while (j >= lo && !sameType(ln.get(j), needle)) j--;
    if (j < lo) {
      lo = mid + 1;
      continue;
    }
    const c = compare(ln.get(j), needle);
    if (descending ? c >= 0 : c <= 0) {
      found = j;
      lo = mid + 1;
    } else hi = j - 1;
  }
  return found;
}

/** XLOOKUP's -1 and 1: the exact value, else the nearest smaller or larger one, on unsorted data. */
function nearest(ln: Line, needle: Scalar, larger: boolean, last: boolean): number {
  let best = -1;
  let bestV: Scalar = null;
  for (let n = 0; n < ln.length; n++) {
    const i = last ? ln.length - 1 - n : n;
    const v = ln.get(i);
    if (!sameType(v, needle)) continue;
    const c = compare(v, needle);
    if (c === 0) return i;
    const better = best < 0 || (larger ? compare(v, bestV) < 0 : compare(v, bestV) > 0);
    if ((larger ? c > 0 : c < 0) && better) {
      best = i;
      bestV = v;
    }
  }
  return best;
}

function hvlookup(horizontal: boolean): FnDef {
  return {
    min: 3,
    max: 4,
    kinds: 'sass',
    fn: ([n, t, i, a], ctx) => {
      const needle = ctx.scalar(n);
      if (isError(needle)) return needle;
      const table = grid(t);
      if (isError(table)) return table;
      const idx = ctx.num(i);
      if (isError(idx)) return idx;
      const k = Math.trunc(idx) - 1;
      const [rows, cols] = gridDims(table);
      if (k < 0) return ERR.value;
      if (k >= (horizontal ? rows : cols)) return ERR.ref;
      const sorted = ctx.bool(a, true);
      if (isError(sorted)) return sorted;
      const pos = sorted ? approx(line(table, horizontal, 0), needle, false) : exact(ctx, table, horizontal, 0, needle, true, false);
      if (pos < 0) return ERR.na;
      return horizontal ? gridAt(table, k, pos) : gridAt(table, pos, k);
    }
  };
}

/** XLOOKUP's and XMATCH's search: match_mode 0, -1, 1 or 2 (wildcards), search_mode 1 or -1 (2 and -2 search linearly). */
function xfind(
  ctx: Ctx,
  g: Grid,
  horizontal: boolean,
  needle: Scalar,
  modeV: Value | undefined,
  searchV: Value | undefined
): number | CellError {
  const mode = given(modeV) ? ctx.num(modeV) : 0;
  if (isError(mode)) return mode;
  const search = given(searchV) ? ctx.num(searchV) : 1;
  if (isError(search)) return search;
  if (![-1, 0, 1, 2].includes(mode) || ![-2, -1, 1, 2].includes(search)) return ERR.value;
  const last = search === -1;
  if (mode === 0 || mode === 2) return exact(ctx, g, horizontal, 0, needle, mode === 2, last);
  return nearest(line(g, horizontal, 0), needle, mode === 1, last);
}

function indexOf(v: Value | undefined, r: Value | undefined, c: Value | undefined, area: Value | undefined, ctx: Ctx): Value {
  let target = v;
  if (v instanceof UnionValue) {
    const k = ctx.num(area, 1);
    if (isError(k)) return k;
    target = v.ranges[Math.trunc(k) - 1];
    if (!target) return ERR.ref;
  }
  const g = grid(target);
  if (isError(g)) return g;
  const [rows, cols] = gridDims(g);
  let ri = ctx.num(r, 0);
  if (isError(ri)) return ri;
  let ci = ctx.num(c, 0);
  if (isError(ci)) return ci;
  ri = Math.trunc(ri);
  ci = Math.trunc(ci);
  // INDEX(A1:E1, 3) is C1: with one row and no column given, the number is the column.
  if (c === undefined && rows === 1) {
    ci = ri;
    ri = 0;
  }
  if (ri < 0 || ci < 0 || ri > rows || ci > cols) return ERR.ref;
  if (g instanceof RangeValue) {
    const [r1, r2] = ri ? [g.r1 + ri - 1, g.r1 + ri - 1] : [g.r1, g.r2];
    const [c1, c2] = ci ? [g.c1 + ci - 1, g.c1 + ci - 1] : [g.c1, g.c2];
    return new RangeValue(g.sheet, r1, r2, c1, c2);
  }
  if (ri && ci) return g[ri - 1]![ci - 1] ?? null;
  if (ri) return [g[ri - 1]!];
  if (ci) return g.map((row) => [row[ci - 1] ?? null]);
  return g;
}

function position(rows: boolean): FnDef {
  return {
    min: 0,
    max: 1,
    positional: true,
    lazy: (args, ctx) => {
      const arg = args[0];
      if (!arg || arg.t === 'missing') {
        const h = ctx.host;
        const i = rows ? h.sheet.rowIndex().get(h.row) : h.sheet.colIndex().get(h.col);
        return i === undefined ? ERR.ref : i + 1;
      }
      const v = ctx.evalArray(arg);
      if (isError(v)) return v;
      if (!(v instanceof RangeValue)) return ERR.value;
      const n = rows ? v.rows : v.cols;
      const first = (rows ? v.r1 : v.c1) + 1;
      // ROW(A1:A9) is {1;...;9} where an array is wanted, as in SUMPRODUCT((ROW(A1:A9)>5)*B1:B9).
      if (ctx.array && n > 1) {
        const seq = Array.from({ length: n }, (_, i) => first + i);
        return rows ? seq.map((x) => [x]) : [seq];
      }
      return first;
    }
  };
}

export const LOOKUP: FnTable = {
  VLOOKUP: hvlookup(false),
  HLOOKUP: hvlookup(true),
  MATCH: {
    min: 2,
    max: 3,
    kinds: 'sas',
    fn: ([n, a, t], ctx) => {
      const needle = ctx.scalar(n);
      if (isError(needle)) return needle;
      const g = grid(a);
      if (isError(g)) return g;
      const vec = vector(g);
      if (!vec) return ERR.na;
      const type = ctx.num(t, 1);
      if (isError(type)) return type;
      const pos = type === 0 ? exact(ctx, g, vec.horizontal, 0, needle, true, false) : approx(vec.line, needle, type < 0);
      return pos < 0 ? ERR.na : pos + 1;
    }
  },
  XMATCH: {
    min: 2,
    max: 4,
    kinds: 'sass',
    fn: ([n, a, m, s], ctx) => {
      const needle = ctx.scalar(n);
      if (isError(needle)) return needle;
      const g = grid(a);
      if (isError(g)) return g;
      const vec = vector(g);
      if (!vec) return ERR.value;
      const pos = xfind(ctx, g, vec.horizontal, needle, m, s);
      if (isError(pos)) return pos;
      return pos < 0 ? ERR.na : pos + 1;
    }
  },
  XLOOKUP: {
    min: 3,
    max: 6,
    kinds: 'saaass',
    fn: ([n, l, r, nf, m, s], ctx) => {
      const needle = ctx.scalar(n);
      if (isError(needle)) return needle;
      const lg = grid(l);
      if (isError(lg)) return lg;
      const vec = vector(lg);
      if (!vec) return ERR.value;
      const rg = grid(r);
      if (isError(rg)) return rg;
      const [rr, rc] = gridDims(rg);
      if ((vec.horizontal ? rc : rr) !== vec.line.length) return ERR.value;
      const pos = xfind(ctx, lg, vec.horizontal, needle, m, s);
      if (isError(pos)) return pos;
      if (pos < 0) return given(nf) ? nf! : ERR.na;
      // The matching row (or column) of the return array. With no spill, a cell shows its first value.
      if (rg instanceof RangeValue) {
        const sub = vec.horizontal
          ? new RangeValue(rg.sheet, rg.r1, ctx.array ? rg.r2 : rg.r1, rg.c1 + pos, rg.c1 + pos)
          : new RangeValue(rg.sheet, rg.r1 + pos, rg.r1 + pos, rg.c1, ctx.array ? rg.c2 : rg.c1);
        return sub;
      }
      if (vec.horizontal) return ctx.array ? rg.map((row) => [row[pos] ?? null]) : (rg[0]?.[pos] ?? null);
      return ctx.array ? [rg[pos]!] : (rg[pos]?.[0] ?? null);
    }
  },
  LOOKUP: {
    min: 2,
    max: 3,
    kinds: 'saa',
    fn: ([n, v, r], ctx) => {
      const needle = ctx.scalar(n);
      if (isError(needle)) return needle;
      const g = grid(v);
      if (isError(g)) return g;
      const [rows, cols] = gridDims(g);
      if (r !== undefined) {
        const vec = vector(g);
        const rg = grid(r);
        if (isError(rg)) return rg;
        const res = vector(rg);
        if (!vec || !res) return ERR.na;
        const pos = approx(vec.line, needle, false);
        return pos < 0 || pos >= res.line.length ? ERR.na : res.line.get(pos);
      }
      // The array form searches the first row of a wide array and the first column of a tall one.
      const horizontal = cols > rows;
      const pos = approx(line(g, horizontal, 0), needle, false);
      if (pos < 0) return ERR.na;
      return horizontal ? gridAt(g, rows - 1, pos) : gridAt(g, pos, cols - 1);
    }
  },
  INDEX: { min: 1, max: 4, kinds: 'asss', fn: ([v, r, c, area], ctx) => indexOf(v, r, c, area, ctx) },
  ROW: position(true),
  COLUMN: position(false),
  ROWS: {
    min: 1,
    max: 1,
    kinds: 'a',
    fn: ([v]) => {
      const g = grid(v);
      return isError(g) ? g : gridDims(g)[0];
    }
  },
  COLUMNS: {
    min: 1,
    max: 1,
    kinds: 'a',
    fn: ([v]) => {
      const g = grid(v);
      return isError(g) ? g : gridDims(g)[1];
    }
  }
};
