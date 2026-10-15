/**
 * The maths of an axis: where its ticks go, and what range it spans.
 *
 * Pure numbers in and out, no text and no DOM, so each rule here has a test. `niceTicks` is the
 * usual "nice numbers" search (steps of 1, 2 or 5 times a power of ten); `dateTicks` does the same
 * for a time axis, in whole days, weeks, months, quarters or years, so a date axis reads
 * "Jan 2025, Apr 2025, Jul 2025" and never "14 Feb, 3 Mar".
 */

import { dateToSerial, serialToDate, weekday } from '../engine/dates';

export interface Ticks {
  values: number[];
  /** The axis' ends: the outermost ticks, so a bar that reaches the data's maximum is not on the frame. */
  min: number;
  max: number;
  step: number;
}

/** A tick step that is 1, 2, 5 or 10 times a power of ten, the one nearest `x` (or the next one up). */
export function niceStep(x: number, round: boolean): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  let n: number;
  if (round) n = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * 10 ** exp;
}

/** Digits after the point that a step needs: 0.25 needs two. */
export function decimalsOf(step: number): number {
  if (!(step > 0)) return 0;
  let d = 0;
  while (d < 8 && Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) > 1e-9 * Math.max(1, step * 10 ** d)) d++;
  return d;
}

const clean = (n: number, decimals: number): number => Number(n.toFixed(Math.min(decimals + 2, 12)));

/**
 * Ticks that cover [lo, hi] with about `count` of them. The ends are rounded outwards onto the
 * step, so the axis always contains the data. A flat range (lo equals hi) is given room on both
 * sides, and a range of nothing gets 0 to 1.
 */
export function niceTicks(lo: number, hi: number, count = 5): Ticks {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return niceTicks(0, 1, count);
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    if (lo === 0) return niceTicks(0, 1, count);
    const pad = Math.abs(lo) * 0.5;
    return niceTicks(lo - pad, hi + pad, count);
  }
  const step = niceStep(niceStep(hi - lo, false) / Math.max(1, count - 1), true);
  const eps = 1e-9;
  const min = Math.floor(lo / step + eps) * step;
  const max = Math.ceil(hi / step - eps) * step;
  const d = decimalsOf(step);
  const values: number[] = [];
  const n = Math.round((max - min) / step);
  for (let i = 0; i <= n; i++) values.push(clean(min + i * step, d));
  return { values, min: values[0]!, max: values[values.length - 1]!, step: clean(step, d) };
}

export interface DomainOptions {
  /** Keep zero inside the range: a bar's length means something only from zero. */
  zero: boolean;
  /** Fit the data and nothing else: a scatter's position means something without a zero. */
  tight?: boolean;
  fixedMin?: number | undefined;
  fixedMax?: number | undefined;
}

/**
 * The range an axis spans before it is rounded onto ticks. A line or a scatter does not start at
 * zero unless the data is close to it (Excel's rule: the minimum is zero when it is less than
 * five sixths of the maximum), because a line that wobbles between 9,800 and 10,200 is a flat
 * stripe on an axis that starts at zero.
 */
export function valueDomain(min: number, max: number, o: DomainOptions): [number, number] {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (o.zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  } else if (!o.tight) {
    if (lo >= 0 && hi > 0 && lo < (hi * 5) / 6) lo = 0;
    else if (hi <= 0 && lo < 0 && hi > (lo * 5) / 6) hi = 0;
  }
  if (o.fixedMin !== undefined && Number.isFinite(o.fixedMin)) lo = o.fixedMin;
  if (o.fixedMax !== undefined && Number.isFinite(o.fixedMax)) hi = o.fixedMax;
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

/**
 * The ticks of a value axis. When both ends are fixed they are kept as given and the ticks fall
 * inside; otherwise the free end is rounded outwards onto the step.
 */
export function valueTicks(min: number, max: number, o: DomainOptions, count: number): Ticks {
  const [lo, hi] = valueDomain(min, max, o);
  const fixedLo = o.fixedMin !== undefined && Number.isFinite(o.fixedMin);
  const fixedHi = o.fixedMax !== undefined && Number.isFinite(o.fixedMax);
  const t = niceTicks(lo, hi, count);
  if (!fixedLo && !fixedHi) return t;
  const start = fixedLo ? lo : t.min;
  const end = fixedHi ? hi : t.max;
  if (!(end > start)) return { values: [start], min: start, max: start + 1, step: 1 };
  const d = decimalsOf(t.step);
  const values = t.values.filter((v) => v >= start - 1e-9 && v <= end + 1e-9);
  return { values, min: start, max: end, step: t.step === 0 ? 1 : clean(t.step, d) };
}

// ── time ────────────────────────────────────────────────────────────────────

export type DateUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface DateTicks {
  values: number[];
  unit: DateUnit;
  /** In the unit: 2 months, 5 years. */
  step: number;
  /** A format code that says no more than the unit needs: `mmm yyyy` for a month. */
  format: string;
}

const STEPS: { unit: DateUnit; step: number; days: number; format: string }[] = [
  { unit: 'day', step: 1, days: 1, format: 'd mmm' },
  { unit: 'day', step: 2, days: 2, format: 'd mmm' },
  { unit: 'week', step: 1, days: 7, format: 'd mmm' },
  { unit: 'week', step: 2, days: 14, format: 'd mmm' },
  { unit: 'month', step: 1, days: 30.44, format: 'mmm yyyy' },
  { unit: 'month', step: 2, days: 60.9, format: 'mmm yyyy' },
  { unit: 'quarter', step: 1, days: 91.3, format: 'mmm yyyy' },
  { unit: 'month', step: 6, days: 182.6, format: 'mmm yyyy' },
  { unit: 'year', step: 1, days: 365.25, format: 'yyyy' },
  { unit: 'year', step: 2, days: 730.5, format: 'yyyy' },
  { unit: 'year', step: 5, days: 1826.25, format: 'yyyy' },
  { unit: 'year', step: 10, days: 3652.5, format: 'yyyy' },
  { unit: 'year', step: 20, days: 7305, format: 'yyyy' },
  { unit: 'year', step: 50, days: 18262.5, format: 'yyyy' },
  { unit: 'year', step: 100, days: 36525, format: 'yyyy' }
];

const monthsIn = (u: DateUnit, step: number): number => (u === 'quarter' ? 3 * step : u === 'year' ? 12 * step : step);

/**
 * Ticks for dates between two serials, at the largest unit that does not crowd: no more than
 * about `count` of them, each on a boundary (the first of a month, the first of a quarter, a
 * Monday), and inside the data.
 */
export function dateTicks(lo: number, hi: number, count = 6): DateTicks {
  const a = Math.floor(Math.min(lo, hi));
  const b = Math.ceil(Math.max(lo, hi));
  const span = Math.max(1, b - a);
  const pick = STEPS.find((s) => span / s.days <= count + 0.5) ?? STEPS[STEPS.length - 1]!;
  const values: number[] = [];

  if (pick.unit === 'day' || pick.unit === 'week') {
    let first = Math.ceil(a / pick.days) * pick.days;
    // A week starts on Monday, so ticks of a week are Mondays.
    if (pick.unit === 'week') {
      first = a;
      while (weekday(first) !== 2) first++;
    }
    for (let v = first; v <= b; v += pick.days) values.push(v);
  } else {
    const months = monthsIn(pick.unit, pick.step);
    const from = serialToDate(a);
    // The boundary at or after the first date, on a multiple of the step counted from January.
    let index = from.y * 12 + (from.m - 1);
    index = Math.ceil(index / months) * months;
    for (let guard = 0; guard < 500; guard++, index += months) {
      const serial = dateToSerial(Math.floor(index / 12), (index % 12) + 1, 1);
      if (!Number.isFinite(serial)) break;
      if (serial > b) break;
      if (serial >= a) values.push(serial);
    }
  }
  // A range inside one boundary still wants an axis: its two ends.
  if (values.length === 0) values.push(a);
  return { values, unit: pick.unit, step: pick.step, format: pick.format };
}
