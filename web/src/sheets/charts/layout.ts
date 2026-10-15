/**
 * A chart's geometry: where every mark, rule, label and legend entry goes, as plain numbers.
 *
 * `layoutChart` is a function of the chart's settings, its data and its size, and of nothing
 * else (text is measured through an injected `Measure`), so it runs the same in the page and in a
 * test, and `render.tsx` has nothing to decide. The same numbers drive the tween between two
 * versions of a chart (animate.ts): a mark that exists in both is moved from one to the other.
 *
 * Sizes are CSS pixels at 100%, in the card's own coordinates: the zoom is a transform on the card.
 * The card's padding is the board's (16px above, 18px at the sides, 14px below); the marks follow
 * the data-viz rules: a 2px line, a bar with a 4px rounded end and 2px of air between neighbours,
 * markers with a 2px ring, hairline gridlines, a legend whenever there are two series.
 */

import { formatValue } from '../engine';
import type { Measure } from '../model/measure';
import { INK, colorFor, onFill } from './palette';
import { dateTicks, decimalsOf, valueTicks, type Ticks } from './ticks';
import type { ChartData, ChartOptions, ChartSpec, ChartType, LegendPosition } from './types';

export const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

/** The smallest a chart may be drawn, and be resized to. */
export const MIN_W = 180;
export const MIN_H = 130;
export const DEFAULT_W = 420;
export const DEFAULT_H = 280;

const PAD = { t: 16, r: 18, b: 14, l: 18 };
const TITLE_H = 22;
const TITLE_GAP = 12;
const LEGEND_ROW = 18;
const LEGEND_GAP = 10;
const AXIS_TITLE = 16;
const TICK = 12;
const BAND_GAP = 2;
const SWATCH = 10;
const LEGEND_FONT = 12;
/** More points than this and a line has no markers: they would be a beaded rope. */
const MARKER_LIMIT = 24;
/** A scatter of more points than this has no hover targets: the nearest-point layer would be the page's heaviest part. */
const HIT_LIMIT = 800;

// ── the geometry ────────────────────────────────────────────────────────────

export interface TextEl {
  key: string;
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  size: number;
  weight: number;
  fill: string;
  mono?: boolean;
  /** Degrees about (x, y). */
  rotate?: number;
}

export interface RuleEl {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
}

/** A bar or a column. `base` is the side it grows from, which is the origin of its tween. */
export interface RectMark {
  kind: 'rect';
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  /** The end that is rounded: the data end, never the baseline. */
  round: 'up' | 'down' | 'left' | 'right' | 'none';
  base: 'bottom' | 'top' | 'left' | 'right';
  /** Touching segments of a stack are parted by a stroke in the surface colour. */
  gap: boolean;
}

/** A line, or an area's upper edge. `pts` is x, y, x, y …; NaN is a gap in the data. */
export interface LineMark {
  kind: 'line';
  key: string;
  pts: number[];
  color: string;
  /** For an area: the lower edge, y per point, drawn as a wash under the line. */
  floor?: number[];
}

export interface DotMark {
  kind: 'dot';
  key: string;
  x: number;
  y: number;
  r: number;
  fill: string;
  /** 0 circle, 1 square, 2 diamond, 3 triangle: a second channel beside the colour. */
  shape: number;
}

export interface SliceMark {
  kind: 'slice';
  key: string;
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  /** Radians, clockwise from twelve o'clock. */
  a0: number;
  a1: number;
  fill: string;
  tip: number;
}

export type Mark = RectMark | LineMark | DotMark | SliceMark;

export interface LegendEl {
  key: string;
  x: number;
  y: number;
  text: string;
  color: string;
  /** A swatch for areas, bars and slices; a short line for a line; a dot for a scatter. */
  shape: 'swatch' | 'line' | 'dot';
  /** The mark's own shape (DotMark.shape), for a legend that mirrors it. */
  mark: number;
}

export interface TipRow {
  color?: string;
  name: string;
  value: string;
}

export interface Tip {
  title: string;
  rows: TipRow[];
}

/** An area that answers a pointer with `tips[tip]`; `guide` is where a vertical hairline goes while it does. */
export type HitEl =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; tip: number; guide?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; tip: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChartGeom {
  w: number;
  h: number;
  type: ChartType;
  plot: Box;
  rules: RuleEl[];
  marks: Mark[];
  texts: TextEl[];
  legend: LegendEl[];
  hits: HitEl[];
  tips: Tip[];
  /** Set when there is nothing to draw: the card says it instead. */
  empty: string | null;
  /** A sentence for a screen reader. */
  summary: string;
}

// ── what a chart is, resolved ───────────────────────────────────────────────

export interface ChartInput {
  type: ChartType;
  title: string;
  legend: LegendPosition;
  stacked: boolean;
  xTitle: string;
  yTitle: string;
  yMin?: number;
  yMax?: number;
  xMin?: number;
  xMax?: number;
  /** One per series, or per category for a pie. */
  colors: string[];
  data: ChartData;
}

export const isPie = (t: ChartType): boolean => t === 'pie' || t === 'doughnut';

/** The legend a chart has when nothing was chosen. */
export function effectiveLegend(type: ChartType, series: number, chosen?: ChartOptions['legend']): LegendPosition {
  if (chosen) return chosen;
  if (isPie(type)) return 'right';
  return series >= 2 ? 'bottom' : 'none';
}

/** What the layout needs from a stored chart: defaults filled in, colours chosen. */
export function resolveInput(spec: Pick<ChartSpec, 'type' | 'title' | 'options'>, data: ChartData): ChartInput {
  const o = spec.options ?? {};
  const type = spec.type;
  const n = isPie(type) ? data.labels.length : data.series.length;
  const input: ChartInput = {
    type,
    title: spec.title ?? '',
    legend: effectiveLegend(type, data.series.length, o.legend),
    stacked: o.stacked === true && (type === 'column' || type === 'bar' || type === 'area'),
    xTitle: o.xTitle ?? '',
    yTitle: o.yTitle ?? '',
    colors: Array.from({ length: n }, (_, i) => colorFor(i, o.colors)),
    data
  };
  if (o.yMin !== undefined) input.yMin = o.yMin;
  if (o.yMax !== undefined) input.yMax = o.yMax;
  if (o.xMin !== undefined) input.xMin = o.xMin;
  if (o.xMax !== undefined) input.xMax = o.xMax;
  return input;
}

// ── small helpers ───────────────────────────────────────────────────────────

const font = (px: number, weight = 400, mono = false): string => `${weight === 600 ? '600 ' : ''}${px}px ${mono ? MONO : SANS}`;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** `text` cut to fit `max` px at `f`, with an ellipsis. */
function fit(text: string, max: number, f: string, m: Measure): string {
  if (m.width(f, text) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (m.width(f, `${text.slice(0, mid)}…`) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : '…';
}

/**
 * What a number reads as under a format code. Without one the thousands are grouped, so a tooltip
 * says 61,900 where the cell says 61900.
 */
export const formatNumber = (v: number, fmt: string | undefined): string =>
  formatValue(v, fmt && fmt.trim() !== '' && !/^general$/i.test(fmt.trim()) ? fmt : Number.isInteger(v) ? '#,##0' : '#,##0.######').text;

/** `code` with `d` digits after the point in its first digit placeholder run (and the same in each section). */
function withDigits(code: string, d: number): string {
  return code
    .split(';')
    .map((section) => {
      // Quoted text is left alone: a "0" in a label is not a digit.
      const parts = section.split(/("[^"]*")/);
      for (let k = 0; k < parts.length; k += 2) {
        const m = /([0#?][0#?,]*)(\.[0#?]*)?/.exec(parts[k]!);
        if (m) {
          parts[k] = parts[k]!.replace(m[0], `${m[1]}.${'0'.repeat(d)}`);
          break;
        }
      }
      return parts.join('');
    })
    .join(';');
}

/**
 * A format for tick labels. The cells' own when it keeps the step's digits; otherwise one that does,
 * so a step of 0.5 under `£#,##0` reads £0.5 and £1.0, not £1, £1, £2. No format at all groups the
 * thousands, so an axis of 1,000,000 stays legible.
 */
export function tickFormatter(step: number, fmt: string | undefined): (v: number) => string {
  const d = decimalsOf(step);
  const own = fmt && fmt.trim() !== '' && !/^general$/i.test(fmt.trim()) ? fmt : undefined;
  if (own) {
    const section = own.split(';')[0]!.replace(/"[^"]*"/g, '');
    const has = (/\.([0#?]+)/.exec(section)?.[1] ?? '').length;
    if (has >= d || /%/.test(section)) return (v) => formatValue(v, own).text;
    const patched = withDigits(own, d);
    return (v) => formatValue(v, patched).text;
  }
  const code = d > 0 ? `#,##0.${'0'.repeat(d)}` : '#,##0';
  return (v) => formatValue(v, code).text;
}

/** A marker's outline as a path: the shapes that tell series apart without colour. */
export function dotPath(shape: number, x: number, y: number, r: number): string {
  switch (shape % 4) {
    case 1:
      return `M${x - r} ${y - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    case 2:
      return `M${x} ${y - r * 1.25}L${x + r * 1.25} ${y}L${x} ${y + r * 1.25}L${x - r * 1.25} ${y}z`;
    case 3:
      return `M${x} ${y - r * 1.2}L${x + r * 1.15} ${y + r * 0.85}L${x - r * 1.15} ${y + r * 0.85}z`;
    default:
      return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  }
}

// ── the legend ──────────────────────────────────────────────────────────────

interface LegendItem {
  text: string;
  color: string;
  shape: LegendEl['shape'];
  mark: number;
}

function legendItems(i: ChartInput): LegendItem[] {
  const shape: LegendEl['shape'] = i.type === 'line' ? 'line' : i.type === 'scatter' ? 'dot' : 'swatch';
  const names = isPie(i.type) ? i.data.labels : i.data.series.map((s) => s.name);
  return names.map((text, n) => ({ text, color: i.colors[n]!, shape, mark: n }));
}

const itemWidth = (it: LegendItem, text: string, m: Measure): number => (it.shape === 'line' ? 18 : SWATCH) + 6 + m.width(font(LEGEND_FONT), text);

// ── the layout ──────────────────────────────────────────────────────────────

export function layoutChart(input: ChartInput, size: { w: number; h: number }, m: Measure): ChartGeom {
  const w = Math.max(MIN_W, size.w);
  const h = Math.max(MIN_H, size.h);
  const g: ChartGeom = {
    w,
    h,
    type: input.type,
    plot: { x: PAD.l, y: PAD.t, w: w - PAD.l - PAD.r, h: h - PAD.t - PAD.b },
    rules: [],
    marks: [],
    texts: [],
    legend: [],
    hits: [],
    tips: [],
    empty: null,
    summary: summaryOf(input)
  };
  const pie = isPie(input.type);
  const plotted = pie
    ? (input.data.series[0]?.values.some((v) => v !== null && v > 0) ?? false)
    : input.data.series.some((s) => s.values.some((v) => v !== null));
  if (!plotted) g.empty = 'Nothing to plot.';

  // The frame the plot fits in: the title, the legend and the axis titles take their strips first.
  let top = PAD.t;
  let bottom = h - PAD.b;
  const left = PAD.l;
  let right = w - PAD.r;

  if (input.title) {
    g.texts.push({ key: 'title', x: left, y: top + 14, text: fit(input.title, right - left, font(14, 600), m), anchor: 'start', size: 14, weight: 600, fill: INK.title });
    top += TITLE_H + TITLE_GAP;
  }

  const items = input.legend === 'none' || g.empty ? [] : legendItems(input);
  // A legend that would take more than a third of the card is left out: a chart nobody can read helps nobody, and the card can be made bigger.
  const roomy = (taken: number, whole: number): boolean => taken <= whole / 3;
  if (items.length && input.legend === 'right') {
    const text = items.map((it) => fit(it.text, Math.max(40, (right - left) * 0.3), font(LEGEND_FONT), m));
    const width = Math.max(...items.map((it, n) => itemWidth(it, text[n]!, m)));
    if (!roomy(width + 18, right - left)) items.length = 0;
  }
  if (items.length && input.legend === 'right') {
    const text = items.map((it) => fit(it.text, Math.max(40, (right - left) * 0.3), font(LEGEND_FONT), m));
    const width = Math.max(...items.map((it, n) => itemWidth(it, text[n]!, m)));
    const x0 = right - width;
    const y0 = Math.max(top, top + (bottom - top - items.length * LEGEND_ROW) / 2);
    items.forEach((it, n) => g.legend.push({ key: `l${n}`, x: round2(x0), y: round2(y0 + n * LEGEND_ROW + LEGEND_ROW / 2), text: text[n]!, color: it.color, shape: it.shape, mark: it.mark }));
    right = x0 - 18;
  } else if (items.length) {
    // Rows of entries, as many as it takes, each centred.
    const avail = right - left;
    const text = items.map((it) => fit(it.text, Math.max(60, avail * 0.45), font(LEGEND_FONT), m));
    const rows: { i: number; w: number }[][] = [[]];
    let used = 0;
    items.forEach((it, n) => {
      const wd = itemWidth(it, text[n]!, m);
      if (rows[rows.length - 1]!.length > 0 && used + 16 + wd > avail) {
        rows.push([]);
        used = 0;
      }
      const cur = rows[rows.length - 1]!;
      used += (cur.length ? 16 : 0) + wd;
      cur.push({ i: n, w: wd });
    });
    const height = rows.length * LEGEND_ROW;
    if (roomy(height + LEGEND_GAP, bottom - top)) {
      const y0 = input.legend === 'top' ? top : bottom - height;
      rows.forEach((row, ri) => {
        let x = left + (avail - (sum(row.map((e) => e.w)) + 16 * (row.length - 1))) / 2;
        for (const e of row) {
          const it = items[e.i]!;
          g.legend.push({ key: `l${e.i}`, x: round2(x), y: round2(y0 + ri * LEGEND_ROW + LEGEND_ROW / 2), text: text[e.i]!, color: it.color, shape: it.shape, mark: it.mark });
          x += e.w + 16;
        }
      });
      if (input.legend === 'top') top += height + LEGEND_GAP;
      else bottom -= height + LEGEND_GAP;
    }
  }

  if (g.empty) g.plot = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  else if (pie) layoutPie(g, input, { x: left, y: top, w: Math.max(20, right - left), h: Math.max(20, bottom - top) });
  else layoutAxes(g, input, { left, top, right, bottom }, m);
  return g;
}

function summaryOf(i: ChartInput): string {
  const kind = { column: 'Column chart', bar: 'Bar chart', line: 'Line chart', area: 'Area chart', pie: 'Pie chart', doughnut: 'Doughnut chart', scatter: 'Scatter chart' }[i.type];
  const title = i.title ? `, ${i.title}` : '';
  const points = i.data.labels.length;
  if (isPie(i.type)) return `${kind}${title}, ${points} ${points === 1 ? 'slice' : 'slices'}`;
  const n = i.data.series.length;
  return `${kind}${title}, ${n} ${n === 1 ? 'series' : 'series'}, ${points} ${points === 1 ? 'point' : 'points'}`;
}

// ── pie and doughnut ────────────────────────────────────────────────────────

function layoutPie(g: ChartGeom, i: ChartInput, area: Box): void {
  const s = i.data.series[0]!;
  const doughnut = i.type === 'doughnut';
  const slices = s.values.map((v, n) => ({ n, v: v !== null && v > 0 ? v : 0 })).filter((x) => x.v > 0);
  const total = sum(slices.map((x) => x.v));
  const r = Math.max(10, Math.min(area.w, area.h) / 2 - 2);
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const r0 = doughnut ? r * 0.58 : 0;
  g.plot = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  let a = 0;
  for (const sl of slices) {
    const share = sl.v / total;
    const span = share * Math.PI * 2;
    const color = i.colors[sl.n]!;
    const tip = g.tips.length;
    g.tips.push({
      title: i.data.labels[sl.n] ?? '',
      rows: [
        { color, name: s.name, value: formatNumber(sl.v, s.fmt) },
        { name: 'Share', value: `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%` }
      ]
    });
    g.marks.push({ kind: 'slice', key: `p${sl.n}`, cx, cy, r0, r1: r, a0: a, a1: a + span, fill: color, tip });
    // A percentage inside the slice when there is room for it: white or ink by the fill.
    if (share >= 0.06 && r - r0 > 28) {
      const mid = a + span / 2;
      const rr = (r + r0) / 2;
      g.texts.push({
        key: `pl${sl.n}`,
        x: round2(cx + Math.sin(mid) * rr),
        y: round2(cy - Math.cos(mid) * rr + 4),
        text: `${Math.round(share * 100)}%`,
        anchor: 'middle',
        size: 11,
        weight: 600,
        fill: onFill(color),
        mono: true
      });
    }
    a += span;
  }
}

// ── axes: column, bar, line, area, scatter ──────────────────────────────────

interface Frame {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const lastOf = (series: ChartData['series'], c: number, sign: 1 | -1): number => {
  for (let s = series.length - 1; s >= 0; s--) {
    const v = series[s]!.values[c];
    if (v !== null && v !== undefined && Math.sign(v) === sign) return s;
  }
  return -1;
};

function tipFor(g: ChartGeom, i: ChartInput, c: number): number {
  const rows: TipRow[] = [];
  i.data.series.forEach((s, si) => {
    const v = s.values[c];
    if (v !== null && v !== undefined) rows.push({ color: i.colors[si]!, name: s.name, value: formatNumber(v, s.fmt) });
  });
  g.tips.push({ title: i.data.labels[c] ?? '', rows });
  return g.tips.length - 1;
}

/** One hit area per category, answering with every series at it. */
function categoryHits(g: ChartGeom, i: ChartInput, box: (c: number) => Box, guide?: (c: number) => number): void {
  for (let c = 0; c < i.data.labels.length; c++) {
    if (!i.data.series.some((s) => s.values[c] !== null && s.values[c] !== undefined)) continue;
    const b = box(c);
    const hit: HitEl = { kind: 'rect', x: round2(b.x), y: round2(b.y), w: round2(b.w), h: round2(b.h), tip: tipFor(g, i, c) };
    if (guide) hit.guide = round2(guide(c));
    g.hits.push(hit);
  }
}

/** A value at the end of each bar when there is one series and a handful of bars, as the board draws them. */
function valueLabels(
  g: ChartGeom,
  s: ChartData['series'][number],
  at: (c: number, v: number) => { x: number; y: number; anchor: TextEl['anchor'] },
  m: Measure,
  room: number
): void {
  s.values.forEach((v, c) => {
    if (v === null) return;
    const text = formatNumber(v, s.fmt);
    // A label that does not fit is left to the tooltip, not cropped.
    if (m.width(font(11, 400, true), text) > room - 6) return;
    const p = at(c, v);
    g.texts.push({ key: `vl${c}`, x: round2(p.x), y: round2(p.y), text, anchor: p.anchor, size: 11, weight: 400, fill: INK.text, mono: true });
  });
}

function layoutAxes(g: ChartGeom, i: ChartInput, f: Frame, m: Measure): void {
  const type = i.type;
  const horizontal = type === 'bar';
  const scatter = type === 'scatter';
  const data = i.data;
  const series = data.series;
  const n = data.labels.length;
  const stacked = i.stacked;
  const timeAxis = !scatter && !horizontal && (type === 'line' || type === 'area') && data.xDate && data.x !== null;
  const vfmt = series.find((s) => s.fmt)?.fmt;

  // Axis titles take a strip at the left and at the bottom.
  const titleLeft = i.yTitle ? AXIS_TITLE + 6 : 0;
  const titleBottom = i.xTitle ? AXIS_TITLE + 6 : 0;

  // ── the value domain ──
  const sums = (sign: 1 | -1): number[] => {
    const out = new Array<number>(n).fill(0);
    for (const s of series) s.values.forEach((v, k) => v !== null && Math.sign(v) === sign && (out[k]! += v));
    return out;
  };
  let lo = Infinity;
  let hi = -Infinity;
  if (stacked) {
    for (const v of sums(1)) hi = Math.max(hi, v);
    for (const v of sums(-1)) lo = Math.min(lo, v);
  } else {
    for (const s of series) {
      for (const v of s.values) {
        if (v === null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = Math.max(1, lo);
  const domain = { zero: type === 'column' || type === 'bar' || type === 'area', tight: scatter, fixedMin: i.yMin, fixedMax: i.yMax };

  // The plot's top and bottom, whichever way it is oriented: tick labels sit in a strip under it.
  const plotTop = f.top + 4;
  const plotBottom = f.bottom - titleBottom - (TICK + 8);
  const plotH = Math.max(20, plotBottom - plotTop);
  const catLabels = data.labels.map((t) => fit(t, horizontal ? 110 : 140, font(TICK), m));

  let plotLeft: number;
  let vt: Ticks | null = null;
  let vFormat: (v: number) => string = (v) => formatNumber(v, vfmt);
  if (horizontal) {
    // Categories run down the left; their widest label is the margin.
    plotLeft = f.left + titleLeft + Math.min(120, Math.max(0, ...catLabels.map((t) => m.width(font(TICK), t)))) + 8;
  } else {
    vt = valueTicks(lo, hi, domain, Math.max(2, Math.min(9, Math.round(plotH / 44) + 1)));
    vFormat = tickFormatter(vt.step, vfmt);
    plotLeft = f.left + titleLeft + Math.max(0, ...vt.values.map((v) => m.width(font(TICK), vFormat(v)))) + 10;
  }
  // The bar chart's value labels sit under the plot, centred on their ticks: the last one reaches past it by half its width.
  let lastLabel = 0;
  if (horizontal) {
    const t0 = valueTicks(lo, hi, domain, 5);
    lastLabel = m.width(font(TICK), tickFormatter(t0.step, vfmt)(t0.max)) / 2;
  }
  const plotW = Math.max(20, f.right - Math.max(4, lastLabel - (PAD.r - 4)) - plotLeft);
  g.plot = { x: round2(plotLeft), y: round2(plotTop), w: round2(plotW), h: round2(plotH) };

  if (i.yTitle) {
    g.texts.push({ key: 'ytitle', x: f.left + 11, y: round2(plotTop + plotH / 2), text: fit(i.yTitle, plotH, font(12), m), anchor: 'middle', size: 12, weight: 400, fill: INK.text, rotate: -90 });
  }
  if (i.xTitle) {
    g.texts.push({ key: 'xtitle', x: round2(plotLeft + plotW / 2), y: f.bottom - 3, text: fit(i.xTitle, plotW, font(12), m), anchor: 'middle', size: 12, weight: 400, fill: INK.text });
  }

  const tickY = plotBottom + TICK + 6;

  // ── bar: the value axis runs along the bottom, categories down the left ──
  if (horizontal) {
    const tk = valueTicks(lo, hi, domain, Math.max(2, Math.min(9, Math.round(plotW / 80) + 1)));
    const fmtTick = tickFormatter(tk.step, vfmt);
    const span = tk.max - tk.min || 1;
    const px = (v: number) => plotLeft + ((v - tk.min) / span) * plotW;
    const zeroX = px(Math.max(tk.min, Math.min(tk.max, 0)));
    tk.values.forEach((v, k) => {
      const x = px(v);
      g.rules.push({ key: `gx${k}`, x1: round2(x), y1: plotTop, x2: round2(x), y2: plotBottom, stroke: INK.grid });
      g.texts.push({ key: `tx${k}`, x: round2(x), y: tickY, text: fmtTick(v), anchor: 'middle', size: TICK, weight: 400, fill: INK.text });
    });
    g.rules.push({ key: 'axis', x1: round2(zeroX), y1: plotTop, x2: round2(zeroX), y2: plotBottom, stroke: INK.axis });

    const slot = plotH / Math.max(1, n);
    const k = series.length;
    const group = Math.min(slot * 0.72, 56 * k + BAND_GAP * (k - 1));
    const thick = Math.max(1, stacked ? Math.min(group, 56) : (group - BAND_GAP * (k - 1)) / k);
    const every = Math.max(1, Math.ceil(16 / Math.max(slot, 1)));
    catLabels.forEach((t, c) => {
      if (c % every === 0) g.texts.push({ key: `cat${c}`, x: round2(plotLeft - 8), y: round2(plotTop + slot * (c + 0.5) + 4), text: t, anchor: 'end', size: TICK, weight: 400, fill: INK.text });
    });
    const pos = new Array<number>(n).fill(0);
    const neg = new Array<number>(n).fill(0);
    series.forEach((s, si) => {
      s.values.forEach((v, c) => {
        if (v === null) return;
        const used = stacked ? thick : thick * k + BAND_GAP * (k - 1);
        const y = plotTop + slot * c + (slot - used) / 2 + (stacked ? 0 : si * (thick + BAND_GAP));
        let x0 = zeroX;
        let x1 = px(v);
        if (stacked) {
          const run = v >= 0 ? pos : neg;
          x0 = px(run[c]!);
          run[c]! += v;
          x1 = px(run[c]!);
        }
        g.marks.push({
          kind: 'rect',
          key: `r${si}.${c}`,
          x: round2(Math.min(x0, x1)),
          y: round2(y),
          w: round2(Math.abs(x1 - x0)),
          h: round2(thick),
          fill: i.colors[si]!,
          round: !stacked || lastOf(series, c, v >= 0 ? 1 : -1) === si ? (v >= 0 ? 'right' : 'left') : 'none',
          base: v >= 0 ? 'left' : 'right',
          gap: stacked
        });
      });
    });
    categoryHits(g, i, (c) => ({ x: plotLeft, y: plotTop + slot * c, w: plotW, h: slot }));
    if (series.length === 1 && n <= 8) valueLabels(g, series[0]!, (c, v) => ({ x: px(v) + (v >= 0 ? 6 : -6), y: plotTop + slot * (c + 0.5) + 4, anchor: v >= 0 ? 'start' : 'end' }), m, Infinity);
    return;
  }

  // ── the vertical value axis ──
  const tk = vt!;
  const span = tk.max - tk.min || 1;
  const py = (v: number) => plotTop + plotH - ((v - tk.min) / span) * plotH;
  const baseY = py(Math.max(tk.min, Math.min(tk.max, 0)));
  tk.values.forEach((v, k) => {
    g.rules.push({ key: `gy${k}`, x1: round2(plotLeft), y1: round2(py(v)), x2: round2(plotLeft + plotW), y2: round2(py(v)), stroke: INK.grid });
    g.texts.push({ key: `ty${k}`, x: round2(plotLeft - 10), y: round2(py(v) + TICK * 0.35), text: vFormat(v), anchor: 'end', size: TICK, weight: 400, fill: INK.text });
  });
  // The category axis' line is at zero where zero is on the chart, else at the bottom.
  const axisY = type === 'line' || scatter ? plotTop + plotH : baseY;
  g.rules.push({ key: 'axis', x1: round2(plotLeft), y1: round2(axisY), x2: round2(plotLeft + plotW), y2: round2(axisY), stroke: INK.axis });

  // ── the horizontal axis ──
  const slot = plotW / Math.max(1, n);
  const inset = 8;
  let xAt: (c: number) => number;
  let xTicks: { x: number; text: string }[] = [];
  let xOfValue: ((v: number) => number) | null = null;
  if (scatter || timeAxis) {
    const xs = (data.x ?? data.labels.map((_, c) => c + 1)).filter((v): v is number => v !== null);
    const xlo = i.xMin ?? (xs.length ? Math.min(...xs) : 0);
    const xhi = i.xMax ?? (xs.length ? Math.max(...xs) : 1);
    if (data.xDate) {
      const hiD = xhi === xlo ? xlo + 1 : xhi;
      const dt = dateTicks(xlo, hiD, Math.max(2, Math.round(plotW / 90)));
      xOfValue = (v) => plotLeft + inset + ((v - xlo) / (hiD - xlo)) * (plotW - 2 * inset);
      xTicks = dt.values.map((v) => ({ x: xOfValue!(v), text: formatNumber(v, dt.format) }));
    } else {
      const xt = valueTicks(xlo, xhi, { zero: false, tight: true, fixedMin: i.xMin, fixedMax: i.xMax }, Math.max(2, Math.min(10, Math.round(plotW / 80) + 1)));
      const xf = tickFormatter(xt.step, data.xFmt);
      xOfValue = (v) => plotLeft + inset + ((v - xt.min) / (xt.max - xt.min || 1)) * (plotW - 2 * inset);
      xTicks = xt.values.map((v) => ({ x: xOfValue!(v), text: xf(v) }));
      xTicks.forEach((t, k) => g.rules.push({ key: `gx${k}`, x1: round2(t.x), y1: plotTop, x2: round2(t.x), y2: round2(plotTop + plotH), stroke: INK.grid }));
    }
    xAt = (c) => (xOfValue ? xOfValue(data.x?.[c] ?? c + 1) : NaN);
  } else {
    xAt = (c) => plotLeft + slot * (c + 0.5);
    // A label that does not fit its slot is cut to it with an ellipsis, as long as there is room to read
    // a few letters; in a slot narrower than that every few labels are left out instead.
    const widest = Math.max(1, ...catLabels.map((t) => m.width(font(TICK), t)));
    let shown = catLabels;
    let every = 1;
    if (widest + 8 > slot) {
      if (slot >= 44) shown = data.labels.map((t) => fit(t, slot - 8, font(TICK), m));
      else every = Math.ceil((widest + 10) / Math.max(slot, 1));
    }
    xTicks = shown.flatMap((t, c) => (c % every === 0 ? [{ x: xAt(c), text: t }] : []));
  }
  xTicks.forEach((t, k) => g.texts.push({ key: `tx${k}`, x: round2(t.x), y: tickY, text: t.text, anchor: 'middle', size: TICK, weight: 400, fill: INK.text }));

  // ── column ──
  if (type === 'column') {
    const k = series.length;
    const group = Math.min(slot * 0.72, 64 * k + BAND_GAP * (k - 1));
    const thick = Math.max(1, stacked ? Math.min(group, 80) : (group - BAND_GAP * (k - 1)) / k);
    const pos = new Array<number>(n).fill(0);
    const neg = new Array<number>(n).fill(0);
    series.forEach((s, si) => {
      s.values.forEach((v, c) => {
        if (v === null) return;
        const used = stacked ? thick : thick * k + BAND_GAP * (k - 1);
        const x = xAt(c) - used / 2 + (stacked ? 0 : si * (thick + BAND_GAP));
        let y0 = baseY;
        let y1 = py(v);
        if (stacked) {
          const run = v >= 0 ? pos : neg;
          y0 = py(run[c]!);
          run[c]! += v;
          y1 = py(run[c]!);
        }
        g.marks.push({
          kind: 'rect',
          key: `r${si}.${c}`,
          x: round2(x),
          y: round2(Math.min(y0, y1)),
          w: round2(thick),
          h: round2(Math.abs(y1 - y0)),
          fill: i.colors[si]!,
          round: !stacked || lastOf(series, c, v >= 0 ? 1 : -1) === si ? (v >= 0 ? 'up' : 'down') : 'none',
          base: v >= 0 ? 'bottom' : 'top',
          gap: stacked
        });
      });
    });
    categoryHits(g, i, (c) => ({ x: plotLeft + slot * c, y: plotTop, w: slot, h: plotH }));
    if (series.length === 1 && n <= 8) valueLabels(g, series[0]!, (c, v) => ({ x: xAt(c), y: py(v) + (v >= 0 ? -8 : 16), anchor: 'middle' }), m, slot);
    return;
  }

  // ── line and area ──
  if (type === 'line' || type === 'area') {
    const cumulative = new Array<number>(n).fill(0);
    const tops: number[][] = [];
    series.forEach((s, si) => {
      const pts: number[] = [];
      const floor: number[] = [];
      s.values.forEach((v, c) => {
        const x = xAt(c);
        if (v === null || !Number.isFinite(x)) {
          pts.push(NaN, NaN);
          floor.push(NaN);
          return;
        }
        const from = cumulative[c]!;
        if (type === 'area' && stacked) cumulative[c]! += v;
        pts.push(round2(x), round2(type === 'area' && stacked ? py(cumulative[c]!) : py(v)));
        floor.push(round2(type === 'area' && stacked ? py(from) : baseY));
      });
      tops.push(pts);
      const mark: LineMark = { kind: 'line', key: `s${si}`, pts, color: i.colors[si]! };
      if (type === 'area') mark.floor = floor;
      g.marks.push(mark);
    });
    // Markers where there are few enough points to read, shaped by series: a second channel beside the colour.
    if (n <= MARKER_LIMIT) {
      series.forEach((s, si) => {
        s.values.forEach((v, c) => {
          const x = tops[si]![c * 2]!;
          const y = tops[si]![c * 2 + 1]!;
          if (v === null || !Number.isFinite(x)) return;
          g.marks.push({ kind: 'dot', key: `d${si}.${c}`, x, y, r: 4, fill: i.colors[si]!, shape: type === 'line' ? si : 0 });
        });
      });
    }
    if (timeAxis) {
      // One strip per point, from the middle of the gap before it to the middle of the gap after.
      const at = data.x!.map((v, c) => ({ c, x: v === null ? NaN : xAt(c) })).filter((e) => Number.isFinite(e.x));
      at.forEach((e, k) => {
        const a = k === 0 ? plotLeft : (at[k - 1]!.x + e.x) / 2;
        const b = k === at.length - 1 ? plotLeft + plotW : (e.x + at[k + 1]!.x) / 2;
        g.hits.push({ kind: 'rect', x: round2(a), y: round2(plotTop), w: Math.max(1, round2(b - a)), h: round2(plotH), tip: tipFor(g, i, e.c), guide: round2(e.x) });
      });
    } else categoryHits(g, i, (c) => ({ x: plotLeft + slot * c, y: plotTop, w: slot, h: plotH }), xAt);
    return;
  }

  // ── scatter: every point is a mark, and the nearest answers a pointer ──
  const hits = series.length * n <= HIT_LIMIT;
  series.forEach((s, si) => {
    s.values.forEach((v, c) => {
      const xv = data.x?.[c] ?? c + 1;
      if (v === null || xv === null) return;
      const x = round2(xAt(c));
      const y = round2(py(v));
      g.marks.push({ kind: 'dot', key: `d${si}.${c}`, x, y, r: 4, fill: i.colors[si]!, shape: si });
      if (!hits) return;
      g.tips.push({ title: s.name, rows: [{ name: 'x', value: formatNumber(xv, data.xFmt) }, { color: i.colors[si]!, name: 'y', value: formatNumber(v, s.fmt) }] });
      g.hits.push({ kind: 'circle', cx: x, cy: y, r: 12, tip: g.tips.length - 1 });
    });
  });
}
