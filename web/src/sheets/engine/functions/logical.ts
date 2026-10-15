import { type Ctx, UnionValue, type Value, broadcast, isMulti } from '../evaluate';
import type { Node } from '../parser';
import { RangeValue } from '../sheet';
import { type CellError, ERR, type Scalar, compare, isError, toBool } from '../values';
import { type Args, type FnTable, flat } from './helpers';

const ANY = Infinity;

/**
 * A branch IF or CHOOSE returns. A written-but-empty branch, as in IF(A1,,1), is 0.
 * A reference stays one, so SUM(IF(x, A1:A3, B1:B3)) sums a range.
 */
function branch(n: Node, ctx: Ctx): Value {
  return n.t === 'missing' ? 0 : ctx.reference(n);
}

function logical(args: Args, fold: (trues: number, total: number) => boolean): Scalar {
  let trues = 0;
  let total = 0;
  for (const v of args.flatMap((a) => (a instanceof UnionValue ? a.ranges : [a]))) {
    if (v instanceof RangeValue || Array.isArray(v)) {
      for (const x of flat(v)) {
        if (isError(x)) return x;
        if (typeof x === 'boolean' || typeof x === 'number') {
          total++;
          if (x) trues++;
        }
      }
    } else {
      const b = toBool(v ?? null);
      if (isError(b)) return b;
      total++;
      if (b) trues++;
    }
  }
  return total ? fold(trues, total) : ERR.value;
}

/** IFERROR and IFNA: the value unless it is a matching error, element by element in array mode. */
function catching(matches: (e: CellError) => boolean) {
  return (args: Node[], ctx: Ctx): Value => {
    const v = ctx.eval(args[0]!);
    if (ctx.array && isMulti(v)) {
      const alt = branch(args[1]!, ctx);
      return broadcast([v, alt], ([x, y]) => (isError(x) && matches(x) ? y! : x!));
    }
    const s = ctx.scalar(v);
    return isError(s) && matches(s) ? branch(args[1]!, ctx) : s;
  };
}

export const LOGICAL: FnTable = {
  IF: {
    min: 1,
    max: 3,
    lazy: (args, ctx) => {
      const c = ctx.eval(args[0]!);
      if (ctx.array && isMulti(c)) {
        const t: Value = args[1] ? branch(args[1], ctx) : true;
        const f: Value = args[2] ? branch(args[2], ctx) : false;
        return broadcast([c, t, f], ([x, y, z]) => {
          const b = toBool(x!);
          return isError(b) ? b : b ? y! : z!;
        });
      }
      const b = toBool(ctx.scalar(c));
      if (isError(b)) return b;
      if (b) return args[1] ? branch(args[1], ctx) : true;
      return args[2] ? branch(args[2], ctx) : false;
    }
  },
  IFS: {
    min: 2,
    max: ANY,
    lazy: (args, ctx) => {
      if (args.length % 2) return ERR.na;
      for (let i = 0; i < args.length; i += 2) {
        const b = toBool(ctx.scalar(ctx.eval(args[i]!)));
        if (isError(b)) return b;
        if (b) return branch(args[i + 1]!, ctx);
      }
      return ERR.na;
    }
  },
  IFERROR: { min: 2, max: 2, lazy: catching(() => true) },
  IFNA: { min: 2, max: 2, lazy: catching((e) => e.code === '#N/A') },
  AND: { min: 1, max: ANY, kinds: 'a', fn: (args) => logical(args, (t, n) => t === n) },
  OR: { min: 1, max: ANY, kinds: 'a', fn: (args) => logical(args, (t) => t > 0) },
  XOR: { min: 1, max: ANY, kinds: 'a', fn: (args) => logical(args, (t) => t % 2 === 1) },
  NOT: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const b = ctx.bool(v);
      return isError(b) ? b : !b;
    }
  },
  TRUE: { min: 0, max: 0, fn: () => true },
  FALSE: { min: 0, max: 0, fn: () => false },
  SWITCH: {
    min: 3,
    max: ANY,
    lazy: (args, ctx) => {
      const x = ctx.evalScalar(args[0]!);
      if (isError(x)) return x;
      let i = 1;
      for (; i + 1 < args.length; i += 2) {
        const v = ctx.evalScalar(args[i]!);
        if (isError(v)) return v;
        if (compare(x, v) === 0) return branch(args[i + 1]!, ctx);
      }
      return i < args.length ? branch(args[i]!, ctx) : ERR.na;
    }
  },
  CHOOSE: {
    min: 2,
    max: ANY,
    lazy: (args, ctx) => {
      const idx = ctx.eval(args[0]!);
      // CHOOSE({1,2}, B1:B9, A1:A9) builds a two-column table, the VLOOKUP-to-the-left idiom.
      if (ctx.array && isMulti(idx)) {
        const choices = args.slice(1).map((n) => branch(n, ctx));
        return broadcast([idx, ...choices], ([k, ...xs]) => {
          const n = ctx.toNumber(k!);
          if (isError(n)) return n;
          return xs[Math.trunc(n) - 1] ?? ERR.value;
        });
      }
      const n = ctx.num(idx);
      if (isError(n)) return n;
      const k = Math.trunc(n);
      return k >= 1 && k < args.length ? branch(args[k]!, ctx) : ERR.value;
    }
  }
};
