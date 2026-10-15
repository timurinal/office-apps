/**
 * What the ribbon, the rail's menu, the keys and the command box do to the deck, one function
 * each, over the model and the selection only, so each is tested without a page. Each change is
 * one model step (one undo entry), and each leaves the selection on what it made.
 */

import type { ElementJSON, ShapeElement } from '../model/deck';
import type { SlideModel } from '../model/model';
import { boundsOf, unionOf } from '../model/model';
import type { SelectionStore } from './selection';

export interface Target {
  model: SlideModel;
  selection: SelectionStore;
}

/** Nudges, slide px: an arrow moves 1, Shift and an arrow 10. */
export const NUDGE = 1;
export const NUDGE_FAR = 10;

/** How far a duplicate (Ctrl+D) sits from what it copies, slide px. */
export const DUPLICATE_OFFSET = 20;

/**
 * The layout a new slide takes after `slideId`: a title slide is followed by title and content, as
 * in PowerPoint, and any other by its own layout. A deck with no slides starts with content.
 */
export function nextLayout(model: SlideModel, slideId: string | null): string {
  const ids = model.design().layouts.map((l) => l.id);
  const fallback = ids.includes('titleContent') ? 'titleContent' : (ids[0] ?? 'blank');
  const current = slideId ? model.slide(slideId)?.layout : undefined;
  if (!current || current === 'title' || !ids.includes(current)) return fallback;
  return current;
}

/** A new slide after the one on the canvas, shown. Its id. */
export function newSlide(t: Target, layoutId?: string): string | null {
  const s = t.selection.get();
  const at = s.slide ? t.model.indexOf(s.slide) + 1 : t.model.order().length;
  const id = t.model.addSlide(layoutId ?? nextLayout(t.model, s.slide), at);
  if (id) t.selection.set({ slide: id, slides: [id], els: [], editing: null });
  return id;
}

/** The chosen slides, copied after the last of them; the copies are chosen. */
export function duplicateSlides(t: Target): string[] | null {
  const s = t.selection.get();
  const copies = t.model.duplicateSlides(s.slides);
  if (copies?.length) t.selection.set({ slide: copies[0]!, slides: copies, els: [], editing: null });
  return copies;
}

/** The chosen slides, gone; the canvas moves to the slide after them, or the one before. */
export function deleteSlides(t: Target): boolean {
  const s = t.selection.get();
  const order = t.model.order();
  const gone = new Set(s.slides);
  const first = order.findIndex((id) => gone.has(id));
  const ok = t.model.deleteSlides(s.slides);
  if (ok) {
    const left = t.model.order();
    const next = left.find((id, i) => i >= first && !gone.has(id)) ?? left[left.length - 1] ?? null;
    t.selection.set({ slide: next, slides: next ? [next] : [], els: [], editing: null });
  }
  return ok;
}

/** Whether every chosen slide is hidden: what Hide slide shows pressed. */
export function chosenHidden(t: Target): boolean {
  const ids = t.selection.get().slides;
  return ids.length > 0 && ids.every((id) => t.model.slide(id)?.hidden === true);
}

/** Hides the chosen slides, or shows them when all of them are hidden. */
export function toggleHidden(t: Target): boolean {
  const ids = t.selection.get().slides;
  return t.model.setSlides(ids, { hidden: !chosenHidden(t) });
}

/** The layout of the chosen slides, or null when they differ. */
export function chosenLayout(t: Target): string | null {
  const ids = t.selection.get().slides;
  const layouts = new Set(ids.map((id) => t.model.slide(id)?.layout));
  return layouts.size === 1 ? ([...layouts][0] ?? null) : null;
}

export function setLayout(t: Target, layoutId: string): boolean {
  const ok = t.model.setLayout(t.selection.get().slides, layoutId);
  if (ok) t.selection.set({ els: [], editing: null });
  return ok;
}

export function resetSlides(t: Target): boolean {
  return t.model.resetSlides(t.selection.get().slides);
}

/** Moves to the slide before or after the one on the canvas. */
export function stepSlide(t: Target, by: number, extend?: 'range'): void {
  const s = t.selection.get();
  const order = t.model.order();
  if (!order.length) return;
  const at = s.slide ? order.indexOf(s.slide) : -1;
  const next = order[Math.max(0, Math.min(order.length - 1, at + by))]!;
  t.selection.showSlide(next, order, extend);
}

// ── elements ────────────────────────────────────────────────────────────────

/** A text box in the middle of the slide on the canvas, with the caret in it. Its id. */
export function insertTextBox(t: Target): string | null {
  const slide = t.selection.get().slide;
  if (!slide) return null;
  const w = 800;
  const h = 120;
  const el: ShapeElement = {
    type: 'shape',
    shape: 'rect',
    x: Math.round((t.model.width - w) / 2),
    y: Math.round((t.model.height - h) / 2),
    w,
    h,
    textBox: { wrap: true, autofit: 'none' }
  };
  const id = t.model.addElement(slide, el);
  if (id) t.selection.set({ els: [id], editing: id, focus: 'canvas' });
  return id;
}

/** The chosen elements moved by an arrow key. */
export function nudge(t: Target, dx: number, dy: number): boolean {
  const s = t.selection.get();
  if (!s.slide || !s.els.length) return false;
  const movable = s.els.filter((id) => !t.model.element(s.slide!, id)?.locked);
  return movable.length > 0 && t.model.moveElements(s.slide, movable, dx, dy);
}

/** The chosen elements, gone. */
export function deleteElements(t: Target): boolean {
  const s = t.selection.get();
  if (!s.slide || !s.els.length) return false;
  const ok = t.model.deleteElements(s.slide, s.els);
  if (ok) t.selection.set({ els: [], editing: null });
  return ok;
}

/** Copies of the chosen elements, a little down and to the right; the copies are chosen. */
export function duplicateElements(t: Target): string[] | null {
  const s = t.selection.get();
  if (!s.slide || !s.els.length) return null;
  const copies = t.model.duplicateElements(s.slide, s.els, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
  if (copies?.length) t.selection.set({ els: copies, editing: null });
  return copies;
}

/** Ctrl+D: the chosen slides from the rail, the chosen elements from the slide. */
export function duplicate(t: Target): void {
  const s = t.selection.get();
  if (s.focus === 'rail' || !s.els.length) duplicateSlides(t);
  else duplicateElements(t);
}

/** Every element on the slide, or every slide from the rail. */
export function selectAll(t: Target): void {
  const s = t.selection.get();
  if (s.focus === 'rail') {
    const order = t.model.order();
    if (s.slide) t.selection.set({ slides: order });
    return;
  }
  if (!s.slide) return;
  const els = (t.model.slide(s.slide)?.elements ?? []).filter((e) => !e.locked).map((e) => e.id!);
  t.selection.set({ els, editing: null });
}

export function group(t: Target): string | null {
  const s = t.selection.get();
  if (!s.slide || s.els.length < 2) return null;
  const id = t.model.group(s.slide, s.els);
  if (id) t.selection.set({ els: [id], editing: null });
  return id;
}

export function ungroup(t: Target): string[] | null {
  const s = t.selection.get();
  if (!s.slide || !s.els.length) return null;
  const ids = t.model.ungroup(s.slide, s.els);
  if (ids?.length) t.selection.set({ els: ids, editing: null });
  return ids;
}

/** Whether any chosen element is a group: what Ungroup needs. */
export function hasGroup(t: Target): boolean {
  const s = t.selection.get();
  return !!s.slide && s.els.some((id) => t.model.element(s.slide!, id)?.type === 'group');
}

/** The union box of the chosen elements, slide px, or null. */
export function chosenBox(t: Target): ReturnType<typeof unionOf> {
  const s = t.selection.get();
  if (!s.slide) return null;
  const els = s.els.map((id) => t.model.element(s.slide!, id)).filter((e): e is ElementJSON => !!e);
  return unionOf(els.map(boundsOf));
}
