/**
 * What the chart code passes between its parts. Nothing here knows about Yjs, the engine or the
 * DOM: a chart is read from cells through a `Reader`, turned into a `ChartData`, laid out as a
 * `ChartGeom` (layout.ts) and drawn from that (render.tsx).
 */

import type { ChartOptions, ChartSpec } from '../model/features';

export type { ChartOptions, ChartSpec };
export type ChartType = ChartSpec['type'];
export type LegendPosition = NonNullable<ChartOptions['legend']>;

/** One cell as a chart reads it: the value behind it and the text it shows. */
export interface Cell {
  /** A number is plotted; text and booleans label or are skipped; an error and an empty cell are skipped. */
  v: number | string | boolean | null;
  /** What the grid shows, after the number format. */
  text: string;
  /** The number format code, when the cell has one. */
  fmt?: string;
  error?: boolean;
}

/** A block of cells by today's indexes: the data sheet as a chart sees it. */
export interface Reader {
  cell(row: number, col: number): Cell | null;
  /** Hidden and filtered lines are not plotted, as in Excel's default. */
  rowHidden(row: number): boolean;
  colHidden(col: number): boolean;
}

export interface Series {
  name: string;
  /** One per point; null is a gap (an empty cell, text, an error). */
  values: (number | null)[];
  /** The number format of the series' first number: ticks and tooltips show values as the cells do. */
  fmt?: string;
}

export interface ChartData {
  /** One per point: the label column's text, or 1, 2, 3 when there is none. */
  labels: string[];
  /** The numbers behind the labels, when every label is a number or a date: a time axis, a scatter's x. */
  x: (number | null)[] | null;
  /** The x values are dates, so the axis counts in days and months. */
  xDate: boolean;
  xFmt?: string;
  series: Series[];
  /** 1 when every point of the range is plotted; n when only every n-th is (a range past what a chart draws). */
  every: number;
  /** The points in the range, before sampling. */
  total: number;
}

export interface DetectedLayout {
  seriesIn: 'cols' | 'rows';
  headers: boolean;
  labels: boolean;
}
