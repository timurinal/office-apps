/**
 * From a block of cells to the series a chart plots, and from a selection to a chart's layout.
 *
 * Two jobs, both pure over a `Reader`:
 *
 *   `detectLayout` decides what a selection means, the way Excel and Google Sheets do: whether
 *   its first row names the series, whether its first column holds the categories, and whether the
 *   series run down the columns or along the rows. `readData` then reads a block under that
 *   decision (or under what a stored chart says) into the series, labels and x values to draw.
 *
 * The rules are in the comments on each function; each has a test.
 */

import type { Rect } from '../grid/types';
import { isDateFormat } from '../engine';
import type { Cell, ChartData, ChartType, DetectedLayout, Reader, Series } from './types';

/** How many points a chart draws before it samples. A column chart of 100,000 bars is a smear. */
export const MAX_POINTS: Record<ChartType, number> = { column: 200, bar: 100, line: 2000, area: 2000, scatter: 2000, pie: 50, doughnut: 50 };
/** More series than this are not drawn; a chart of fifty lines says nothing. */
export const MAX_SERIES = 24;

// ── what a cell is ──────────────────────────────────────────────────────────

type Kind = 'num' | 'date' | 'text' | 'empty';

function kindOf(c: Cell | null): Kind {
  if (!c || c.error) return 'empty';
  if (typeof c.v === 'number') return isDateFormat(c.fmt) ? 'date' : 'num';
  if (typeof c.v === 'string') return c.v.trim() === '' ? 'empty' : 'text';
  if (typeof c.v === 'boolean') return 'text';
  return 'empty';
}

/** What a column or row of cells mostly is: a few stray words among numbers do not make it text. */
function classify(kinds: Kind[]): Kind {
  let num = 0;
  let date = 0;
  let text = 0;
  for (const k of kinds) {
    if (k === 'num') num++;
    else if (k === 'date') date++;
    else if (k === 'text') text++;
  }
  if (num > 0 && num >= text + date) return 'num';
  if (date > 0 && date >= text) return 'date';
  if (text > 0 || date > 0) return 'text';
  return num > 0 ? 'num' : 'empty';
}

/** Cells examined to classify a line; past this a long column is judged by its start. */
const PROBE = 60;

// ── a selection, read the way a person means it ─────────────────────────────

/**
 * Whether the first row names the series, the first column holds the categories, and which way the
 * series run. Null when the block has no numbers to plot.
 *
 *   · Each column's body (everything under the first row) is classed number, date, text or empty.
 *   · The first row is a header when a column of numbers has text over it. It is not when the first
 *     row is itself numbers, as a row of years is: that row is data, as Excel reads it.
 *   · The first column holds categories when its body is text or dates, with numbers beside it.
 *     A first column of numbers is a series, except with an empty corner under a header row
 *     (Excel's old trick for years), and in a scatter, where it is x.
 *   · The series run down the columns unless the block is wider than it is tall, once the header
 *     row and label column are taken out (Excel's rule). A tie runs down.
 */
export function detectLayout(rect: Rect, reader: Reader, type: ChartType): DetectedLayout | null {
  const rows = rect.r2 - rect.r1 + 1;
  const cols = rect.c2 - rect.c1 + 1;
  if (rows < 1 || cols < 1) return null;
  const bodyEnd = Math.min(rect.r2, rect.r1 + PROBE);

  // A one-row block has no body: its row is the data.
  const bodyOf = (c: number): Kind[] => {
    const kinds: Kind[] = [];
    for (let r = rows === 1 ? rect.r1 : rect.r1 + 1; r <= bodyEnd; r++) kinds.push(kindOf(reader.cell(r, c)));
    return kinds;
  };
  const body = Array.from({ length: cols }, (_, i) => classify(bodyOf(rect.c1 + i)));
  const top = Array.from({ length: cols }, (_, i) => kindOf(reader.cell(rect.r1, rect.c1 + i)));

  const numeric = body.some((k) => k === 'num') || (rows === 1 && top.some((k) => k === 'num'));
  if (!numeric) {
    // Dates alone are a series of numbers too, but nothing to plot them against.
    if (!(rows > 1 && body.some((k) => k === 'date'))) return null;
  }

  // A header: some column that holds numbers has words (or a date) over it, and no number is up there.
  const numberColumns = body.map((k, i) => (k === 'num' ? i : -1)).filter((i) => i >= 0);
  const topLine =
    rows > 1 &&
    numberColumns.length > 0 &&
    numberColumns.every((i) => top[i] === 'text' || top[i] === 'date' || top[i] === 'empty') &&
    numberColumns.some((i) => top[i] !== 'empty');

  // A label column: the first column's body is words or dates and another column has the numbers.
  const firstBody = body[0]!;
  let leftLine = cols > 1 && (firstBody === 'text' || firstBody === 'date') && body.slice(1).some((k) => k === 'num');
  if (cols > 1 && firstBody === 'num' && body.slice(1).some((k) => k === 'num')) {
    const emptyCorner = top[0] === 'empty';
    if (type === 'scatter' || (emptyCorner && topLine)) leftLine = true;
  }

  const dataRows = rows - (topLine ? 1 : 0);
  const dataCols = cols - (leftLine ? 1 : 0);
  const seriesIn: 'cols' | 'rows' = dataCols > dataRows ? 'rows' : 'cols';
  const layout: DetectedLayout = seriesIn === 'cols' ? { seriesIn, headers: topLine, labels: leftLine } : { seriesIn, headers: leftLine, labels: topLine };
  return layout;
}

/**
 * The block a single selected cell stands for: the cells joined to it, as Ctrl+A in Excel finds
 * them. Grows a side at a time while the line beside it (corners included) holds anything.
 * `limit` keeps a click in a sheet of a million filled rows from reading all of them.
 */
export function currentRegion(reader: Reader, at: { row: number; col: number }, bounds: { rows: number; cols: number }, limit = 200_000): Rect {
  const rect: Rect = { r1: at.row, r2: at.row, c1: at.col, c2: at.col };
  const filled = (r: number, c: number) => kindOf(reader.cell(r, c)) !== 'empty';
  const rowFilled = (r: number, c1: number, c2: number) => {
    for (let c = c1; c <= c2; c++) if (filled(r, c)) return true;
    return false;
  };
  const colFilled = (c: number, r1: number, r2: number) => {
    for (let r = r1; r <= r2; r++) if (filled(r, c)) return true;
    return false;
  };
  let reads = 0;
  for (let again = true; again; ) {
    again = false;
    if (rect.r1 > 0 && rowFilled(rect.r1 - 1, Math.max(0, rect.c1 - 1), Math.min(bounds.cols - 1, rect.c2 + 1))) {
      rect.r1--;
      again = true;
    }
    if (rect.r2 < bounds.rows - 1 && rowFilled(rect.r2 + 1, Math.max(0, rect.c1 - 1), Math.min(bounds.cols - 1, rect.c2 + 1))) {
      rect.r2++;
      again = true;
    }
    if (rect.c1 > 0 && colFilled(rect.c1 - 1, Math.max(0, rect.r1 - 1), Math.min(bounds.rows - 1, rect.r2 + 1))) {
      rect.c1--;
      again = true;
    }
    if (rect.c2 < bounds.cols - 1 && colFilled(rect.c2 + 1, Math.max(0, rect.r1 - 1), Math.min(bounds.rows - 1, rect.r2 + 1))) {
      rect.c2++;
      again = true;
    }
    reads += (rect.r2 - rect.r1 + rect.c2 - rect.c1 + 2) * 2;
    if (reads > limit) break;
  }
  return rect;
}

// ── a block, read into series ───────────────────────────────────────────────

export interface ReadOptions {
  type: ChartType;
  seriesIn: 'cols' | 'rows';
  headers: boolean;
  labels: boolean;
  /** Fewer points than `MAX_POINTS[type]`, for a test. */
  maxPoints?: number;
}

const numberOf = (c: Cell | null): number | null => (c && typeof c.v === 'number' && Number.isFinite(c.v) ? c.v : null);

/**
 * The series, labels and x values of a block.
 *
 * `u` runs along the categories (rows when the series are columns) and `v` along the series.
 * The header line is `u = 0` and the label line is `v = 0`, which is the first row and first
 * column whichever way round the chart is, so one loop reads both. Hidden and filtered lines are
 * left out. A range with more points than the chart draws is sampled evenly, keeping the last.
 */
export function readData(rect: Rect, reader: Reader, o: ReadOptions): ChartData {
  const cols = o.seriesIn === 'cols';
  const U = cols ? rect.r2 - rect.r1 + 1 : rect.c2 - rect.c1 + 1;
  const V = cols ? rect.c2 - rect.c1 + 1 : rect.r2 - rect.r1 + 1;
  const cell = (u: number, v: number): Cell | null => (cols ? reader.cell(rect.r1 + u, rect.c1 + v) : reader.cell(rect.r1 + v, rect.c1 + u));
  const hiddenU = (u: number) => (cols ? reader.rowHidden(rect.r1 + u) : reader.colHidden(rect.c1 + u));
  const hiddenV = (v: number) => (cols ? reader.colHidden(rect.c1 + v) : reader.rowHidden(rect.r1 + v));

  const us: number[] = [];
  for (let u = o.headers ? 1 : 0; u < U; u++) if (!hiddenU(u)) us.push(u);
  const vs: number[] = [];
  for (let v = o.labels ? 1 : 0; v < V; v++) if (!hiddenV(v)) vs.push(v);

  const total = us.length;
  const max = o.maxPoints ?? MAX_POINTS[o.type];
  const every = total > max ? Math.ceil(total / max) : 1;
  const picked = every === 1 ? us : us.filter((_, i) => i % every === 0 || i === total - 1);

  const labels: string[] = [];
  let x: (number | null)[] | null = null;
  let xDate = false;
  let xFmt: string | undefined;
  if (o.labels) {
    const cells = picked.map((u) => cell(u, 0));
    let numbers = 0;
    let dates = 0;
    for (const c of cells) {
      const k = kindOf(c);
      if (k === 'num') numbers++;
      else if (k === 'date') dates++;
    }
    const numeric = cells.length > 0 && numbers + dates > 0 && cells.every((c) => kindOf(c) !== 'text');
    if (numeric) {
      x = cells.map(numberOf);
      xDate = dates > 0 && dates >= numbers;
      xFmt = cells.find((c) => numberOf(c) !== null)?.fmt;
    }
    for (const c of cells) labels.push(c ? c.text : '');
  } else picked.forEach((u) => labels.push(String(u + (o.headers ? 0 : 1))));

  const series: Series[] = [];
  for (const v of vs.slice(0, MAX_SERIES)) {
    const values = picked.map((u) => numberOf(cell(u, v)));
    let fmt: string | undefined;
    for (const u of picked) {
      const c = cell(u, v);
      if (numberOf(c) !== null) {
        fmt = c?.fmt;
        break;
      }
    }
    const header = o.headers ? cell(0, v)?.text.trim() : '';
    const s: Series = { name: header || `Series ${series.length + 1}`, values };
    if (fmt) s.fmt = fmt;
    series.push(s);
  }
  const data: ChartData = { labels, x, xDate, series, every, total };
  if (xFmt) data.xFmt = xFmt;
  return data;
}

/** The title a new chart is given: the name of its one series, or none when there are several. */
export function defaultTitle(data: ChartData, o: Pick<ReadOptions, 'headers'>): string | undefined {
  return data.series.length === 1 && o.headers ? data.series[0]!.name : undefined;
}
