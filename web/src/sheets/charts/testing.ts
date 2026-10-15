/** What the chart tests share: a table as a `Reader`, and an estimate in place of a canvas. */

import { formatValue } from '../engine';
import { estimateMeasure } from '../model/measure';
import type { Cell, ChartData, Reader } from './types';

export type Entry = number | string | boolean | null | { v: number; fmt: string } | { error: string };

/** Rows of plain values become a reader: numbers are numbers, strings are text, `{ v, fmt }` is a formatted number. */
export function table(rows: Entry[][], hidden: { rows?: number[]; cols?: number[] } = {}): Reader {
  return {
    cell(r, c): Cell | null {
      const e = rows[r]?.[c];
      if (e === undefined || e === null) return null;
      if (typeof e === 'number') return { v: e, text: formatValue(e).text };
      if (typeof e === 'string') return { v: e, text: e };
      if (typeof e === 'boolean') return { v: e, text: e ? 'TRUE' : 'FALSE' };
      if ('error' in e) return { v: null, text: e.error, error: true };
      return { v: e.v, text: formatValue(e.v, e.fmt).text, fmt: e.fmt };
    },
    rowHidden: (r) => hidden.rows?.includes(r) ?? false,
    colHidden: (c) => hidden.cols?.includes(c) ?? false
  };
}

export const measure = estimateMeasure();

/** A chart's data without going through a table. */
export function data(series: Record<string, (number | null)[]>, labels?: string[], extra: Partial<ChartData> = {}): ChartData {
  const names = Object.keys(series);
  const n = Math.max(0, ...names.map((k) => series[k]!.length));
  return {
    labels: labels ?? Array.from({ length: n }, (_, i) => String(i + 1)),
    x: null,
    xDate: false,
    series: names.map((name) => ({ name, values: series[name]! })),
    every: 1,
    total: n,
    ...extra
  };
}
