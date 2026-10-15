/**
 * Smart guides: where a box being moved or resized would rather be, and what to draw to say so.
 *
 * Two kinds of help, in this order:
 *
 *   alignment   an edge or the centre of the box lines up with the slide's edges and centre, or with
 *               another object's (editor/snap.ts: one dashed line through both)
 *   spacing     on an axis where nothing lined up, the gap to a neighbour becomes the gap that two
 *               other objects already have: the box is put the same distance past one, or the same
 *               distance before the other as after it (a move only)
 *
 * Both pull within a few screen px, and nothing pulls while Alt is held, as in PowerPoint. Alignment
 * is drawn by the canvas from `SnapResult.guides`; spacing has no line to draw, so `spacingHints`
 * finds the equal gaps again from where the box ended up, and the canvas layer marks them. Reading the
 * answer back from the result (not from what snapped) means a hint also appears for gaps that were
 * equal already, as it does in PowerPoint.
 *
 * Pure: no DOM.
 */

import type { Box } from '../model/model';
import type { Handle } from '../editor/geometry';
import { edgesFor, snapBox } from '../editor/snap';
import type { SnapResult } from './types';

export interface SmartOptions {
  kind?: 'move' | 'resize';
  /** The handle being dragged, for a resize. */
  handle?: Handle | null;
  /** Alt is held: nothing snaps. */
  alt?: boolean;
}

type Axis = 'x' | 'y';

/** A box along one axis, with the extent it covers across the other. */
interface Span {
  a: number;
  b: number;
  ca: number;
  cb: number;
}

const span = (b: Box, axis: Axis): Span => (axis === 'x' ? { a: b.x, b: b.x + b.w, ca: b.y, cb: b.y + b.h } : { a: b.y, b: b.y + b.h, ca: b.x, cb: b.x + b.w });

/** Whether two spans cover some of the same stretch across the axis: they are in one row or column. */
const sameLine = (p: Span, q: Span): boolean => Math.min(p.cb, q.cb) > Math.max(p.ca, q.ca);

/** The others that share a row (or column) with `d`, left to right (or top to bottom). */
function lineOf(d: Span, others: readonly Box[], axis: Axis): Span[] {
  return others
    .map((o) => span(o, axis))
    .filter((o) => sameLine(o, d))
    .sort((p, q) => p.a - q.a || p.b - q.b);
}

/**
 * How far `d` moves along its axis to repeat a gap its row already has, or null when none is within
 * `tol`. For each two neighbours with a gap between them: past the second by that gap, before the
 * first by that gap, and centred between them when it fits.
 */
function spacingDelta(d: Span, others: readonly Box[], axis: Axis, tol: number): number | null {
  const row = lineOf(d, others, axis);
  const size = d.b - d.a;
  let best: number | null = null;
  const consider = (target: number) => {
    const delta = target - d.a;
    if (Math.abs(delta) <= tol && (best === null || Math.abs(delta) < Math.abs(best))) best = delta;
  };
  for (let i = 0; i + 1 < row.length; i++) {
    const p = row[i]!;
    const q = row[i + 1]!;
    const gap = q.a - p.b;
    if (gap <= 0) continue;
    consider(q.b + gap);
    consider(p.a - gap - size);
    if (gap >= size) consider(p.b + (gap - size) / 2);
  }
  return best;
}

/**
 * Where `box` would rather be: `dx` and `dy` to add, and the guides to draw. `others` are the boxes of
 * the objects not being dragged. Null when nothing is near, or Alt is held.
 */
export function smartSnap(box: Box, others: readonly Box[], width: number, height: number, tol: number, opts: SmartOptions = {}): SnapResult | null {
  if (opts.alt) return null;
  const kind = opts.kind ?? 'move';
  const aligned = snapBox(box, others, width, height, tol, edgesFor(kind, opts.handle ?? null));
  if (kind !== 'move') return aligned;

  let dx = aligned?.dx ?? 0;
  let dy = aligned?.dy ?? 0;
  const guides = aligned?.guides ?? [];
  let moved = aligned !== null;
  if (!guides.some((g) => g.axis === 'x')) {
    const sx = spacingDelta(span({ ...box, y: box.y + dy }, 'x'), others, 'x', tol);
    if (sx !== null) {
      dx = sx;
      moved = true;
    }
  }
  if (!guides.some((g) => g.axis === 'y')) {
    const sy = spacingDelta(span({ ...box, x: box.x + dx }, 'y'), others, 'y', tol);
    if (sy !== null) {
      dy = sy;
      moved = true;
    }
  }
  return moved ? { dx, dy, guides } : null;
}

/** A gap to mark: along `axis` from `from` to `to`, at `at` across it. Slide px. */
export interface GapHint {
  axis: Axis;
  from: number;
  to: number;
  at: number;
}

/** Gaps this close are equal. */
const EQUAL = 0.5;

/** Where a gap between two spans is marked across the axis: the middle of what both cover, or of `d`'s. */
function acrossOf(p: Span, q: Span, d: Span): number {
  const lo = Math.max(p.ca, q.ca);
  const hi = Math.min(p.cb, q.cb);
  return hi > lo ? (lo + hi) / 2 : (d.ca + d.cb) / 2;
}

function hintsOnAxis(box: Box, others: readonly Box[], axis: Axis): GapHint[] {
  const d = span(box, axis);
  const row = lineOf(d, others, axis);
  const before = row.filter((o) => o.b <= d.a + EQUAL).sort((p, q) => q.b - p.b);
  const after = row.filter((o) => o.a >= d.b - EQUAL).sort((p, q) => p.a - q.a);
  const left = before[0];
  const right = after[0];
  const gapLeft = left ? d.a - left.b : 0;
  const gapRight = right ? right.a - d.b : 0;
  const out: GapHint[] = [];
  const mark = (p: Span, q: Span) => out.push({ axis, from: p.b, to: q.a, at: acrossOf(p, q, d) });
  const equal = (x: number, y: number) => x > EQUAL && y > EQUAL && Math.abs(x - y) <= EQUAL;

  // The box with equal room on both sides.
  if (left && right && equal(gapLeft, gapRight)) {
    mark(left, d);
    mark(d, right);
    return out;
  }
  // The box repeating the gap between its neighbour and the one beyond.
  if (left) {
    const beyond = before.find((o) => o !== left && o.b <= left.a + EQUAL);
    if (beyond && equal(left.a - beyond.b, gapLeft)) {
      mark(beyond, left);
      mark(left, d);
    }
  }
  if (right) {
    const beyond = after.find((o) => o !== right && o.a >= right.b - EQUAL);
    if (beyond && equal(beyond.a - right.b, gapRight)) {
      mark(d, right);
      mark(right, beyond);
    }
  }
  return out;
}

/** The equal gaps around `box`, as it sits now, on both axes. */
export function spacingHints(box: Box, others: readonly Box[]): GapHint[] {
  return [...hintsOnAxis(box, others, 'x'), ...hintsOnAxis(box, others, 'y')];
}
