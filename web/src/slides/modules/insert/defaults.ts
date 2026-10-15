/**
 * What a new shape, text box, line, table, chart or picture looks like when it is inserted, and
 * where it lands: plain values, so each is tested without a page and the same ones serve a click,
 * a drag, the command box and a keyboard that cannot drag.
 *
 * A new shape is drawn from the theme and not from a fixed colour, so it follows a theme change
 * and its text is readable on it: a tint of the first accent on a light theme and a shade of it on a
 * dark one (`insert.test.ts` computes the contrast in every theme). A line takes the accent.
 *
 * Pure: no DOM.
 */

import type { ChartElement, Fill, Line, LineElement, ShapeElement, ShapeKind, TableElement, TextDoc, ThemeJSON } from '../../model/deck';
import { emptyText } from '../../model/schema';
import { lookOf } from '../../themes/themes';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Slide px: the pointer must move this far for a press to be a drag and not a click. */
export const MIN_DRAW = 12;
/** Slide px: the least a dragged shape is, so a drag that was almost level is still something to see and grab. */
export const MIN_SIDE = 16;

// ── where it goes ───────────────────────────────────────────────────────────

/** How a shape is placed: in the middle, centred on a click, or filling a dragged rectangle. */
export type Placement = { kind: 'centre' } | { kind: 'click'; at: Pt } | { kind: 'drag'; rect: Rect };

/** A box of `size` kept inside the slide, which is smaller than the box when the box is larger. */
export function within(box: Rect, bounds: Size): Rect {
  const w = Math.min(box.w, bounds.w);
  const h = Math.min(box.h, bounds.h);
  return { x: Math.round(Math.max(0, Math.min(bounds.w - w, box.x))), y: Math.round(Math.max(0, Math.min(bounds.h - h, box.y))), w: Math.round(w), h: Math.round(h) };
}

/** The rectangle a placement means for something of `size`, on a slide of `bounds`. */
export function rectFor(p: Placement, size: Size, bounds: Size): Rect {
  switch (p.kind) {
    case 'drag':
      return within({ ...p.rect, w: Math.max(MIN_SIDE, p.rect.w), h: Math.max(MIN_SIDE, p.rect.h) }, bounds);
    case 'click':
      return within({ x: p.at.x - size.w / 2, y: p.at.y - size.h / 2, ...size }, bounds);
    default:
      return within({ x: (bounds.w - size.w) / 2, y: (bounds.h - size.h) / 2, ...size }, bounds);
  }
}

/** The rectangle between two corners, whichever way they were dragged. Shift keeps it square. */
export function rectBetween(a: Pt, b: Pt, square = false): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/** Whether a drag went far enough to be one. */
export const isDrag = (a: Pt, b: Pt): boolean => Math.hypot(b.x - a.x, b.y - a.y) >= MIN_DRAW;

/** `b` pulled onto the nearest 15 degrees about `a`: Shift while drawing a line. */
export function snapAngle(a: Pt, b: Pt, step = 15): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return b;
  const snapped = (Math.round(Math.atan2(dy, dx) / ((step * Math.PI) / 180)) * step * Math.PI) / 180;
  return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
}

// ── shapes ──────────────────────────────────────────────────────────────────

const SQUARE: Size = { w: 288, h: 288 };
const WIDE: Size = { w: 360, h: 216 };

/** The size a shape is when it is clicked into place, slide px (a 2 in square, or near it). */
export function defaultSize(kind: ShapeKind): Size {
  switch (kind) {
    case 'rect':
    case 'roundRect':
    case 'parallelogram':
    case 'trapezoid':
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout':
    case 'bracketPair':
    case 'bracePair':
      return WIDE;
    case 'rightArrow':
    case 'leftArrow':
    case 'leftRightArrow':
      return { w: 360, h: 180 };
    case 'upArrow':
    case 'downArrow':
      return { w: 180, h: 360 };
    case 'chevron':
    case 'homePlate':
      return { w: 288, h: 180 };
    case 'cloud':
      return { w: 360, h: 240 };
    case 'can':
      return { w: 216, h: 288 };
    default:
      return SQUARE;
  }
}

/** The fill and outline of a new shape in `theme`. */
export function shapeStyle(theme: ThemeJSON): { fill: Fill; line: Line } {
  const dark = lookOf(theme).dark;
  return {
    fill: { kind: 'solid', color: { theme: 'accent1', lum: dark ? -0.5 : 0.8 } },
    line: { color: { theme: 'accent1' }, width: 3 }
  };
}

/** One empty paragraph, centred: the text a new shape starts with. */
export const centredText = (): TextDoc => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { align: 'center' } }] });

export function newShape(kind: ShapeKind, rect: Rect, theme: ThemeJSON): ShapeElement {
  const { fill, line } = shapeStyle(theme);
  return {
    type: 'shape',
    shape: kind,
    ...rect,
    fill,
    line,
    text: centredText(),
    textBox: { anchor: 'middle', wrap: true, autofit: 'none' }
  };
}

/** The size of a text box that is clicked into place: one line of body type, wide enough for a sentence. */
export const TEXT_BOX_SIZE: Size = { w: 600, h: 80 };
/** The least a text box is tall: a line of 20 pt type and its margins. */
export const MIN_TEXT_HEIGHT = 64;

export function newTextBox(rect: Rect): ShapeElement {
  return { type: 'shape', shape: 'rect', ...rect, text: emptyText(), textBox: { wrap: true, autofit: 'none' } };
}

// ── lines ───────────────────────────────────────────────────────────────────

export const LINE_LENGTH = 400;
export const LINE_WIDTH = 4;

export interface LineSpec {
  /** Where the line starts and ends: the arrow, when there is one, is at `to`. */
  from: Pt;
  to: Pt;
}

/** The line a placement means: a click is a level line through the point, a drag is its two ends. */
export function lineFor(p: Placement | { kind: 'ends'; from: Pt; to: Pt }, bounds: Size): LineSpec {
  if (p.kind === 'ends') return { from: p.from, to: p.to };
  const half = LINE_LENGTH / 2;
  const at = p.kind === 'click' ? p.at : { x: bounds.w / 2, y: bounds.h / 2 };
  const x0 = Math.max(0, Math.min(bounds.w - LINE_LENGTH, at.x - half));
  const y = Math.max(0, Math.min(bounds.h, at.y));
  return { from: { x: x0, y }, to: { x: x0 + LINE_LENGTH, y } };
}

export function newLine(spec: LineSpec, arrow: boolean): LineElement {
  const { from, to } = spec;
  const flipH = from.x > to.x;
  const flipV = from.y > to.y;
  return {
    type: 'line',
    x: Math.round(Math.min(from.x, to.x)),
    y: Math.round(Math.min(from.y, to.y)),
    w: Math.round(Math.abs(to.x - from.x)),
    h: Math.round(Math.abs(to.y - from.y)),
    ...(flipH ? { flipH } : {}),
    ...(flipV ? { flipV } : {}),
    line: { color: { theme: 'accent1' }, width: LINE_WIDTH, ...(arrow ? { tail: 'arrow' as const } : {}) }
  };
}

// ── charts ──────────────────────────────────────────────────────────────────

export type ChartKind = ChartElement['chart'];
export const CHART_KINDS: readonly ChartKind[] = ['column', 'bar', 'line', 'pie', 'scatter'];
export const CHART_NAMES: Record<ChartKind, string> = { column: 'Column', bar: 'Bar', line: 'Line', pie: 'Pie', scatter: 'Scatter' };

export const CHART_SIZE: Size = { w: 1000, h: 560 };

/** Data a new chart has, so there is something to see and to edit. */
export function sampleChart(kind: ChartKind): Pick<ChartElement, 'chart' | 'categories' | 'series'> {
  switch (kind) {
    case 'pie':
      return { chart: kind, categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Sales', values: [8.2, 3.2, 1.4, 1.2] }] };
    case 'scatter':
      return { chart: kind, categories: ['1', '2', '3', '4', '5', '6'], series: [{ name: 'Series 1', values: [2.1, 3.9, 3.1, 5.4, 4.8, 6.7] }] };
    default:
      return {
        chart: kind,
        categories: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [
          { name: 'Series 1', values: [4.3, 2.5, 3.5, 4.5] },
          { name: 'Series 2', values: [2.4, 4.4, 1.8, 2.8] }
        ]
      };
  }
}

export function newChart(kind: ChartKind, rect: Rect): ChartElement {
  return { type: 'chart', ...rect, ...sampleChart(kind) };
}

// ── tables ──────────────────────────────────────────────────────────────────

export const TABLE_MAX = { rows: 8, cols: 10 } as const;
export const TABLE_WIDTH = 1612;
export const ROW_HEIGHT = 64;

/** A table of empty cells, as wide as the layouts' content and centred, with its header row and bands on. */
export function newTable(rows: number, cols: number, bounds: Size): TableElement {
  const r = Math.max(1, Math.min(TABLE_MAX.rows, Math.round(rows)));
  const c = Math.max(1, Math.min(TABLE_MAX.cols, Math.round(cols)));
  const w = Math.min(TABLE_WIDTH, bounds.w);
  const each = Math.floor((w / c) * 100) / 100;
  const widths = Array.from({ length: c }, () => each);
  const total = Math.round(each * c * 100) / 100;
  const h = r * ROW_HEIGHT;
  return {
    type: 'table',
    x: Math.round((bounds.w - total) / 2),
    y: Math.max(0, Math.round((bounds.h - h) / 2)),
    w: total,
    h,
    cols: widths,
    rows: Array.from({ length: r }, () => ({ h: ROW_HEIGHT, cells: Array.from({ length: c }, () => ({ text: emptyText() })) })),
    firstRow: true,
    bandRows: true
  };
}

// ── pictures ────────────────────────────────────────────────────────────────

/** A picture is first as large as it is, up to this share of the slide each way. */
const PICTURE_SHARE = 0.7;

/** The size a picture of `natural` pixels is first shown at, kept in proportion and centred on the slide. */
export function fitPicture(natural: Size, bounds: Size): Rect {
  const nw = Math.max(1, natural.w);
  const nh = Math.max(1, natural.h);
  const k = Math.min(1, (bounds.w * PICTURE_SHARE) / nw, (bounds.h * PICTURE_SHARE) / nh);
  const w = Math.max(8, Math.round(nw * k));
  const h = Math.max(8, Math.round(nh * k));
  return { x: Math.round((bounds.w - w) / 2), y: Math.round((bounds.h - h) / 2), w, h };
}

/** A file's name as alt text: no extension, and `-` and `_` read as spaces. */
export const altFromName = (name: string): string => name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[-_]+/g, ' ').trim();
