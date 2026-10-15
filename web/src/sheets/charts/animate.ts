/**
 * A chart changes its mind in 180 ms: when a value changes, the bars grow or shrink, the line's points
 * move and the slices turn to their new share, rather than the picture jumping.
 *
 * Only `transform` and `opacity` are animated where the browser allows it (docs/design/README.md,
 * "Motion"), so the compositor does the work:
 *
 *   a bar          one transform that maps its new rectangle onto its old one, run to none
 *   a marker       a translation from where it was
 *   a new mark     opacity 0 to 1; a new bar grows from its baseline instead
 *
 * A line's shape and a slice's angles are not a transform of anything, so they are tweened in script,
 * one `d` attribute per frame for 180 ms and nothing else; that is the one place this module moves
 * anything that is not on the compositor, and the cost is a path of a few hundred points.
 *
 * Never animated: a chart that changed size (that is a drag or a resize, and nothing moves under a
 * drag), one of another type, or anything under reduced motion. `motionOff()` decides, as it does
 * everywhere (motion/index.ts), and `animate()` already drops a transform it was not allowed.
 */

import { DUR, EASE, animate, motionOff } from '../../motion';
import type { ChartGeom, DotMark, LineMark, RectMark, SliceMark } from './layout';
import { areaPath, linePath, slicePath } from './render';

const sameFrame = (a: ChartGeom, b: ChartGeom): boolean => a.w === b.w && a.h === b.h && a.type === b.type;

/** The corner a bar grows from. */
function originOf(r: Pick<RectMark, 'x' | 'y' | 'w' | 'h' | 'base'>): { x: number; y: number } {
  switch (r.base) {
    case 'bottom':
      return { x: r.x, y: r.y + r.h };
    case 'right':
      return { x: r.x + r.w, y: r.y };
    default:
      return { x: r.x, y: r.y };
  }
}

/**
 * The transform that draws `next`'s rectangle where `prev`'s was. A bar that was not there (or was
 * nothing) grows from its baseline. Null when there is nothing to move.
 */
export function rectFrom(prev: RectMark | null, next: RectMark): string | null {
  if (next.w <= 0 || next.h <= 0) return null;
  const vertical = next.base === 'bottom' || next.base === 'top';
  const from = prev && prev.w > 0 && prev.h > 0 && prev.base === next.base ? prev : null;
  const o = originOf(next);
  if (!from) return vertical ? 'scale(1, 0)' : 'scale(0, 1)';
  const p = originOf(from);
  const sx = from.w / next.w;
  const sy = from.h / next.h;
  const tx = p.x - o.x;
  const ty = p.y - o.y;
  if (Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05 && Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4) return null;
  return `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
}

export const easeOut = (t: number): number => 1 - (1 - t) ** 3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolates two lists of the same length; a NaN on either side holds the other's value. */
export function lerpList(from: readonly number[], to: readonly number[], t: number): number[] {
  return to.map((v, i) => {
    const a = from[i]!;
    if (Number.isNaN(a) || Number.isNaN(v)) return v;
    return lerp(a, v, t);
  });
}

type Frame = (t: number) => void;

/** Runs `frame(0..1)` over `ms` on animation frames, eased; the last call is exactly 1. Returns the way to stop. */
export function tween(frame: Frame, ms: number): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    frame(1);
    return () => undefined;
  }
  let raf = 0;
  let start = -1;
  let stopped = false;
  const step = (now: number) => {
    if (stopped) return;
    if (start < 0) start = now;
    const t = Math.min(1, (now - start) / ms);
    frame(t >= 1 ? 1 : easeOut(t));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  frame(0);
  raf = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/** What moves between two versions of the same chart, found by key. */
export interface Plan {
  rects: { key: string; transform: string }[];
  dots: { key: string; transform: string | null }[];
  lines: { key: string; from: number[]; to: number[]; floorFrom?: number[]; floorTo?: number[] }[];
  slices: { key: string; from: SliceMark; to: SliceMark }[];
}

export function plan(prev: ChartGeom, next: ChartGeom): Plan | null {
  if (!sameFrame(prev, next)) return null;
  const was = new Map(prev.marks.map((m) => [m.key, m]));
  const out: Plan = { rects: [], dots: [], lines: [], slices: [] };
  for (const m of next.marks) {
    const old = was.get(m.key);
    switch (m.kind) {
      case 'rect': {
        const t = rectFrom(old?.kind === 'rect' ? old : null, m);
        if (t) out.rects.push({ key: m.key, transform: t });
        break;
      }
      case 'dot': {
        const o = old?.kind === 'dot' ? (old as DotMark) : null;
        const moved = !o || o.x !== m.x || o.y !== m.y;
        if (moved) out.dots.push({ key: m.key, transform: o ? `translate(${o.x - m.x}px, ${o.y - m.y}px)` : null });
        break;
      }
      case 'line': {
        const o = old?.kind === 'line' ? (old as LineMark) : null;
        if (!o || o.pts.length !== m.pts.length) break;
        const same = o.pts.every((v, i) => Object.is(v, m.pts[i])) && (!m.floor || (o.floor ?? []).every((v, i) => Object.is(v, m.floor![i])));
        if (same) break;
        const l: Plan['lines'][number] = { key: m.key, from: o.pts, to: m.pts };
        if (m.floor && o.floor && o.floor.length === m.floor.length) {
          l.floorFrom = o.floor;
          l.floorTo = m.floor;
        }
        out.lines.push(l);
        break;
      }
      case 'slice': {
        const o = old?.kind === 'slice' ? (old as SliceMark) : null;
        if (o && (o.a0 !== m.a0 || o.a1 !== m.a1)) out.slices.push({ key: m.key, from: o, to: m });
        break;
      }
    }
  }
  return out.rects.length + out.dots.length + out.lines.length + out.slices.length > 0 ? out : null;
}

/**
 * Plays `prev` to `next` on the elements of `svg`. Returns the way to stop it, which a later change,
 * or the chart going away, calls. Does nothing under reduced motion, in a chart that changed size, or
 * on a chart that did not change.
 */
export function play(svg: SVGSVGElement, prev: ChartGeom, next: ChartGeom): () => void {
  if (motionOff()) return () => undefined;
  const p = plan(prev, next);
  if (!p) return () => undefined;
  // Keys are made of letters, digits and dots: nothing to escape.
  const find = (key: string) => svg.querySelector<SVGElement>(`[data-k="${key}"]`);
  const stops: (() => void)[] = [];
  const opts = { duration: DUR.base, easing: EASE.out };

  for (const r of p.rects) {
    const el = find(r.key);
    if (el) animate(el, [{ transform: r.transform }, { transform: 'none' }], opts);
  }
  for (const d of p.dots) {
    const el = find(d.key);
    if (!el) continue;
    animate(el, d.transform ? [{ transform: d.transform }, { transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }], opts);
  }
  const area = (k: string) => find(`${k}.area`);
  for (const l of p.lines) {
    const el = find(l.key);
    if (!el) continue;
    const wash = area(l.key);
    stops.push(
      tween((t) => {
        const pts = t === 1 ? l.to : lerpList(l.from, l.to, t);
        el.setAttribute('d', linePath(pts));
        if (wash && l.floorTo && l.floorFrom) wash.setAttribute('d', areaPath(pts, t === 1 ? l.floorTo : lerpList(l.floorFrom, l.floorTo, t)));
      }, DUR.base)
    );
  }
  for (const s of p.slices) {
    const el = find(s.key);
    if (!el) continue;
    stops.push(tween((t) => el.setAttribute('d', slicePath({ ...s.to, a0: lerp(s.from.a0, s.to.a0, t), a1: lerp(s.from.a1, s.to.a1, t) })), DUR.base));
  }
  return () => {
    for (const stop of stops) stop();
    for (const a of svg.getAnimations?.({ subtree: true }) ?? []) a.cancel();
  };
}

