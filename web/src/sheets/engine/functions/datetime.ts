import type { Ctx, Value } from '../evaluate';
import {
  MAX_SERIAL,
  dateToSerial,
  daysInMonth,
  nowSerial,
  parseDateTime,
  serialToDate,
  serialToTime,
  todaySerial,
  weekday
} from '../dates';
import { type CellError, ERR, isError } from '../values';
import { type FnDef, type FnTable, flat, nums } from './helpers';

/** A date argument: a serial in Excel's range, or date text. */
function serial(ctx: Ctx, v: Value | undefined): number | CellError {
  const n = ctx.num(v);
  if (isError(n)) return n;
  return n < 0 || n >= MAX_SERIAL + 1 ? ERR.num : n;
}

function part(f: (s: number) => number): FnDef {
  return {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const s = serial(ctx, v);
      return isError(s) ? s : f(s);
    }
  };
}

/** WEEKDAY's return_type: the day weeks start on (0 is Sunday) and the number it gets. */
const WEEK_START: Record<number, [number, number]> = {
  1: [0, 1],
  2: [1, 1],
  3: [1, 0],
  11: [1, 1],
  12: [2, 1],
  13: [3, 1],
  14: [4, 1],
  15: [5, 1],
  16: [6, 1],
  17: [0, 1]
};

/** WEEKNUM's return_type: the day weeks start on. 21 is ISO, handled apart. */
const WEEKNUM_START: Record<number, number> = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 };

function isoWeek(s: number): number {
  const d = Math.floor(s);
  const mon1 = ((weekday(d) + 5) % 7) + 1; // Monday 1 to Sunday 7
  const thursday = d - mon1 + 4;
  const y = serialToDate(thursday).y;
  return Math.floor((thursday - dateToSerial(y, 1, 1)) / 7) + 1;
}

function addMonths(s: number, months: number, endOfMonth: boolean): number {
  const { y, m, d } = serialToDate(s);
  const total = y * 12 + (m - 1) + Math.trunc(months);
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  // dateToSerial reads a year below 1900 as an offset from it, as DATE does; here it is simply out of range.
  if (ny < 1900 || ny > 9999) return NaN;
  if (endOfMonth) return dateToSerial(ny, nm + 1, 0);
  return dateToSerial(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

function datedif(a: number, b: number, unit: string): number | CellError {
  if (a > b) return ERR.num;
  const s = serialToDate(a);
  const e = serialToDate(b);
  const months = (e.y - s.y) * 12 + (e.m - s.m) - (e.d < s.d ? 1 : 0);
  switch (unit.toUpperCase()) {
    case 'Y':
      return Math.floor(months / 12);
    case 'M':
      return months;
    case 'D':
      return Math.floor(b) - Math.floor(a);
    case 'YM':
      return months % 12;
    case 'MD':
      return e.d >= s.d ? e.d - s.d : Math.floor(b) - dateToSerial(e.y, e.m - 1, s.d);
    case 'YD': {
      let start = dateToSerial(e.y, s.m, s.d);
      if (start > Math.floor(b)) start = dateToSerial(e.y - 1, s.m, s.d);
      return Math.floor(b) - start;
    }
    default:
      return ERR.num;
  }
}

/** Holidays as a set of whole serials. */
function holidays(v: Value | undefined, ctx: Ctx): Set<number> | CellError {
  const out = new Set<number>();
  for (const x of flat(v)) {
    if (x === null) continue;
    const n = ctx.toNumber(x);
    if (isError(n)) return n;
    out.add(Math.floor(n));
  }
  return out;
}

const NO_HOLIDAYS = new Set<number>();

const isWorkday = (d: number, hol: Set<number>) => {
  const w = weekday(d);
  return w !== 1 && w !== 7 && !hol.has(d);
};

export const DATETIME: FnTable = {
  TODAY: { min: 0, max: 0, volatile: true, fn: (_a, ctx) => todaySerial(ctx.book.timeZone, ctx.book.now()) },
  NOW: { min: 0, max: 0, volatile: true, fn: (_a, ctx) => nowSerial(ctx.book.timeZone, ctx.book.now()) },
  DATE: {
    min: 3,
    max: 3,
    fn: ([y, m, d], ctx) => {
      const n = nums(ctx, y, m, d);
      if (isError(n)) return n;
      const [yy, mm, dd] = n.map(Math.trunc) as [number, number, number];
      if (yy < 0 || yy >= 10000) return ERR.num;
      const s = dateToSerial(yy, mm, dd);
      return Number.isNaN(s) ? ERR.num : s;
    }
  },
  TIME: {
    min: 3,
    max: 3,
    fn: ([h, m, s], ctx) => {
      const n = nums(ctx, h, m, s);
      if (isError(n)) return n;
      const [hh, mm, ss] = n.map(Math.trunc) as [number, number, number];
      if (hh > 32767 || mm > 32767 || ss > 32767) return ERR.num;
      const total = hh * 3600 + mm * 60 + ss;
      return total < 0 ? ERR.num : (total % 86_400) / 86_400;
    }
  },
  YEAR: part((s) => serialToDate(s).y),
  MONTH: part((s) => serialToDate(s).m),
  DAY: part((s) => serialToDate(s).d),
  HOUR: part((s) => serialToTime(s).h),
  MINUTE: part((s) => serialToTime(s).min),
  SECOND: part((s) => serialToTime(s).s),
  WEEKDAY: {
    min: 1,
    max: 2,
    fn: ([v, t], ctx) => {
      const s = serial(ctx, v);
      if (isError(s)) return s;
      const k = ctx.num(t, 1);
      if (isError(k)) return k;
      const ws = WEEK_START[Math.trunc(k)];
      if (!ws) return ERR.num;
      return ((weekday(s) - 1 - ws[0] + 7) % 7) + ws[1];
    }
  },
  WEEKNUM: {
    min: 1,
    max: 2,
    fn: ([v, t], ctx) => {
      const s = serial(ctx, v);
      if (isError(s)) return s;
      const k = ctx.num(t, 1);
      if (isError(k)) return k;
      if (Math.trunc(k) === 21) return isoWeek(s);
      const start = WEEKNUM_START[Math.trunc(k)];
      if (start === undefined) return ERR.num;
      const jan1 = dateToSerial(serialToDate(s).y, 1, 1);
      const offset = (weekday(jan1) - 1 - start + 7) % 7;
      return Math.floor((Math.floor(s) - jan1 + offset) / 7) + 1;
    }
  },
  ISOWEEKNUM: part(isoWeek),
  EDATE: {
    min: 2,
    max: 2,
    fn: ([v, m], ctx) => {
      const s = serial(ctx, v);
      if (isError(s)) return s;
      const k = ctx.num(m);
      if (isError(k)) return k;
      const r = addMonths(s, k, false);
      return Number.isNaN(r) ? ERR.num : r;
    }
  },
  EOMONTH: {
    min: 2,
    max: 2,
    fn: ([v, m], ctx) => {
      const s = serial(ctx, v);
      if (isError(s)) return s;
      const k = ctx.num(m);
      if (isError(k)) return k;
      const r = addMonths(s, k, true);
      return Number.isNaN(r) ? ERR.num : r;
    }
  },
  DAYS: {
    min: 2,
    max: 2,
    fn: ([e, s], ctx) => {
      const n = nums(ctx, e, s);
      return isError(n) ? n : Math.floor(n[0]!) - Math.floor(n[1]!);
    }
  },
  DATEDIF: {
    min: 3,
    max: 3,
    fn: ([a, b, u], ctx) => {
      const s = serial(ctx, a);
      if (isError(s)) return s;
      const e = serial(ctx, b);
      if (isError(e)) return e;
      const unit = ctx.str(u);
      return isError(unit) ? unit : datedif(s, e, unit);
    }
  },
  DATEVALUE: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const s = ctx.scalar(v);
      if (isError(s)) return s;
      if (typeof s !== 'string') return ERR.value;
      const d = parseDateTime(s, ctx.book.dateOrder);
      return d ? Math.floor(d.serial) : ERR.value;
    }
  },
  TIMEVALUE: {
    min: 1,
    max: 1,
    fn: ([v], ctx) => {
      const s = ctx.scalar(v);
      if (isError(s)) return s;
      if (typeof s !== 'string') return ERR.value;
      const d = parseDateTime(s, ctx.book.dateOrder);
      return d ? d.serial - Math.floor(d.serial) : ERR.value;
    }
  },
  NETWORKDAYS: {
    min: 2,
    max: 3,
    kinds: 'ssa',
    fn: ([a, b, h], ctx) => {
      const s = serial(ctx, a);
      if (isError(s)) return s;
      const e = serial(ctx, b);
      if (isError(e)) return e;
      const hol = holidays(h, ctx);
      if (isError(hol)) return hol;
      const [lo, hi] = s <= e ? [Math.floor(s), Math.floor(e)] : [Math.floor(e), Math.floor(s)];
      // Whole weeks hold five workdays each; only the remainder and the holidays are walked.
      const weeks = Math.floor((hi - lo + 1) / 7);
      let n = weeks * 5;
      for (let d = lo + weeks * 7; d <= hi; d++) if (isWorkday(d, NO_HOLIDAYS)) n++;
      for (const d of hol) if (d >= lo && d <= hi && isWorkday(d, NO_HOLIDAYS)) n--;
      return s <= e ? n : -n;
    }
  },
  WORKDAY: {
    min: 2,
    max: 3,
    kinds: 'ssa',
    fn: ([a, k, h], ctx) => {
      const s = serial(ctx, a);
      if (isError(s)) return s;
      const n = ctx.num(k);
      if (isError(n)) return n;
      const hol = holidays(h, ctx);
      if (isError(hol)) return hol;
      let d = Math.floor(s);
      let left = Math.trunc(n);
      const step = left < 0 ? -1 : 1;
      while (left !== 0) {
        d += step;
        if (d < 0 || d > MAX_SERIAL) return ERR.num;
        if (isWorkday(d, hol)) left -= step;
      }
      return d;
    }
  }
};
