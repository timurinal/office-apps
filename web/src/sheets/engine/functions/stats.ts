import type { Ctx, Value } from '../evaluate';
import { UnionValue } from '../evaluate';
import { RangeValue } from '../sheet';
import { type CellError, ERR, type Scalar, isError } from '../values';
import {
  type Args,
  type Collect,
  type FnDef,
  type FnTable,
  type Grid,
  criterion,
  finite,
  flat,
  grid,
  gridAt,
  gridDims,
  numbers,
  sum,
  sumAndCount
} from './helpers';

const ANY = Infinity;

function mean(xs: number[]): number {
  return sum(xs) / xs.length;
}

function devsq(xs: number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s;
}

function variance(xs: number[], sample: boolean): number | CellError {
  const n = xs.length;
  if (n === 0 || (sample && n < 2)) return ERR.div0;
  return devsq(xs) / (sample ? n - 1 : n);
}

/** Variadic over numbers with Excel's aggregate rules. */
function agg(f: (xs: number[]) => number | CellError, opts: Collect = {}): FnDef {
  return {
    min: 1,
    max: ANY,
    kinds: 'a',
    fn: (args, ctx) => {
      const xs = numbers(args, ctx, opts);
      if (isError(xs)) return xs;
      const r = f(xs);
      return isError(r) ? r : finite(r);
    }
  };
}

const sorted = (xs: number[]) => Float64Array.from(xs).sort();

function median(xs: number[]): number | CellError {
  if (!xs.length) return ERR.num;
  const s = sorted(xs);
  const h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
}

function mode(xs: number[]): number | CellError {
  const counts = new Map<number, number>();
  let top = 1;
  for (const x of xs) {
    const k = (counts.get(x) ?? 0) + 1;
    counts.set(x, k);
    if (k > top) top = k;
  }
  if (top < 2) return ERR.na;
  // Among values tied for most frequent, the one that appears first.
  for (const x of xs) if (counts.get(x) === top) return x;
  return ERR.na;
}

function percentileInc(xs: number[], k: number): number | CellError {
  if (!xs.length || k < 0 || k > 1) return ERR.num;
  const s = sorted(xs);
  const pos = k * (s.length - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return frac === 0 ? s[lo]! : s[lo]! + frac * (s[lo + 1]! - s[lo]!);
}

function percentileExc(xs: number[], k: number): number | CellError {
  const n = xs.length;
  if (!n || k <= 0 || k >= 1) return ERR.num;
  const pos = k * (n + 1) - 1;
  if (pos < 0 || pos > n - 1) return ERR.num;
  const s = sorted(xs);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return frac === 0 ? s[lo]! : s[lo]! + frac * (s[lo + 1]! - s[lo]!);
}

/** A numeric statistic of an array and one number, such as LARGE(array, k). */
function withK(f: (xs: number[], k: number) => number | CellError): FnDef {
  return {
    min: 2,
    max: 2,
    kinds: 'as',
    fn: ([a, b], ctx) => {
      const xs = numbers([a], ctx);
      if (isError(xs)) return xs;
      const k = ctx.num(b);
      if (isError(k)) return k;
      const r = f(xs, k);
      return isError(r) ? r : finite(r);
    }
  };
}

function nth(xs: number[], k: number, largest: boolean): number | CellError {
  const i = Math.ceil(k);
  if (i < 1 || i > xs.length) return ERR.num;
  const s = sorted(xs);
  return largest ? s[s.length - i]! : s[i - 1]!;
}

function rank(avg: boolean): FnDef {
  return {
    min: 2,
    max: 3,
    kinds: 'sas',
    fn: ([n, ref, order], ctx) => {
      const x = ctx.num(n);
      if (isError(x)) return x;
      const asc = ctx.num(order, 0);
      if (isError(asc)) return asc;
      const xs = numbers([ref], ctx);
      if (isError(xs)) return xs;
      let before = 0;
      let ties = 0;
      for (const y of xs) {
        if (y === x) ties++;
        else if (asc ? y < x : y > x) before++;
      }
      if (!ties) return ERR.na;
      return avg ? before + (ties + 1) / 2 : before + 1;
    }
  };
}

/** The positions where both arrays hold a number, for CORREL, SLOPE and the rest. */
function pairs(a: Value | undefined, b: Value | undefined): [number[], number[]] | CellError {
  const ys = flat(a);
  const xs = flat(b);
  if (ys.length !== xs.length) return ERR.na;
  const outY: number[] = [];
  const outX: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i]!;
    const x = xs[i]!;
    if (isError(y)) return y;
    if (isError(x)) return x;
    if (typeof y === 'number' && typeof x === 'number') {
      outY.push(y);
      outX.push(x);
    }
  }
  return [outY, outX];
}

interface Fit {
  slope: number;
  intercept: number;
  r: number;
  covariance: number;
  n: number;
}

function fit(ys: number[], xs: number[]): Fit | CellError {
  const n = ys.length;
  if (n === 0) return ERR.div0;
  const my = mean(ys);
  const mx = mean(xs);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy), covariance: sxy, n };
}

function paired(f: (fit: Fit) => number | CellError, minN = 1): FnDef {
  return {
    min: 2,
    max: 2,
    kinds: 'aa',
    fn: ([a, b]) => {
      const p = pairs(a, b);
      if (isError(p)) return p;
      if (p[0].length < minN) return ERR.div0;
      const ft = fit(p[0], p[1]);
      if (isError(ft)) return ft;
      const r = f(ft);
      return isError(r) ? r : Number.isFinite(r) ? r : ERR.div0;
    }
  };
}

// ---------------------------------------------------------------- the IFS family

interface Test {
  range: Grid;
  test: (v: Scalar) => boolean;
}

/** Reads (range, criterion) pairs from `args` starting at `from`. All ranges must match the first's shape. */
function tests(args: Args, from: number, ctx: Ctx): Test[] | CellError {
  const out: Test[] = [];
  for (let i = from; i < args.length; i += 2) {
    const g = grid(args[i]);
    if (isError(g)) return g;
    out.push({ range: g, test: criterion(ctx.scalar(args[i + 1] ?? null), ctx) });
  }
  if (!out.length) return ERR.na;
  const [rows, cols] = gridDims(out[0]!.range);
  for (const t of out) {
    const [r, c] = gridDims(t.range);
    if (r !== rows || c !== cols) return ERR.value;
  }
  return out;
}

/** Visits each position where every test passes. */
function matches(ts: Test[], visit: (r: number, c: number) => void): void {
  const [rows, cols] = gridDims(ts[0]!.range);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let ok = true;
      for (const t of ts) {
        if (!t.test(gridAt(t.range, r, c))) {
          ok = false;
          break;
        }
      }
      if (ok) visit(r, c);
    }
  }
}

/** SUMIF's sum_range takes the criteria range's shape from its own top-left cell, as Excel does. */
function resized(g: Grid, like: Grid): Grid {
  if (!(g instanceof RangeValue)) return g;
  const [rows, cols] = gridDims(like);
  const s = g.sheet;
  const r2 = Math.min(g.r1 + rows - 1, s.rowOrder.length - 1);
  const c2 = Math.min(g.c1 + cols - 1, s.colOrder.length - 1);
  return new RangeValue(s, g.r1, r2, g.c1, c2);
}

type Fold = 'sum' | 'avg' | 'max' | 'min';

function foldAt(target: Grid, ts: Test[], fold: Fold): Scalar {
  let acc = fold === 'max' ? -Infinity : fold === 'min' ? Infinity : 0;
  let n = 0;
  let err: CellError | undefined;
  matches(ts, (r, c) => {
    if (err) return;
    const v = gridAt(target, r, c);
    if (isError(v)) err = v;
    else if (typeof v === 'number') {
      n++;
      acc = fold === 'max' ? Math.max(acc, v) : fold === 'min' ? Math.min(acc, v) : acc + v;
    }
  });
  if (err) return err;
  if (fold === 'avg') return n ? acc / n : ERR.div0;
  if (fold === 'max' || fold === 'min') return n ? acc : 0;
  return acc;
}

function ifOne(fold: Fold): FnDef {
  return {
    min: 2,
    max: 3,
    kinds: 'asa',
    fn: (args, ctx) => {
      // One (range, criterion) pair; the third argument is what to fold, not another pair.
      const ts = tests(args.slice(0, 2), 0, ctx);
      if (isError(ts)) return ts;
      let target: Grid = ts[0]!.range;
      if (args[2] !== undefined && args[2] !== null) {
        const g = grid(args[2]);
        if (isError(g)) return g;
        target = resized(g, target);
      }
      return foldAt(target, ts, fold);
    }
  };
}

function ifMany(fold: Fold): FnDef {
  return {
    min: 3,
    max: ANY,
    kinds: 'aas',
    repeat: 2,
    fn: (args, ctx) => {
      const target = grid(args[0]);
      if (isError(target)) return target;
      const ts = tests(args, 1, ctx);
      if (isError(ts)) return ts;
      const [a, b] = gridDims(target);
      const [c, d] = gridDims(ts[0]!.range);
      if (a !== c || b !== d) return ERR.value;
      return foldAt(target, ts, fold);
    }
  };
}

function count(args: Args, ctx: Ctx, skipSubtotals = false): number {
  let k = 0;
  const visit = (r: RangeValue) => r.eachCell((c) => typeof c.value === 'number' && !(skipSubtotals && c.subtotal) && k++);
  for (const v of args) {
    if (v instanceof RangeValue) visit(v);
    else if (v instanceof UnionValue) v.ranges.forEach(visit);
    else if (Array.isArray(v)) for (const row of v) for (const x of row) typeof x === 'number' && k++;
    else if (v !== undefined && v !== null && !isError(v) && !isError(ctx.toNumber(v))) k++;
  }
  return k;
}

function counta(args: Args, skipSubtotals = false): number {
  let k = 0;
  const visit = (r: RangeValue) => r.eachCell((c) => c.value !== null && !(skipSubtotals && c.subtotal) && k++);
  for (const v of args) {
    if (v instanceof RangeValue) visit(v);
    else if (v instanceof UnionValue) v.ranges.forEach(visit);
    else if (Array.isArray(v)) for (const row of v) for (const x of row) x !== null && k++;
    else if (v !== undefined) k++;
  }
  return k;
}

const SUBTOTALS: Record<number, (xs: number[]) => number | CellError> = {
  1: (xs) => (xs.length ? mean(xs) : ERR.div0),
  4: (xs) => (xs.length ? Math.max(...xs) : 0),
  5: (xs) => (xs.length ? Math.min(...xs) : 0),
  6: (xs) => xs.reduce((a, b) => a * b, xs.length ? 1 : 0),
  7: (xs) => {
    const v = variance(xs, true);
    return isError(v) ? v : Math.sqrt(v);
  },
  8: (xs) => {
    const v = variance(xs, false);
    return isError(v) ? v : Math.sqrt(v);
  },
  9: sum,
  10: (xs) => variance(xs, true),
  11: (xs) => variance(xs, false)
};

function maxOf(xs: number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return xs.length ? m : 0;
}

function minOf(xs: number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return xs.length ? m : 0;
}

const stdev = (sample: boolean) => (xs: number[]) => {
  const v = variance(xs, sample);
  return isError(v) ? v : Math.sqrt(v);
};

export const STATS: FnTable = {
  AVERAGE: {
    min: 1,
    max: ANY,
    kinds: 'a',
    fn: (args, ctx) => {
      const r = sumAndCount(args, ctx);
      if (isError(r)) return r;
      return r.count ? finite(r.sum / r.count) : ERR.div0;
    }
  },
  AVERAGEA: agg((xs) => (xs.length ? mean(xs) : ERR.div0), { a: true }),
  COUNT: { min: 1, max: ANY, kinds: 'a', fn: (args, ctx) => count(args, ctx) },
  COUNTA: { min: 1, max: ANY, kinds: 'a', fn: (args) => counta(args) },
  COUNTBLANK: {
    min: 1,
    max: 1,
    kinds: 'a',
    fn: ([v]) => {
      if (v instanceof RangeValue) {
        let filled = 0;
        v.eachCell((c) => c.value !== null && c.value !== '' && filled++);
        return v.rows * v.cols - filled;
      }
      if (Array.isArray(v)) return flat(v).filter((x) => x === null || x === '').length;
      return isError(v) ? v : ERR.value;
    }
  },
  COUNTIF: {
    min: 2,
    max: 2,
    kinds: 'as',
    fn: (args, ctx) => {
      const ts = tests(args, 0, ctx);
      if (isError(ts)) return ts;
      let k = 0;
      matches(ts, () => k++);
      return k;
    }
  },
  COUNTIFS: {
    min: 2,
    max: ANY,
    kinds: 'as',
    repeat: 2,
    fn: (args, ctx) => {
      const ts = tests(args, 0, ctx);
      if (isError(ts)) return ts;
      let k = 0;
      matches(ts, () => k++);
      return k;
    }
  },
  SUMIF: ifOne('sum'),
  AVERAGEIF: ifOne('avg'),
  SUMIFS: ifMany('sum'),
  AVERAGEIFS: ifMany('avg'),
  MAXIFS: ifMany('max'),
  MINIFS: ifMany('min'),
  MIN: agg(minOf),
  MAX: agg(maxOf),
  MINA: agg(minOf, { a: true }),
  MAXA: agg(maxOf, { a: true }),
  MEDIAN: agg(median),
  MODE: agg(mode, { ordered: true }),
  'MODE.SNGL': agg(mode, { ordered: true }),
  STDEV: agg(stdev(true)),
  'STDEV.S': agg(stdev(true)),
  STDEVP: agg(stdev(false)),
  'STDEV.P': agg(stdev(false)),
  STDEVA: agg(stdev(true), { a: true }),
  STDEVPA: agg(stdev(false), { a: true }),
  VAR: agg((xs) => variance(xs, true)),
  'VAR.S': agg((xs) => variance(xs, true)),
  VARP: agg((xs) => variance(xs, false)),
  'VAR.P': agg((xs) => variance(xs, false)),
  VARA: agg((xs) => variance(xs, true), { a: true }),
  VARPA: agg((xs) => variance(xs, false), { a: true }),
  AVEDEV: agg((xs) => {
    if (!xs.length) return ERR.num;
    const m = mean(xs);
    return mean(xs.map((x) => Math.abs(x - m)));
  }),
  DEVSQ: agg((xs) => (xs.length ? devsq(xs) : 0)),
  GEOMEAN: agg((xs) => (!xs.length || xs.some((x) => x <= 0) ? ERR.num : Math.exp(mean(xs.map(Math.log))))),
  HARMEAN: agg((xs) => (!xs.length || xs.some((x) => x <= 0) ? ERR.num : xs.length / sum(xs.map((x) => 1 / x)))),
  LARGE: withK((xs, k) => nth(xs, k, true)),
  SMALL: withK((xs, k) => nth(xs, k, false)),
  PERCENTILE: withK(percentileInc),
  'PERCENTILE.INC': withK(percentileInc),
  'PERCENTILE.EXC': withK(percentileExc),
  QUARTILE: withK((xs, q) => (Math.trunc(q) < 0 || Math.trunc(q) > 4 ? ERR.num : percentileInc(xs, Math.trunc(q) / 4))),
  'QUARTILE.INC': withK((xs, q) => (Math.trunc(q) < 0 || Math.trunc(q) > 4 ? ERR.num : percentileInc(xs, Math.trunc(q) / 4))),
  'QUARTILE.EXC': withK((xs, q) => (Math.trunc(q) < 1 || Math.trunc(q) > 3 ? ERR.num : percentileExc(xs, Math.trunc(q) / 4))),
  RANK: rank(false),
  'RANK.EQ': rank(false),
  'RANK.AVG': rank(true),
  CORREL: paired((f) => f.r, 2),
  PEARSON: paired((f) => f.r, 2),
  RSQ: paired((f) => f.r * f.r, 2),
  SLOPE: paired((f) => f.slope, 2),
  INTERCEPT: paired((f) => f.intercept, 2),
  COVAR: paired((f) => f.covariance / f.n),
  'COVARIANCE.P': paired((f) => f.covariance / f.n),
  'COVARIANCE.S': paired((f) => (f.n < 2 ? ERR.div0 : f.covariance / (f.n - 1))),
  FORECAST: forecast(),
  'FORECAST.LINEAR': forecast(),
  SUBTOTAL: {
    min: 2,
    max: ANY,
    kinds: 'sa',
    fn: ([k, ...refs], ctx) => {
      const n = ctx.num(k);
      if (isError(n)) return n;
      // 101 to 111 also skip hidden rows; nothing is hidden from the engine, so they are 1 to 11.
      const code = Math.trunc(n) % 100;
      if (code === 2) return count(refs, ctx, true);
      if (code === 3) return counta(refs, true);
      const f = SUBTOTALS[code];
      if (!f || Math.trunc(n) > 111) return ERR.value;
      const xs = numbers(refs, ctx, { skipSubtotals: true });
      if (isError(xs)) return xs;
      const r = f(xs);
      return isError(r) ? r : finite(r);
    }
  }
};

function forecast(): FnDef {
  return {
    min: 3,
    max: 3,
    kinds: 'saa',
    fn: ([x, ys, xs], ctx) => {
      const at = ctx.num(x);
      if (isError(at)) return at;
      const p = pairs(ys, xs);
      if (isError(p)) return p;
      if (p[0].length < 2) return ERR.div0;
      const f = fit(p[0], p[1]);
      if (isError(f)) return f;
      const r = f.intercept + f.slope * at;
      return Number.isFinite(r) ? r : ERR.div0;
    }
  };
}
