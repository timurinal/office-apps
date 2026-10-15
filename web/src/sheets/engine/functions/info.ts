import { UnionValue, isMulti } from '../evaluate';
import { RangeValue } from '../sheet';
import { ERR, type Scalar, isError } from '../values';
import type { FnDef, FnTable } from './helpers';

function is(test: (v: Scalar) => boolean): FnDef {
  return { min: 1, max: 1, fn: ([v], ctx) => test(ctx.scalar(v)) };
}

function parity(odd: boolean): FnDef {
  return {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const x = ctx.scalar(v);
      if (typeof x === 'boolean') return ERR.value;
      const n = ctx.toNumber(x);
      if (isError(n)) return n;
      return (Math.abs(Math.trunc(n)) % 2 === 1) === odd;
    }
  };
}

const ERROR_TYPES: Record<string, number> = {
  '#NULL!': 1,
  '#DIV/0!': 2,
  '#VALUE!': 3,
  '#REF!': 4,
  '#NAME?': 5,
  '#NUM!': 6,
  '#N/A': 7,
  '#SPILL!': 9,
  '#CALC!': 14
};

export const INFO: FnTable = {
  ISBLANK: is((v) => v === null),
  ISNUMBER: is((v) => typeof v === 'number'),
  ISTEXT: is((v) => typeof v === 'string'),
  ISNONTEXT: is((v) => typeof v !== 'string'),
  ISLOGICAL: is((v) => typeof v === 'boolean'),
  ISERROR: is(isError),
  ISERR: is((v) => isError(v) && v.code !== '#N/A'),
  ISNA: is((v) => isError(v) && v.code === '#N/A'),
  ISEVEN: parity(false),
  ISODD: parity(true),
  ISREF: {
    min: 1,
    max: 1,
    lazy: ([n], ctx) => {
      const v = ctx.evalArray(n!);
      return v instanceof RangeValue || v instanceof UnionValue;
    }
  },
  ISFORMULA: {
    min: 1,
    max: 1,
    lazy: ([n], ctx) => {
      const v = ctx.evalArray(n!);
      if (isError(v)) return v;
      if (!(v instanceof RangeValue)) return ERR.value;
      return !!v.cellAt(0, 0)?.formula;
    }
  },
  NA: { min: 0, max: 0, fn: () => ERR.na },
  'ERROR.TYPE': {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const x = ctx.scalar(v);
      return isError(x) ? (ERROR_TYPES[x.code] ?? ERR.na) : ERR.na;
    }
  },
  TYPE: {
    min: 1,
    max: 1,
    kinds: 'a',
    fn: ([v], ctx) => {
      if (isMulti(v)) return 64;
      const x = ctx.scalar(v);
      return typeof x === 'string' ? 2 : typeof x === 'boolean' ? 4 : isError(x) ? 16 : 1;
    }
  },
  N: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const x = ctx.scalar(v);
      return typeof x === 'number' || isError(x) ? x : typeof x === 'boolean' ? (x ? 1 : 0) : 0;
    }
  }
};
