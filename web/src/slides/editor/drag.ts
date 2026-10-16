/**
 * A drag on the canvas, as data: what a click chooses, and where a move, a resize or a turn puts
 * the elements while the pointer is down. The canvas draws the preview from this and writes it as
 * one step when the pointer comes up; nothing here touches the deck while the drag runs.
 *
 * Pure: no DOM.
 */

import type { ElementJSON, SlideJSON } from '../model/deck';
import type { ElementPatch } from '../model/model';
import { boundsOf, translated, unionOf, type Box } from '../model/model';
import type { CanvasDrag, Guide, SnapResult } from '../modules/types';
import { angleTo, centreOf, lineEndAt, moveLineEnd, reboxed, resizeBox, scaleInto, type Handle, type Pt } from './geometry';
import { applyResizeSnap } from './snap';

/** Screen px a pointer moves before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;

/** Every element on a slide by id, a group's children included. */
export function elementIndex(elements: readonly ElementJSON[]): Map<string, ElementJSON> {
  const out = new Map<string, ElementJSON>();
  const walk = (els: readonly ElementJSON[]) => {
    for (const el of els) {
      if (el.id) out.set(el.id, el);
      if (el.type === 'group') walk(el.children);
    }
  };
  walk(elements);
  return out;
}

/**
 * What a click on `path` (hitTest's, outermost first) chooses: the element at the depth where one of
 * its siblings, or itself, is already chosen, so a second click inside a group stays inside it; the
 * outermost one otherwise.
 */
export function clickTarget(path: readonly string[], chosen: readonly string[], parentOf: (id: string) => string | null): { id: string; depth: number } {
  for (let i = path.length - 1; i >= 1; i--) {
    const parent = path[i - 1]!;
    if (chosen.some((id) => id === path[i] || parentOf(id) === parent)) return { id: path[i]!, depth: i };
  }
  return { id: path[0]!, depth: 0 };
}

/** The slide with some elements replaced, wherever they sit. The same object when nothing is. */
export function withChanges(slide: SlideJSON, changed: ReadonlyMap<string, ElementJSON>): SlideJSON {
  if (!changed.size) return slide;
  const map = (els: readonly ElementJSON[]): ElementJSON[] | null => {
    let out: ElementJSON[] | null = null;
    els.forEach((el, i) => {
      let next = el.id ? changed.get(el.id) : undefined;
      if (!next && el.type === 'group') {
        const kids = map(el.children);
        if (kids) next = { ...el, children: kids };
      }
      if (next) {
        out ??= [...els];
        out[i] = next;
      }
    });
    return out;
  };
  const elements = map(slide.elements);
  return elements ? { ...slide, elements } : slide;
}

/** Where a drag has the elements now: drawn by the canvas, written on release. */
export interface Preview {
  changed: Map<string, ElementJSON>;
  patches: { id: string; patch: ElementPatch }[];
  /** What a canvas layer and a snap rule are told. */
  drag: CanvasDrag;
  guides: Guide[];
}

export type Snapper = (box: Box, drag: CanvasDrag) => SnapResult | null;

const box = (e: Box): Box => ({ x: e.x, y: e.y, w: e.w, h: e.h });

/**
 * The elements moved by `delta`. Shift keeps the move to the axis it is mostly along; the snap rule
 * (none while Alt is held) may then pull the union box onto a line.
 */
export function movePreview(els: readonly ElementJSON[], delta: Pt, opts: { axis?: boolean; snap?: Snapper | null }): Preview {
  let { x: dx, y: dy } = delta;
  if (opts.axis) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const union = unionOf(els.map(boundsOf)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const moved = { ...union, x: union.x + dx, y: union.y + dy };
  const drag: CanvasDrag = { kind: 'move', ids: els.map((e) => e.id!), box: moved, handle: null };
  let guides: Guide[] = [];
  const r = opts.snap?.(moved, drag);
  if (r) {
    // An axis Shift has held still stays still.
    if (!opts.axis || dx) dx += r.dx;
    if (!opts.axis || dy) dy += r.dy;
    guides = r.guides;
  }
  const changed = new Map<string, ElementJSON>();
  const patches: Preview['patches'] = [];
  for (const el of els) {
    changed.set(el.id!, translated(el, dx, dy));
    patches.push({ id: el.id!, patch: { x: el.x + dx, y: el.y + dy } });
  }
  return { changed, patches, drag, guides };
}

/**
 * The sides of `to` that differ from `el`'s box. A pull of the bottom-right corner writes only the
 * width and height, so someone moving the same element at once keeps their move.
 */
function moved(el: ElementJSON, to: { x: number; y: number; w: number; h: number }): Preview['patches'][number]['patch'] {
  const patch: Record<string, number> = {};
  for (const k of ['x', 'y', 'w', 'h'] as const) if (to[k] !== el[k]) patch[k] = to[k];
  return patch;
}

/**
 * The elements resized by dragging `handle` by `delta`. One element resizes in its own frame (its
 * rotation honoured, a line's end moved on its own); several scale with their union box.
 */
export function resizePreview(
  els: readonly ElementJSON[],
  handle: Handle,
  delta: Pt,
  opts: { keepAspect?: boolean; fromCentre?: boolean; snap?: Snapper | null }
): Preview {
  const changed = new Map<string, ElementJSON>();
  const patches: Preview['patches'] = [];
  const ids = els.map((e) => e.id!);
  const only = els.length === 1 ? els[0]! : null;

  if (only?.type === 'line') {
    const end = lineEndAt(only, handle);
    if (end) {
      const next = moveLineEnd(only, end, delta);
      changed.set(only.id!, { ...only, ...next });
      patches.push({ id: only.id!, patch: next });
      return { changed, patches, drag: { kind: 'resize', ids, box: box(next), handle }, guides: [] };
    }
  }

  const start = only ? { ...box(only), rot: only.rot ?? 0 } : (unionOf(els.map(boundsOf)) ?? { x: 0, y: 0, w: 0, h: 0 });
  // Lock aspect ratio holds a corner as Shift does; a side still stretches, as in PowerPoint.
  const corner = handle.length === 2;
  const keepAspect = !!opts.keepAspect || (corner && els.some((e) => e.lockAspect));
  let next = resizeBox(start, handle, delta, { keepAspect, fromCentre: !!opts.fromCentre });
  const drag: CanvasDrag = { kind: 'resize', ids, box: next, handle };
  let guides: Guide[] = [];
  // A turned box's edges are not the slide's axes, and a held proportion would not survive a pull.
  const rot = only?.rot ?? 0;
  if (!rot && !keepAspect && !opts.fromCentre) {
    const r = opts.snap?.(next, drag);
    if (r) {
      next = applyResizeSnap(next, handle, r.dx, r.dy);
      guides = r.guides;
    }
  }
  if (only) {
    changed.set(only.id!, reboxed(only, next));
    patches.push({ id: only.id!, patch: moved(only, next) });
  } else {
    for (const el of els) {
      const to = scaleInto(box(el), start, next);
      changed.set(el.id!, reboxed(el, to));
      patches.push({ id: el.id!, patch: moved(el, to) });
    }
  }
  return { changed, patches, drag: { ...drag, box: next }, guides };
}

/** One element turned so its rotate handle points at `p`; Shift turns in steps of 15 degrees. */
export function rotatePreview(el: ElementJSON, p: Pt, snap15: boolean): Preview {
  const rot = angleTo(centreOf(el), p, snap15);
  return {
    changed: new Map([[el.id!, { ...el, rot } as ElementJSON]]),
    patches: [{ id: el.id!, patch: { rot } }],
    drag: { kind: 'rotate', ids: [el.id!], box: box(el), handle: null },
    guides: []
  };
}
