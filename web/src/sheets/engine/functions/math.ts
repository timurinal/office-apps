import type { Value } from '../evaluate';
import { type CellError, ERR, isError, round15 } from '../values';
import {
  type Args,
  type FnDef,
  type FnTable,
  finite,
  grid,
  gridAt,
  gridDims,
  numbers,
  nums,
  roundHalfAway,
  roundToward,
  sum,
  sumAndCount
} from './helpers';

const ANY = Infinity;

/** A one-number function. */
function m1(f: (x: number) => number | CellError): FnDef {
  return {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const x = ctx.num(v);
      if (isError(x)) return x;
      const y = f(x);
      return isError(y) ? y : finite(y);
    }
  };
}

/** A two-number function; `dflt` is the second when omitted. */
function m2(f: (x: number, y: number) => number | CellError, dflt?: number): FnDef {
  return {
    min: dflt === undefined ? 2 : 1,
    max: 2,
    fn: ([a, b], ctx) => {
      const x = ctx.num(a);
      if (isError(x)) return x;
      const y = ctx.num(b, dflt);
      if (isError(y)) return y;
      const r = f(x, y);
      return isError(r) ? r : finite(r);
    }
  };
}

function m3(f: (x: number, y: number, z: number) => number | CellError, d2: number, d3: number): FnDef {
  return {
    min: 1,
    max: 3,
    fn: ([a, b, c], ctx) => {
      const n = nums(ctx, a, b ?? d2, c ?? d3);
      if (isError(n)) return n;
      const r = f(n[0]!, n[1]!, n[2]!);
      return isError(r) ? r : finite(r);
    }
  };
}

/** Variadic over numbers, ranges included, with Excel's aggregate rules. */
function agg(f: (xs: number[]) => number | CellError, min = 1): FnDef {
  return {
    min,
    max: ANY,
    kinds: 'a',
    fn: (args, ctx) => {
      const xs = numbers(args, ctx);
      if (isError(xs)) return xs;
      const r = f(xs);
      return isError(r) ? r : finite(r);
    }
  };
}

function gcd2(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function combin(n: number, k: number): number {
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function fact(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** The quotient a CEILING or FLOOR rounds, at 15 digits so 1.1/0.1 is 11 and not 11.000000000000002. */
const ratio = (n: number, s: number) => round15(n / s);

function sumProduct(args: Args): Value {
  const grids = [];
  for (const a of args) {
    const g = grid(a);
    if (isError(g)) return g;
    grids.push(g);
  }
  const [rows, cols] = gridDims(grids[0]!);
  for (const g of grids) {
    const [r, c] = gridDims(g);
    if (r !== rows || c !== cols) return ERR.value;
  }
  let s = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let p = 1;
      for (const g of grids) {
        const v = gridAt(g, i, j);
        if (isError(v)) return v;
        p *= typeof v === 'number' ? v : 0;
      }
      s += p;
    }
  }
  return finite(s);
}

export const MATH: FnTable = {
  SUM: {
    min: 1,
    max: ANY,
    kinds: 'a',
    fn: (args, ctx) => {
      const r = sumAndCount(args, ctx);
      return isError(r) ? r : finite(r.sum);
    }
  },
  PRODUCT: agg((xs) => xs.reduce((a, b) => a * b, xs.length ? 1 : 0)),
  SUMSQ: agg((xs) => sum(xs.map((x) => x * x))),
  SUMPRODUCT: { min: 1, max: ANY, kinds: 'a', fn: (args) => sumProduct(args) },
  ABS: m1(Math.abs),
  INT: m1(Math.floor),
  TRUNC: m2((x, d) => roundToward(x, Math.trunc(d), false), 0),
  SIGN: m1(Math.sign),
  SQRT: m1((x) => (x < 0 ? ERR.num : Math.sqrt(x))),
  SQRTPI: m1((x) => (x < 0 ? ERR.num : Math.sqrt(x * Math.PI))),
  EXP: m1(Math.exp),
  LN: m1((x) => (x <= 0 ? ERR.num : Math.log(x))),
  LOG10: m1((x) => (x <= 0 ? ERR.num : Math.log10(x))),
  LOG: m2((x, b) => (x <= 0 || b <= 0 ? ERR.num : b === 1 ? ERR.div0 : Math.log(x) / Math.log(b)), 10),
  POWER: m2((x, y) => (x === 0 && y === 0 ? ERR.num : x === 0 && y < 0 ? ERR.div0 : Math.pow(x, y))),
  MOD: m2((x, y) => (y === 0 ? ERR.div0 : round15(x - y * Math.floor(x / y)))),
  QUOTIENT: m2((x, y) => (y === 0 ? ERR.div0 : Math.trunc(x / y))),
  ROUND: m2((x, d) => roundHalfAway(x, Math.trunc(d))),
  ROUNDUP: m2((x, d) => roundToward(x, Math.trunc(d), true)),
  ROUNDDOWN: m2((x, d) => roundToward(x, Math.trunc(d), false)),
  MROUND: m2((x, m) => (m === 0 ? 0 : Math.sign(x) * Math.sign(m) < 0 ? ERR.num : round15(roundHalfAway(x / m, 0) * m))),
  CEILING: m2((x, s) => (s === 0 ? 0 : x > 0 && s < 0 ? ERR.num : round15(Math.ceil(ratio(x, s)) * s))),
  FLOOR: m2((x, s) => (s === 0 ? (x === 0 ? 0 : ERR.div0) : x > 0 && s < 0 ? ERR.num : round15(Math.floor(ratio(x, s)) * s))),
  'CEILING.MATH': m3((x, s, mode) => {
    s = Math.abs(s);
    if (s === 0) return 0;
    if (x >= 0) return round15(Math.ceil(ratio(x, s)) * s);
    return round15(-(mode ? Math.ceil(ratio(-x, s)) : Math.floor(ratio(-x, s))) * s);
  }, 1, 0),
  'FLOOR.MATH': m3((x, s, mode) => {
    s = Math.abs(s);
    if (s === 0) return 0;
    if (x >= 0) return round15(Math.floor(ratio(x, s)) * s);
    return round15(-(mode ? Math.floor(ratio(-x, s)) : Math.ceil(ratio(-x, s))) * s);
  }, 1, 0),
  EVEN: m1((x) => Math.sign(x) * Math.ceil(Math.abs(x) / 2) * 2),
  ODD: m1((x) => {
    const v = Math.ceil(Math.abs(x));
    return (x < 0 ? -1 : 1) * (v % 2 === 0 ? v + 1 : v);
  }),
  PI: { min: 0, max: 0, fn: () => Math.PI },
  RAND: { min: 0, max: 0, volatile: true, fn: (_a, ctx) => ctx.book.random() },
  RANDBETWEEN: {
    min: 2,
    max: 2,
    volatile: true,
    fn: ([a, b], ctx) => {
      const n = nums(ctx, a, b);
      if (isError(n)) return n;
      const lo = Math.ceil(n[0]!);
      const hi = Math.floor(n[1]!);
      return lo > hi ? ERR.num : lo + Math.floor(ctx.book.random() * (hi - lo + 1));
    }
  },
  GCD: agg((xs) => (xs.some((x) => x < 0) ? ERR.num : xs.map(Math.trunc).reduce(gcd2, 0))),
  LCM: agg((xs) => {
    if (xs.some((x) => x < 0)) return ERR.num;
    let r = 1;
    for (const x of xs.map(Math.trunc)) {
      if (x === 0) return 0;
      r = (r * x) / gcd2(r, x);
    }
    return r;
  }),
  FACT: m1((x) => (x < 0 ? ERR.num : fact(Math.trunc(x)))),
  COMBIN: m2((n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    return n < 0 || k < 0 || n < k ? ERR.num : combin(n, k);
  }),
  PERMUT: m2((n, k) => {
    n = Math.trunc(n);
    k = Math.trunc(k);
    if (n < 0 || k < 0 || n < k) return ERR.num;
    let r = 1;
    for (let i = 0; i < k; i++) r *= n - i;
    return r;
  }),
  SIN: m1(Math.sin),
  COS: m1(Math.cos),
  TAN: m1(Math.tan),
  ASIN: m1((x) => (x < -1 || x > 1 ? ERR.num : Math.asin(x))),
  ACOS: m1((x) => (x < -1 || x > 1 ? ERR.num : Math.acos(x))),
  ATAN: m1(Math.atan),
  ATAN2: m2((x, y) => (x === 0 && y === 0 ? ERR.div0 : Math.atan2(y, x))),
  SINH: m1(Math.sinh),
  COSH: m1(Math.cosh),
  TANH: m1(Math.tanh),
  ASINH: m1(Math.asinh),
  ACOSH: m1((x) => (x < 1 ? ERR.num : Math.acosh(x))),
  ATANH: m1((x) => (x <= -1 || x >= 1 ? ERR.num : Math.atanh(x))),
  DEGREES: m1((x) => (x * 180) / Math.PI),
  RADIANS: m1((x) => (x * Math.PI) / 180)
};
