/**
 * What the Transitions tab does to the deck, one function each, over the model and the selection,
 * so each is tested without a page. Each is one model step (one undo entry).
 *
 * The transition the tab shows and builds on is the one on the slide on the canvas. It is written
 * to every slide chosen in the rail, as one step, so a choice made with three slides chosen is
 * three slides changed and one Ctrl+Z.
 *
 * None is no transition at all (the key is removed), so a deck that never used one stores nothing.
 */

import type { SelectionStore } from '../editor/selection';
import type { Transition } from '../model/deck';
import type { SlideModel } from '../model/model';
import { DURATION_RANGE, durationOf, kindOf, sideOf, usesDirection, type Kind, type Side } from './transitions';

export interface TransitionTarget {
  model: SlideModel;
  selection: SelectionStore;
}

/** The transition of the slide on the canvas, or null. */
export function currentTransition(t: TransitionTarget): Transition | null {
  const id = t.selection.get().slide;
  return (id ? t.model.slide(id)?.transition : undefined) ?? null;
}

/** The transition for a kind, keeping what carries over from the one it replaces: the time, and the side for push and wipe. */
export function withKind(kind: Kind, prev: Transition | null): Transition | null {
  if (kind === 'none') return null;
  const out: Transition = { kind };
  if (typeof prev?.duration === 'number') out.duration = prev.duration;
  if (usesDirection(kind) && prev?.from) out.from = prev.from;
  return out;
}

const ids = (t: TransitionTarget): readonly string[] => t.selection.get().slides;

const write = (t: TransitionTarget, next: Transition | null): boolean => t.model.setSlides(ids(t), { transition: next });

export function setKind(t: TransitionTarget, kind: Kind): boolean {
  return write(t, withKind(kind, currentTransition(t)));
}

/** The side push and wipe come from. Nothing for a transition that has none. */
export function setSide(t: TransitionTarget, from: Side): boolean {
  const cur = currentTransition(t);
  if (!cur || !usesDirection(kindOf(cur))) return false;
  return write(t, { ...cur, from });
}

/** The time, in ms, kept inside what the field accepts. */
export function setDuration(t: TransitionTarget, ms: number): boolean {
  const cur = currentTransition(t);
  if (!cur || kindOf(cur) === 'none' || !Number.isFinite(ms)) return false;
  const duration = Math.round(Math.max(DURATION_RANGE.min, Math.min(DURATION_RANGE.max, ms)));
  return write(t, { ...cur, duration });
}

/** The canvas slide's transition on every slide of the deck. */
export function applyToAll(t: TransitionTarget): boolean {
  return t.model.setSlides(t.model.order(), { transition: currentTransition(t) });
}

/** What the Duration field shows, in seconds, for the transition on the canvas: nothing for none. */
export function durationSeconds(cur: Transition | null): number | null {
  return cur && kindOf(cur) !== 'none' ? durationOf(cur) / 1000 : null;
}

/** The side the Effect options menu has marked, or null where the transition has no side. */
export function markedSide(cur: Transition | null): Side | null {
  return cur && usesDirection(kindOf(cur)) ? sideOf(cur) : null;
}
