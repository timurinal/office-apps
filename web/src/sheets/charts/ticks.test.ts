import { describe, expect, it } from 'vitest';
import { dateToSerial } from '../engine';
import { dateTicks, decimalsOf, niceStep, niceTicks, valueDomain, valueTicks } from './ticks';

describe('niceStep', () => {
  it('is 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceStep(0.9, true)).toBe(1);
    expect(niceStep(1.4, true)).toBe(1);
    expect(niceStep(2.4, true)).toBe(2);
    expect(niceStep(4, true)).toBe(5);
    expect(niceStep(8, true)).toBe(10);
    expect(niceStep(240, true)).toBe(200);
    expect(niceStep(0.012, true)).toBeCloseTo(0.01, 12);
  });

  it('rounds up, not to the nearest, when asked for a bound', () => {
    expect(niceStep(73, false)).toBe(100);
    expect(niceStep(2.01, false)).toBe(5);
    expect(niceStep(5, false)).toBe(5);
  });

  it('falls back to 1 for a step that is not a positive number', () => {
    expect(niceStep(0, true)).toBe(1);
    expect(niceStep(-4, true)).toBe(1);
    expect(niceStep(Number.NaN, true)).toBe(1);
  });
});

describe('decimalsOf', () => {
  it('counts the digits a step needs', () => {
    expect(decimalsOf(10)).toBe(0);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(0.25)).toBe(2);
    expect(decimalsOf(0.002)).toBe(3);
  });
});

describe('niceTicks', () => {
  it('covers the data on round numbers', () => {
    const t = niceTicks(0, 73, 5);
    expect(t.values).toEqual([0, 20, 40, 60, 80]);
    expect([t.min, t.max, t.step]).toEqual([0, 80, 20]);
  });

  it('rounds both ends outwards', () => {
    const t = niceTicks(48_000, 74_000, 5);
    expect(t.min).toBeLessThanOrEqual(48_000);
    expect(t.max).toBeGreaterThanOrEqual(74_000);
    expect(t.values[0]).toBe(t.min);
    expect(t.values.at(-1)).toBe(t.max);
    // Every tick is a multiple of the step.
    for (const v of t.values) expect(Math.abs(v / t.step - Math.round(v / t.step))).toBeLessThan(1e-9);
  });

  it('handles negatives, with zero among the ticks', () => {
    const t = niceTicks(-35, 120, 6);
    expect(t.values).toContain(0);
    expect(t.min).toBeLessThanOrEqual(-35);
    expect(t.max).toBeGreaterThanOrEqual(120);
  });

  it('keeps decimals exact, without 0.30000000000000004', () => {
    const t = niceTicks(0, 1, 5);
    expect(t.values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 0.5, 6).values).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('gives a flat range room on both sides', () => {
    const t = niceTicks(5, 5, 5);
    expect(t.min).toBeLessThan(5);
    expect(t.max).toBeGreaterThan(5);
  });

  it('answers 0 to 1 for nothing, for zero and for what is not a number', () => {
    expect(niceTicks(0, 0).values).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(Number.NaN, 4).min).toBe(0);
  });

  it('accepts its ends the wrong way round', () => {
    expect(niceTicks(80, 0, 5).values).toEqual(niceTicks(0, 80, 5).values);
  });
});

describe('valueDomain', () => {
  it('keeps zero inside a bar chart, however far the data is from it', () => {
    expect(valueDomain(9_800, 10_200, { zero: true })).toEqual([0, 10_200]);
    expect(valueDomain(-5, -2, { zero: true })).toEqual([-5, 0]);
  });

  it('lets a line start above zero when the data is a narrow band', () => {
    expect(valueDomain(9_800, 10_200, { zero: false })).toEqual([9_800, 10_200]);
    // Excel's rule: under five sixths of the maximum, the axis starts at zero.
    expect(valueDomain(2, 10, { zero: false })).toEqual([0, 10]);
    expect(valueDomain(9, 10, { zero: false })).toEqual([9, 10]);
  });

  it('fits the data and nothing else when asked to be tight, as a scatter is', () => {
    expect(valueDomain(150, 190, { zero: false, tight: true })).toEqual([150, 190]);
    expect(valueDomain(150, 190, { zero: false })).toEqual([0, 190]);
  });

  it('takes a fixed end over everything else', () => {
    expect(valueDomain(0, 100, { zero: true, fixedMin: 20, fixedMax: 80 })).toEqual([20, 80]);
    expect(valueDomain(0, 100, { zero: true, fixedMax: 50 })).toEqual([0, 50]);
  });
});

describe('valueTicks', () => {
  it('keeps a fixed end exactly and puts ticks inside it', () => {
    const t = valueTicks(0, 100, { zero: true, fixedMin: 10, fixedMax: 90 }, 5);
    expect(t.min).toBe(10);
    expect(t.max).toBe(90);
    for (const v of t.values) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(90);
    }
  });

  it('rounds a free end outwards as niceTicks does', () => {
    const t = valueTicks(0, 73, { zero: true }, 5);
    expect(t.max).toBe(80);
  });

  it('survives a maximum below the minimum', () => {
    const t = valueTicks(0, 100, { zero: true, fixedMin: 50, fixedMax: 50 }, 5);
    expect(t.max).toBeGreaterThan(t.min);
  });
});

describe('dateTicks', () => {
  const d = (y: number, m: number, day = 1) => dateToSerial(y, m, day);

  it('uses days for a fortnight and says "d mmm"', () => {
    const t = dateTicks(d(2025, 3, 3), d(2025, 3, 14), 6);
    expect(t.unit).toBe('day');
    expect(t.format).toBe('d mmm');
    expect(t.values.length).toBeLessThanOrEqual(7);
  });

  it('ticks a week on Mondays', () => {
    // 3 March 2025 was a Monday.
    const t = dateTicks(d(2025, 3, 1), d(2025, 4, 5), 6);
    expect(t.unit).toBe('week');
    expect(t.values[0]).toBe(d(2025, 3, 3));
    expect(t.values[1]! - t.values[0]!).toBe(t.step * 7);
  });

  it('ticks months on the first of the month', () => {
    const t = dateTicks(d(2025, 1, 15), d(2025, 6, 20), 6);
    expect(t.unit).toBe('month');
    expect(t.values).toEqual([d(2025, 2), d(2025, 3), d(2025, 4), d(2025, 5), d(2025, 6)]);
    expect(t.format).toBe('mmm yyyy');
  });

  it('ticks quarters on January, April, July and October', () => {
    const t = dateTicks(d(2024, 1, 1), d(2025, 6, 30), 6);
    expect(t.unit).toBe('quarter');
    expect(t.values).toEqual([d(2024, 1), d(2024, 4), d(2024, 7), d(2024, 10), d(2025, 1), d(2025, 4)]);
  });

  it('ticks years on the first of January, at a step that does not crowd', () => {
    const t = dateTicks(d(1995, 6, 1), d(2025, 6, 1), 6);
    expect(t.unit).toBe('year');
    expect(t.format).toBe('yyyy');
    expect(t.values.length).toBeLessThanOrEqual(7);
    expect(t.values.every((v) => v >= d(1995, 6, 1) && v <= d(2025, 6, 1))).toBe(true);
    // Each lies on a multiple of the step.
    expect(t.values[0]).toBe(d(2000, 1));
  });

  it('answers the first date when nothing falls inside the range', () => {
    const t = dateTicks(d(2025, 3, 3), d(2025, 3, 3));
    expect(t.values).toEqual([d(2025, 3, 3)]);
  });
});
