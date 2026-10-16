/**
 * The canvas's arithmetic, in slide px: which element is under a point, which ones a marquee
 * holds, where a box goes when one of its handles is dragged, and what angle a rotate handle
 * makes. The canvas turns pointer events into these and these into one step each.
 *
 * Hit testing is done here, not by the DOM: an element's drawing is a transformed SVG whose
 * transparent parts would otherwise catch the pointer, a thin line would be impossible to catch,
 * and a rotated box's corners would be the wrong element's.
 *
 * Pure: no DOM.
 */

import type { ElementJSON } from '../model/deck';
import { boundsOf, type Box } from '../model/model';

export interface Pt {
  x: number;
  y: number;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Which way a handle moves each axis: -1 the low edge, 1 the high edge, 0 neither. */
export const HANDLE_SIGN: Record<Handle, Pt> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 }
};

/** The smallest a box is resized to, slide px. */
export const MIN_SIZE = 4;

const rad = (deg: number): number => (deg * Math.PI) / 180;

export function rotate(p: Pt, about: Pt, deg: number): Pt {
  if (!deg) return p;
  const r = rad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

export const centreOf = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** A point in a box's own frame: its rotation undone around its centre. */
export function toLocal(p: Pt, b: Box & { rot?: number }): Pt {
  return rotate(p, centreOf(b), -(b.rot ?? 0));
}

/** Whether `p` is inside the (rotated) box, `tol` slide px around it counting. */
export function inBox(p: Pt, b: Box & { rot?: number }, tol = 0): boolean {
  const q = toLocal(p, b);
  return q.x >= b.x - tol && q.x <= b.x + b.w + tol && q.y >= b.y - tol && q.y <= b.y + b.h + tol;
}

/** A line's two ends: `flipH` and `flipV` pick which diagonal of its box it is. */
export function lineEndsOf(el: Box & { flipH?: boolean; flipV?: boolean }): { a: Pt; b: Pt } {
  const x0 = el.flipH ? el.x + el.w : el.x;
  const x1 = el.flipH ? el.x : el.x + el.w;
  const y0 = el.flipV ? el.y + el.h : el.y;
  const y1 = el.flipV ? el.y : el.y + el.h;
  return { a: { x: x0, y: y0 }, b: { x: x1, y: y1 } };
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A point in a group's children's frame: the group's rotation and flips undone. */
function intoGroup(p: Pt, g: ElementJSON): Pt {
  let q = toLocal(p, g);
  const c = centreOf(g);
  if (g.flipH) q = { x: 2 * c.x - q.x, y: q.y };
  if (g.flipV) q = { x: q.x, y: 2 * c.y - q.y };
  return q;
}

/**
 * Screen px around a thin thing that still counts as on it: a line, measured from the edge of its
 * stroke, and a shape narrower or shorter than this on screen, measured from its box. The canvas
 * passes it to `hitTest` divided by its scale, so it is the same on screen at every zoom.
 */
export const HIT_PX = 10;

/** How far `p` is from the box, in the box's own frame: 0 inside it. */
function distanceToBox(p: Pt, b: Box & { rot?: number }): number {
  const q = toLocal(p, b);
  const dx = Math.max(b.x - q.x, 0, q.x - (b.x + b.w));
  const dy = Math.max(b.y - q.y, 0, q.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/**
 * Whether `p` is on the element: within `tol` of a line's stroke, inside a shape's box, or within
 * `tol` of a shape too thin to catch otherwise. A shape bigger than `tol` both ways gets none, so a
 * line over it takes only the clicks near the line.
 */
export function hits(el: ElementJSON, p: Pt, tol: number): boolean {
  if (el.type === 'line') {
    const q = toLocal(p, el);
    const { a, b } = lineEndsOf(el);
    return distanceToSegment(q, a, b) <= (el.line?.width ?? 0) / 2 + tol;
  }
  if (el.type === 'group') {
    const q = intoGroup(p, el);
    return el.children.some((c) => hits(c, q, tol));
  }
  if (el.w < tol || el.h < tol) return distanceToBox(p, el) <= tol;
  return inBox(p, el);
}

/**
 * The topmost element under `p`: its top-level id, and the ids from it down to the innermost
 * child under the point (`path[0]` is the top-level one). Null over the slide's background.
 */
export function hitTest(elements: readonly ElementJSON[], p: Pt, tol: number): { id: string; path: string[] } | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (!el.id || !hits(el, p, tol)) continue;
    const path = [el.id];
    let at: ElementJSON = el;
    let q = p;
    while (at.type === 'group') {
      q = intoGroup(q, at);
      const inner: ElementJSON | undefined = [...at.children].reverse().find((c) => c.id && hits(c, q, tol));
      if (!inner) break;
      path.push(inner.id!);
      at = inner;
    }
    return { id: el.id, path };
  }
  return null;
}

/** The ids of the top-level elements a marquee holds whole, as PowerPoint's does. */
export function marqueeHits(elements: readonly ElementJSON[], rect: Box): string[] {
  const r = normalised(rect);
  return elements
    .filter((el) => {
      if (!el.id) return false;
      const b = boundsOf(el);
      return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
    })
    .map((el) => el.id!);
}

/** A box with a positive width and height, from one dragged in any direction. */
export function normalised(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}

export interface ResizeOptions {
  /** Shift: the proportions stay. */
  keepAspect?: boolean;
  /** Ctrl, or Alt: the centre stays and both sides move. */
  fromCentre?: boolean;
  min?: number;
}

/**
 * Where a box goes when `handle` is dragged by `delta` (slide px, the screen's axes). The box's
 * rotation is honoured: the drag is read in the box's own frame, and the opposite handle (or the
 * centre, with `fromCentre`) stays where it is on the slide.
 */
export function resizeBox(start: Box & { rot?: number }, handle: Handle, delta: Pt, opts: ResizeOptions = {}): Box {
  const min = opts.min ?? MIN_SIZE;
  const rot = start.rot ?? 0;
  const d = rotate(delta, { x: 0, y: 0 }, -rot);
  const sign = HANDLE_SIGN[handle];
  const k = opts.fromCentre ? 2 : 1;
  let w = start.w + sign.x * d.x * k;
  let h = start.h + sign.y * d.y * k;
  if (opts.keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (sign.x && sign.y) {
      // The axis the pointer moved most along leads, so a corner pulled in shrinks the box.
      if (Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1)) h = w / ratio;
      else w = h * ratio;
    } else if (sign.x) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  if (opts.keepAspect && start.w > 0 && start.h > 0) {
    // The floor may have broken the proportion; restore it from the larger side.
    const ratio = start.w / start.h;
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
  }
  const c0 = centreOf(start);
  if (opts.fromCentre) return { x: c0.x - w / 2, y: c0.y - h / 2, w, h };
  // The point that stays: the opposite handle, in the box's frame from its centre.
  const anchor0 = { x: (-sign.x * start.w) / 2, y: (-sign.y * start.h) / 2 };
  const anchor1 = { x: (-sign.x * w) / 2, y: (-sign.y * h) / 2 };
  const shift = rotate({ x: anchor0.x - anchor1.x, y: anchor0.y - anchor1.y }, { x: 0, y: 0 }, rot);
  const c1 = { x: c0.x + shift.x, y: c0.y + shift.y };
  return { x: c1.x - w / 2, y: c1.y - h / 2, w, h };
}

/** Each box in a group of boxes, when their union goes from `from` to `to`. */
export function scaleInto(b: Box, from: Box, to: Box): Box {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  return { x: to.x + (b.x - from.x) * sx, y: to.y + (b.y - from.y) * sy, w: b.w * sx, h: b.h * sy };
}

/** An element given a new box, a group's children scaled with it (as the model's step does). */
export function reboxed(el: ElementJSON, to: Box): ElementJSON {
  const out = { ...el, x: to.x, y: to.y, w: to.w, h: to.h } as ElementJSON;
  if (out.type === 'group') out.children = out.children.map((c) => reboxed(c, scaleInto(c, el, to)));
  return out;
}

/**
 * A line with one end dragged by `delta`: the other end stays, and the line may cross it, which
 * flips the diagonal its box draws.
 */
export function moveLineEnd(el: Box & { flipH?: boolean; flipV?: boolean }, end: 'a' | 'b', delta: Pt): Box & { flipH: boolean; flipV: boolean } {
  const ends = lineEndsOf(el);
  const a = end === 'a' ? { x: ends.a.x + delta.x, y: ends.a.y + delta.y } : ends.a;
  const b = end === 'b' ? { x: ends.b.x + delta.x, y: ends.b.y + delta.y } : ends.b;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), flipH: a.x > b.x, flipV: a.y > b.y };
}

/** Which end of a line a corner handle is, or null for a corner that is not an end. */
export function lineEndAt(el: { flipH?: boolean; flipV?: boolean }, handle: Handle): 'a' | 'b' | null {
  const a: Handle = el.flipH ? (el.flipV ? 'se' : 'ne') : el.flipV ? 'sw' : 'nw';
  const b: Handle = el.flipH ? (el.flipV ? 'nw' : 'sw') : el.flipV ? 'ne' : 'se';
  return handle === a ? 'a' : handle === b ? 'b' : null;
}

/** The rotation that points the rotate handle (above the box's top edge) at `p`, in whole degrees from 0 to 359. */
export function angleTo(centre: Pt, p: Pt, snap = false): number {
  let deg = (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / 15) * 15;
  deg = Math.round(deg);
  return ((deg % 360) + 360) % 360;
}

/** Where a handle sits on the box, in slide px, rotation applied. */
export function handlePoint(b: Box & { rot?: number }, handle: Handle): Pt {
  const s = HANDLE_SIGN[handle];
  const c = centreOf(b);
  return rotate({ x: c.x + (s.x * b.w) / 2, y: c.y + (s.y * b.h) / 2 }, c, b.rot ?? 0);
}

/** The cursor for a handle, turned by the box's rotation to the nearest of the four. */
export function handleCursor(handle: Handle, rot = 0): string {
  const order: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const at = (order.indexOf(handle) + Math.round((((rot % 360) + 360) % 360) / 45)) % 8;
  const turned = order[at]!;
  return { n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' }[turned] + '-resize';
}
