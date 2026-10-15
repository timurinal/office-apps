/**
 * What Arrange does to the chosen objects, one function each over the model and the selection only,
 * so each is tested without a page. Every one is one model step, which is one undo entry.
 *
 *   order       bring to the front or forward one, send backward one or to the back, among the
 *               object's siblings (a group's children stay inside it)
 *   group       the model's (editor/actions.ts has them chosen); Ungroup likewise
 *   align       to the slide for one object, to the box around the chosen ones for several
 *   distribute  equal gaps between three or more, the outer two staying where they are
 *   turn, flip  each object about its own centre
 *
 * Align and distribute read an object's box as the one it covers on the slide, a turned object's
 * included (`boundsOf`), and move it by changing `x` and `y`, so a group's children go with it. A
 * locked object counts as part of the box it is aligned to and is never moved.
 *
 * Pure: no DOM.
 */

import type { ElementJSON } from '../model/deck';
import { arranged, boundsOf, unionOf, type Box, type ElementPatch, type SlideModel, type ZMove } from '../model/model';
import { group, hasGroup, ungroup, type Target } from '../editor/actions';

export { group, hasGroup, ungroup };
export type { ZMove };

export type AlignHow = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'horizontal' | 'vertical';
export type Turn = 'right' | 'left';
export type Mirror = 'horizontal' | 'vertical';

type Patches = { id: string; patch: ElementPatch }[];

/** The least number of objects each action needs. */
export const MIN_TO_GROUP = 2;
export const MIN_TO_DISTRIBUTE = 3;

/** Positions are kept to a hundredth of a px, so an align does not leave 910.0000000001. */
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** The chosen elements on the slide on the canvas, in the order they were chosen. */
export function chosenElements(t: Target): { slide: string; els: ElementJSON[] } | null {
  const s = t.selection.get();
  if (!s.slide) return null;
  const els = s.els.map((id) => t.model.element(s.slide!, id)).filter((e): e is ElementJSON => !!e);
  return els.length ? { slide: s.slide, els } : null;
}

const movable = (els: readonly ElementJSON[]): ElementJSON[] => els.filter((e) => !e.locked);

// ── order ───────────────────────────────────────────────────────────────────

/** The ids of an element's siblings in back-to-front order: its group's children, or the slide's elements. */
function siblings(model: SlideModel, slide: string, id: string): readonly string[] {
  const parent = model.parentOf(slide, id);
  const holder = parent ? model.element(slide, parent) : null;
  const list = holder?.type === 'group' ? holder.children : (model.slide(slide)?.elements ?? []);
  return list.map((e) => e.id!);
}

/** Whether the move would change anything: Bring to front is off for what is already in front. */
export function canReorder(t: Target, how: ZMove): boolean {
  const s = t.selection.get();
  if (!s.slide || !s.els.length) return false;
  const byList = new Map<string, { list: readonly string[]; ids: Set<string> }>();
  for (const id of s.els) {
    if (!t.model.element(s.slide, id)) continue;
    const list = siblings(t.model, s.slide, id);
    const key = list.join('\u0000');
    const entry = byList.get(key) ?? { list, ids: new Set<string>() };
    entry.ids.add(id);
    byList.set(key, entry);
  }
  for (const { list, ids } of byList.values()) {
    if (arranged(list, ids, how).some((id, i) => id !== list[i])) return true;
  }
  return false;
}

export function reorder(t: Target, how: ZMove): boolean {
  const s = t.selection.get();
  if (!s.slide || !s.els.length) return false;
  return t.model.reorder(s.slide, s.els, how);
}

// ── align ───────────────────────────────────────────────────────────────────

/** How far a box moves along the axis `how` is on to line up with `ref`. */
function alignDelta(b: Box, ref: Box, how: AlignHow): { dx: number; dy: number } {
  switch (how) {
    case 'left':
      return { dx: ref.x - b.x, dy: 0 };
    case 'centre':
      return { dx: ref.x + ref.w / 2 - (b.x + b.w / 2), dy: 0 };
    case 'right':
      return { dx: ref.x + ref.w - (b.x + b.w), dy: 0 };
    case 'top':
      return { dx: 0, dy: ref.y - b.y };
    case 'middle':
      return { dx: 0, dy: ref.y + ref.h / 2 - (b.y + b.h / 2) };
    case 'bottom':
      return { dx: 0, dy: ref.y + ref.h - (b.y + b.h) };
  }
}

/** Each box's move to line up with `ref`. */
export function alignDeltas(boxes: readonly Box[], ref: Box, how: AlignHow): { dx: number; dy: number }[] {
  return boxes.map((b) => alignDelta(b, ref, how));
}

/**
 * Each box's move to put equal gaps between neighbours along `axis`: sorted by position, the first
 * keeps its place and the last ends where the outermost edge was. Fewer than three boxes do not move.
 */
export function distributeDeltas(boxes: readonly Box[], axis: Axis): number[] {
  const out = boxes.map(() => 0);
  if (boxes.length < MIN_TO_DISTRIBUTE) return out;
  const start = (b: Box): number => (axis === 'horizontal' ? b.x : b.y);
  const size = (b: Box): number => (axis === 'horizontal' ? b.w : b.h);
  const first = Math.min(...boxes.map(start));
  const last = Math.max(...boxes.map((b) => start(b) + size(b)));
  const total = boxes.reduce((n, b) => n + size(b), 0);
  const gap = (last - first - total) / (boxes.length - 1);
  const sorted = boxes.map((_, i) => i).sort((a, b) => start(boxes[a]!) - start(boxes[b]!) || a - b);
  let cursor = first;
  for (const i of sorted) {
    out[i] = cursor - start(boxes[i]!);
    cursor += size(boxes[i]!) + gap;
  }
  return out;
}

const patchFor = (el: ElementJSON, dx: number, dy: number): { id: string; patch: ElementPatch } | null =>
  Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005 ? null : { id: el.id!, patch: { x: r2(el.x + dx), y: r2(el.y + dy) } };

const present = (list: readonly ({ id: string; patch: ElementPatch } | null)[]): Patches => list.filter((p): p is { id: string; patch: ElementPatch } => p !== null);

/** The patches that align `els`: to the slide for one, to the box around all of them for several. */
export function alignPatches(els: readonly ElementJSON[], slide: Box, how: AlignHow): Patches {
  if (!els.length) return [];
  const ref = els.length === 1 ? slide : (unionOf(els.map(boundsOf)) ?? slide);
  return present(
    els.map((el) => {
      if (el.locked) return null;
      const d = alignDelta(boundsOf(el), ref, how);
      return patchFor(el, d.dx, d.dy);
    })
  );
}

export function align(t: Target, how: AlignHow): boolean {
  const c = chosenElements(t);
  if (!c) return false;
  const patches = alignPatches(c.els, { x: 0, y: 0, w: t.model.width, h: t.model.height }, how);
  return patches.length > 0 && t.model.updateElements(c.slide, patches);
}

/** The patches that put equal gaps between `els`. */
export function distributePatches(els: readonly ElementJSON[], axis: Axis): Patches {
  const deltas = distributeDeltas(els.map(boundsOf), axis);
  return present(els.map((el, i) => (el.locked ? null : patchFor(el, axis === 'horizontal' ? deltas[i]! : 0, axis === 'vertical' ? deltas[i]! : 0))));
}

export function distribute(t: Target, axis: Axis): boolean {
  const c = chosenElements(t);
  if (!c || c.els.length < MIN_TO_DISTRIBUTE) return false;
  const patches = distributePatches(c.els, axis);
  return patches.length > 0 && t.model.updateElements(c.slide, patches);
}

// ── turn and flip ───────────────────────────────────────────────────────────

const wrap = (deg: number): number => ((deg % 360) + 360) % 360;

/** `rot: null` removes the field, so an element turned back to upright stores nothing. */
const rotPatch = (deg: number): { rot: number | null } => ({ rot: wrap(deg) === 0 ? null : wrap(deg) });

/** Each element turned a quarter, about its own centre. */
export function turnPatches(els: readonly ElementJSON[], turn: Turn): Patches {
  return movable(els).map((el) => ({ id: el.id!, patch: rotPatch((el.rot ?? 0) + (turn === 'right' ? 90 : -90)) }));
}

/**
 * Each element mirrored about its own centre. A mirror turns the other way, so a turned element's
 * angle is negated as its flip is switched, which is what PowerPoint writes.
 */
export function flipPatches(els: readonly ElementJSON[], mirror: Mirror): Patches {
  return movable(els).map((el) => {
    const patch: ElementPatch = { ...rotPatch(-(el.rot ?? 0)) };
    if (mirror === 'horizontal') patch.flipH = el.flipH ? null : true;
    else patch.flipV = el.flipV ? null : true;
    return { id: el.id!, patch };
  });
}

export function turn(t: Target, how: Turn): boolean {
  const c = chosenElements(t);
  if (!c) return false;
  const patches = turnPatches(c.els, how);
  return patches.length > 0 && t.model.updateElements(c.slide, patches);
}

export function flip(t: Target, mirror: Mirror): boolean {
  const c = chosenElements(t);
  if (!c) return false;
  const patches = flipPatches(c.els, mirror);
  return patches.length > 0 && t.model.updateElements(c.slide, patches);
}

// ── what a button needs to know ─────────────────────────────────────────────

export interface Chosen {
  /** How many objects are chosen. */
  count: number;
  /** How many of them can be moved. */
  movable: number;
}

export function chosenCount(t: Target): Chosen {
  const c = chosenElements(t);
  return { count: c?.els.length ?? 0, movable: c ? movable(c.els).length : 0 };
}
