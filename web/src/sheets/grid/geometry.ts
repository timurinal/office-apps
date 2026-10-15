/**
 * Where everything is. No DOM, no canvas: the grid's paint, its hit tests, its overlays and
 * its keyboard all ask this module, so they cannot disagree about where a cell is.
 *
 * Sizes arrive in CSS pixels at 100% and are multiplied by the zoom once, here. An `Axis` is
 * the prefix sums of one direction's line sizes, so finding the row under a pixel is a binary
 * search and a frame costs the same at 100 rows as at 100,000. A hidden line has size 0 and is
 * never answered.
 *
 * Frozen lines do not scroll. The scrolled pane begins at the frozen size, and `offset` is how
 * far into it the person has gone, in content pixels. The native scroll position is not the
 * offset once a sheet is taller than a browser will make an element (`scrollAxis`): the
 * spacer is capped and the scroll position scaled up to reach the end.
 */

import type { Cellpos, Rect } from './types';

/** The column header's height at 100%, from the board. */
export const HEADER_H = 26;
const ROW_HEADER_MIN = 46;

/** Browsers cap an element's height (Firefox near 17.9 million px, Chrome 33.5). This is under both. */
export const MAX_ELEMENT = 10_000_000;

/** How close to a header's edge a press has to be to take it, in screen pixels. */
export const EDGE_SLOP = 4;

export function rowHeaderWidth(rowCount: number, zoom: number): number {
  const digits = String(Math.max(1, rowCount)).length;
  return Math.max(ROW_HEADER_MIN, 14 + digits * 8) * zoom;
}

// ── one direction ───────────────────────────────────────────────────────────

export class Axis {
  private constructor(
    readonly count: number,
    readonly offsets: Float64Array
  ) {}

  /** `sizeAt` is in CSS pixels at 100%. */
  static build(count: number, sizeAt: (i: number) => number, zoom: number): Axis {
    const offsets = new Float64Array(count + 1);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      offsets[i] = sum;
      const s = sizeAt(i);
      sum += s > 0 ? s * zoom : 0;
    }
    offsets[count] = sum;
    return new Axis(count, offsets);
  }

  get total(): number {
    return this.offsets[this.count]!;
  }

  start(i: number): number {
    return this.offsets[Math.max(0, Math.min(i, this.count))]!;
  }

  end(i: number): number {
    return this.offsets[Math.max(0, Math.min(i + 1, this.count))]!;
  }

  size(i: number): number {
    return this.end(i) - this.start(i);
  }

  hidden(i: number): boolean {
    return i >= 0 && i < this.count && this.size(i) === 0;
  }

  /** The line containing `pos`, or -1 before the first and past the last. */
  indexAt(pos: number): number {
    if (this.count === 0 || pos < 0 || pos >= this.total) return -1;
    const o = this.offsets;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (o[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** As `indexAt`, but the nearest line when `pos` is outside. */
  clampedIndexAt(pos: number): number {
    if (this.count === 0) return -1;
    if (pos < 0) return this.nextVisible(0, 1);
    if (pos >= this.total) return this.nextVisible(this.count - 1, -1);
    return this.indexAt(pos);
  }

  /** `from`, or the nearest visible line after it in `dir`; the line itself if none is. */
  nextVisible(from: number, dir: 1 | -1): number {
    let i = from;
    while (i >= 0 && i < this.count && this.size(i) === 0) i += dir;
    return i < 0 || i >= this.count ? from : i;
  }
}

// ── scrolling a long axis ───────────────────────────────────────────────────

export interface ScrollAxis {
  /** The spacer's size: the scroll container's client size plus the scroll range. */
  spacer: number;
  /** Content pixels per scroll pixel. 1 until the sheet outgrows `MAX_ELEMENT`. */
  scale: number;
  /** The furthest content offset. */
  maxOffset: number;
}

export function scrollAxis(a: {
  /** The scrolled pane's content, in px: the axis total less its frozen part. */
  content: number;
  /** The scrolled pane's visible size. */
  pane: number;
  /** The scroll container's client size. */
  client: number;
  /** Extra room at the end, so the last line can clear the footer. */
  trailing?: number;
}): ScrollAxis {
  const maxOffset = Math.max(0, a.content + (a.trailing ?? 0) - a.pane);
  const room = Math.max(0, MAX_ELEMENT - a.client);
  const range = Math.min(maxOffset, room);
  return { spacer: a.client + range, scale: range > 0 ? maxOffset / range : 1, maxOffset };
}

export const scrollToOffset = (s: ScrollAxis, scroll: number): number => Math.max(0, Math.min(s.maxOffset, scroll * s.scale));
export const offsetToScroll = (s: ScrollAxis, offset: number): number => Math.max(0, Math.min(s.maxOffset, offset)) / s.scale;

// ── the whole layout ────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInput {
  rows: Axis;
  cols: Axis;
  /** A factor: 1 is 100%. */
  zoom: number;
  frozenRows: number;
  frozenCols: number;
  /** The viewport's CSS size, headers included. */
  viewW: number;
  viewH: number;
  headerW: number;
  headerH: number;
  /** Content offsets of the scrolled pane. */
  offsetX: number;
  offsetY: number;
}

export type Hit =
  | { kind: 'corner' }
  | { kind: 'colHeader'; col: number; edge: number | null }
  | { kind: 'rowHeader'; row: number; edge: number | null }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'none' };

/** The lines a pane shows: inclusive, or null when it shows none. */
export type Span = readonly [number, number] | null;

export class GridLayout {
  readonly rows: Axis;
  readonly cols: Axis;
  readonly zoom: number;
  readonly fr: number;
  readonly fc: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly headerW: number;
  readonly headerH: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** The frozen panes' sizes. */
  readonly frozenW: number;
  readonly frozenH: number;
  /** The scrolled pane's visible size. */
  readonly paneW: number;
  readonly paneH: number;

  constructor(i: LayoutInput) {
    this.rows = i.rows;
    this.cols = i.cols;
    this.zoom = i.zoom;
    this.fr = Math.min(i.frozenRows, i.rows.count);
    this.fc = Math.min(i.frozenCols, i.cols.count);
    this.viewW = i.viewW;
    this.viewH = i.viewH;
    this.headerW = i.headerW;
    this.headerH = i.headerH;
    this.offsetX = i.offsetX;
    this.offsetY = i.offsetY;
    this.frozenW = this.cols.start(this.fc);
    this.frozenH = this.rows.start(this.fr);
    this.paneW = Math.max(0, i.viewW - i.headerW - this.frozenW);
    this.paneH = Math.max(0, i.viewH - i.headerH - this.frozenH);
  }

  // Positions in the viewport's own coordinates, headers included.

  colX(c: number): number {
    return this.headerW + this.cols.start(c) - (c >= this.fc ? this.offsetX : 0);
  }

  rowY(r: number): number {
    return this.headerH + this.rows.start(r) - (r >= this.fr ? this.offsetY : 0);
  }

  cellBox(row: number, col: number): Box {
    return { x: this.colX(col), y: this.rowY(row), w: this.cols.size(col), h: this.rows.size(row) };
  }

  /** The cells a merge or a selection covers, as one box (not split by a frozen edge). */
  rectBox(r: Rect): Box {
    const x = this.colX(r.c1);
    const y = this.rowY(r.r1);
    return { x, y, w: this.colX(r.c2) + this.cols.size(r.c2) - x, h: this.rowY(r.r2) + this.rows.size(r.r2) - y };
  }

  /** Where each pane's lines begin, in content pixels. */
  private scrolledStart(axis: 'row' | 'col'): number {
    return axis === 'row' ? this.frozenH + this.offsetY : this.frozenW + this.offsetX;
  }

  /** The lines the scrolled pane shows. */
  scrolledRows(): Span {
    if (this.fr >= this.rows.count || this.paneH <= 0) return null;
    const a = this.scrolledStart('row');
    const first = this.rows.indexAt(a);
    if (first < 0) return null;
    const last = this.rows.clampedIndexAt(a + this.paneH - 1e-6);
    return [Math.max(first, this.fr), Math.max(last, first)];
  }

  scrolledCols(): Span {
    if (this.fc >= this.cols.count || this.paneW <= 0) return null;
    const a = this.scrolledStart('col');
    const first = this.cols.indexAt(a);
    if (first < 0) return null;
    const last = this.cols.clampedIndexAt(a + this.paneW - 1e-6);
    return [Math.max(first, this.fc), Math.max(last, first)];
  }

  frozenRowSpan(): Span {
    return this.fr > 0 ? [0, this.fr - 1] : null;
  }

  frozenColSpan(): Span {
    return this.fc > 0 ? [0, this.fc - 1] : null;
  }

  /** A position along one axis of the viewport as a content coordinate: past the frozen lines it is scrolled. */
  private absAt(axis: 'row' | 'col', pos: number): number {
    const rel = pos - (axis === 'col' ? this.headerW : this.headerH);
    const frozen = axis === 'col' ? this.frozenW : this.frozenH;
    return rel < frozen ? rel : rel + (axis === 'col' ? this.offsetX : this.offsetY);
  }

  /** The row at a viewport y, or -1 above the first row and below the last. */
  rowAtY(y: number): number {
    return y < this.headerH ? -1 : this.rows.indexAt(this.absAt('row', y));
  }

  colAtX(x: number): number {
    return x < this.headerW ? -1 : this.cols.indexAt(this.absAt('col', x));
  }

  /** The nearest cell to a point, for a drag that has left the grid. */
  nearest(x: number, y: number): Cellpos {
    return {
      row: this.rows.clampedIndexAt(this.absAt('row', Math.max(y, this.headerH))),
      col: this.cols.clampedIndexAt(this.absAt('col', Math.max(x, this.headerW)))
    };
  }

  hit(x: number, y: number, slop = EDGE_SLOP): Hit {
    const inRowHeader = x < this.headerW;
    const inColHeader = y < this.headerH;
    if (inRowHeader && inColHeader) return { kind: 'corner' };
    if (inColHeader) {
      const edge = this.edgeAt('col', x, slop);
      const col = this.colAtX(x);
      if (col < 0 && edge === null) return { kind: 'none' };
      return { kind: 'colHeader', col: col < 0 ? (edge ?? 0) : col, edge };
    }
    if (inRowHeader) {
      const edge = this.edgeAt('row', y, slop);
      const row = this.rowAtY(y);
      if (row < 0 && edge === null) return { kind: 'none' };
      return { kind: 'rowHeader', row: row < 0 ? (edge ?? 0) : row, edge };
    }
    const row = this.rowAtY(y);
    const col = this.colAtX(x);
    return row < 0 || col < 0 ? { kind: 'none' } : { kind: 'cell', row, col };
  }

  /** The line whose far edge is within `slop` of a position along a header, or null. */
  private edgeAt(axis: 'row' | 'col', pos: number, slop: number): number | null {
    const a = axis === 'col' ? this.cols : this.rows;
    const near = (i: number) => (axis === 'col' ? this.colX(i) : this.rowY(i));
    const frozen = axis === 'col' ? this.fc : this.fr;
    // The frozen lines end at the pane's edge, wherever the scrolled lines under it have got to.
    const pane = axis === 'col' ? this.headerW + this.frozenW : this.headerH + this.frozenH;
    if (frozen > 0 && Math.abs(pos - pane) <= slop) return a.nextVisible(frozen - 1, -1);
    const i = a.clampedIndexAt(this.absAt(axis, pos));
    if (i < 0) return null;
    if (Math.abs(pos - (near(i) + a.size(i))) <= slop) return i;
    const before = a.nextVisible(i - 1, -1);
    if (i > 0 && before < i && Math.abs(pos - near(i)) <= slop) return before;
    return null;
  }

  /**
   * The content offset that brings a line fully into the scrolled pane, or null when it is
   * already there or is frozen.
   */
  revealOffset(axis: 'row' | 'col', index: number): number | null {
    const a = axis === 'col' ? this.cols : this.rows;
    const frozen = axis === 'col' ? this.fc : this.fr;
    if (index < frozen || index >= a.count) return null;
    const frozenSize = axis === 'col' ? this.frozenW : this.frozenH;
    const pane = axis === 'col' ? this.paneW : this.paneH;
    const offset = axis === 'col' ? this.offsetX : this.offsetY;
    const start = a.start(index) - frozenSize;
    const end = a.end(index) - frozenSize;
    if (start < offset) return start;
    if (end > offset + pane) return pane >= end - start ? end - pane : start;
    return null;
  }

  /**
   * A rectangle of cells as boxes in the overlay's coordinates (the origin is the first cell
   * of the viewport, past the headers). A frozen edge cuts it into pieces so that each stays
   * in its own pane, and each piece is held near the viewport: a selection of a hundred
   * thousand rows is a box a screen tall, not two million pixels.
   */
  pieces(r: Rect): Box[] {
    const rowSegs = this.segments('row', r.r1, r.r2);
    const colSegs = this.segments('col', r.c1, r.c2);
    const out: Box[] = [];
    for (const [y1, y2] of rowSegs) {
      for (const [x1, x2] of colSegs) out.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
    return out;
  }

  private segments(axis: 'row' | 'col', from: number, to: number): [number, number][] {
    const a = axis === 'col' ? this.cols : this.rows;
    const frozen = axis === 'col' ? this.fc : this.fr;
    const frozenSize = axis === 'col' ? this.frozenW : this.frozenH;
    const offset = axis === 'col' ? this.offsetX : this.offsetY;
    const view = (axis === 'col' ? this.viewW - this.headerW : this.viewH - this.headerH) + 4;
    const out: [number, number][] = [];
    if (from < frozen) {
      const hi = Math.min(to, frozen - 1);
      out.push([a.start(from), a.end(hi)]);
    }
    if (to >= frozen) {
      const lo = Math.max(from, frozen);
      const s = Math.max(a.start(lo) - offset, frozenSize);
      const e = Math.min(a.end(to) - offset, view);
      if (e > s) out.push([s, e]);
    }
    return out.map(([s, e]) => [Math.max(s, -4), Math.min(e, view)] as [number, number]).filter(([s, e]) => e > s);
  }
}
