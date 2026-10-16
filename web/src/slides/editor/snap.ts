/**
 * Core's snap rule: a box being moved or resized lines up with the slide's edges and centre and
 * with the other elements' edges and centres, within a few screen px, and a dashed guide shows
 * what it lined up with. A module's rule runs first when it is listed first (types.ts, "snap").
 *
 * Pure: no DOM.
 */

import type { Box } from '../model/model';
import type { Handle } from './geometry';
import type { Guide, SnapResult } from '../modules/types';

/** Screen px within which a box snaps. */
export const SNAP_PX = 6;

type Edge = 0 | 0.5 | 1;

/** Which of the box's edges may snap: all three of each axis for a move, the dragged ones for a resize. */
export function edgesFor(kind: 'move' | 'resize', handle: Handle | null): { x: Edge[]; y: Edge[] } {
  if (kind === 'move' || !handle) return { x: [0, 0.5, 1], y: [0, 0.5, 1] };
  return {
    x: handle.includes('w') ? [0] : handle.includes('e') ? [1] : [],
    y: handle.startsWith('n') ? [0] : handle.startsWith('s') ? [1] : []
  };
}

interface Line {
  at: number;
  /** The extent of what it belongs to on the other axis. */
  from: number;
  to: number;
}

function axisSnap(start: number, size: number, edges: Edge[], lines: Line[], tol: number): { d: number; at: number; line: Line } | null {
  let best: { d: number; at: number; line: Line } | null = null;
  for (const e of edges) {
    const pos = start + size * e;
    for (const l of lines) {
      const d = l.at - pos;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l.at, line: l };
    }
  }
  return best;
}

/**
 * Where `box` would rather be: `dx` and `dy` to add, and the guides to draw. `others` are the
 * boxes of the elements not being dragged. Null when nothing is near.
 */
export function snapBox(box: Box, others: readonly Box[], width: number, height: number, tol: number, edges = edgesFor('move', null)): SnapResult | null {
  const xs: Line[] = [
    { at: 0, from: 0, to: height },
    { at: width / 2, from: 0, to: height },
    { at: width, from: 0, to: height }
  ];
  const ys: Line[] = [
    { at: 0, from: 0, to: width },
    { at: height / 2, from: 0, to: width },
    { at: height, from: 0, to: width }
  ];
  for (const o of others) {
    for (const k of [0, 0.5, 1]) {
      xs.push({ at: o.x + o.w * k, from: o.y, to: o.y + o.h });
      ys.push({ at: o.y + o.h * k, from: o.x, to: o.x + o.w });
    }
  }
  const sx = axisSnap(box.x, box.w, edges.x, xs, tol);
  const sy = axisSnap(box.y, box.h, edges.y, ys, tol);
  if (!sx && !sy) return null;
  const dx = sx?.d ?? 0;
  const dy = sy?.d ?? 0;
  const guides: Guide[] = [];
  if (sx) {
    const y0 = box.y + dy;
    guides.push({ axis: 'x', at: sx.at, from: Math.min(sx.line.from, y0), to: Math.max(sx.line.to, y0 + box.h) });
  }
  if (sy) {
    const x0 = box.x + dx;
    guides.push({ axis: 'y', at: sy.at, from: Math.min(sy.line.from, x0), to: Math.max(sy.line.to, x0 + box.w) });
  }
  return { dx, dy, guides };
}

/** A resize's box with a snap applied to the edges the handle moves. */
export function applyResizeSnap(b: Box, handle: Handle, dx: number, dy: number): Box {
  const out = { ...b };
  if (handle.includes('w')) {
    out.x += dx;
    out.w -= dx;
  } else if (handle.includes('e')) out.w += dx;
  if (handle.startsWith('n')) {
    out.y += dy;
    out.h -= dy;
  } else if (handle.startsWith('s')) out.h += dy;
  return out;
}
