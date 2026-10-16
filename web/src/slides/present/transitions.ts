/**
 * What a slide transition does, as animations that run on the compositor and nothing else.
 *
 * A `Transition` in the deck (model/deck.ts) is a kind, a duration and, for push and wipe, the
 * side the new slide comes from. `resolve` turns it into what to play for one step of the show,
 * and `plan` turns that into keyframes for the slide that arrives and the slide that leaves. Only
 * `transform` and `opacity` are ever in a keyframe: a wipe is the arriving slide inside a mask
 * that slides in while the slide inside it slides back by as much, so the slide holds still and
 * the edge moves. No `clip-path`, and no layout property.
 *
 * Reduced motion (`prefers-reduced-motion`, or `data-motion="off"` from the desktop app) turns
 * every transition into a fade, the one thing that does not move, and a short one. A transition
 * that is none stays a cut.
 *
 * Pure, with no DOM, so the rules are tested without a page.
 */

import type { Transition } from '../model/deck';

export type Kind = Transition['kind'];
export type Side = NonNullable<Transition['from']>;

export const TRANSITION_KINDS: readonly Kind[] = ['none', 'fade', 'push', 'wipe', 'zoom'];
export const TRANSITION_LABELS: Record<Kind, string> = { none: 'None', fade: 'Fade', push: 'Push', wipe: 'Wipe', zoom: 'Zoom' };

export const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];
export const SIDE_LABELS: Record<Side, string> = { left: 'From left', right: 'From right', top: 'From top', bottom: 'From bottom' };
const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** Where push and wipe come from when the deck does not say: PowerPoint's file default, the side forward is. */
export const DEFAULT_FROM: Side = 'right';
export const DEFAULT_DURATION = 700;
/** What the Duration field accepts. A file may carry up to `STORED_MAX`, as the importer reads it. */
export const DURATION_RANGE = { min: 100, max: 10_000 } as const;
const STORED = { min: 50, max: 60_000 } as const;
/** A fade under reduced motion is no longer than this. */
export const REDUCED_MAX = 500;

export const usesDirection = (kind: Kind): boolean => kind === 'push' || kind === 'wipe';

/** A transition's fields as the deck holds them, which may be anything a file or a peer wrote. */
export const kindOf = (t: Transition | null | undefined): Kind => (t && TRANSITION_KINDS.includes(t.kind) ? t.kind : 'none');
export const sideOf = (t: Transition | null | undefined): Side => (t?.from && SIDES.includes(t.from) ? t.from : DEFAULT_FROM);
export function durationOf(t: Transition | null | undefined): number {
  const d = t?.duration;
  return typeof d === 'number' && Number.isFinite(d) ? Math.round(Math.max(STORED.min, Math.min(STORED.max, d))) : DEFAULT_DURATION;
}

export interface Resolved {
  kind: Exclude<Kind, 'none'>;
  /** ms */
  duration: number;
  /** The side the arriving slide comes from. */
  from: Side;
  /** Going back through the deck: played the other way round. */
  reverse: boolean;
}

/**
 * What to play, or null for a cut. Going back plays the transition of the slide being left the
 * other way round, which the caller chooses by passing that slide's transition and `backward`.
 */
export function resolve(t: Transition | null | undefined, o: { backward?: boolean; reduced: boolean }): Resolved | null {
  const kind = kindOf(t);
  if (kind === 'none') return null;
  const backward = o.backward === true;
  const duration = durationOf(t);
  if (o.reduced) return { kind: 'fade', duration: Math.min(duration, REDUCED_MAX), from: DEFAULT_FROM, reverse: backward };
  const from = usesDirection(kind) ? (backward ? OPPOSITE[sideOf(t)] : sideOf(t)) : DEFAULT_FROM;
  return { kind, duration, from, reverse: backward };
}

export interface Plan {
  duration: number;
  easing: string;
  /** The slide leaving, or null when it stays where it is under the one arriving. */
  out: Keyframe[] | null;
  /** The slide arriving. For a wipe, the mask it is seen through. */
  in: Keyframe[];
  /** A wipe's slide inside its mask, moving against the mask so the slide itself holds still. */
  inner: Keyframe[] | null;
}

/** Which way the arriving slide starts, in whole slide widths and heights. */
const START: Record<Side, readonly [number, number]> = { left: [-100, 0], right: [100, 0], top: [0, -100], bottom: [0, 100] };

const move = (x: number, y: number): string => `translate(${x}%, ${y}%)`;
const at = (x: number, y: number): Keyframe[] => [{ transform: move(x, y) }, { transform: move(0, 0) }];

const EASE_MOVE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const EASE_IN = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

export function plan(r: Resolved): Plan {
  const [sx, sy] = START[r.from];
  switch (r.kind) {
    case 'fade':
      return { duration: r.duration, easing: EASE_MOVE, out: null, in: [{ opacity: 0 }, { opacity: 1 }], inner: null };
    case 'push':
      return {
        duration: r.duration,
        easing: EASE_MOVE,
        out: [{ transform: move(0, 0) }, { transform: move(-sx, -sy) }],
        in: at(sx, sy),
        inner: null
      };
    case 'wipe':
      // The mask comes in from the side, the slide inside it goes the other way by the same amount
      // under the same easing, so the two cancel and the slide does not move.
      return { duration: r.duration, easing: EASE_MOVE, out: null, in: at(sx, sy), inner: at(-sx, -sy) };
    case 'zoom':
      // Forward: the old slide comes towards the viewer and the new one settles in under it, so
      // there is never a gap. Back: the earlier slide arrives from the viewer's side.
      return r.reverse
        ? {
            duration: r.duration,
            easing: EASE_IN,
            out: null,
            in: [
              { transform: 'scale(1.12)', opacity: 0 },
              { transform: 'scale(1)', opacity: 1 }
            ],
            inner: null
          }
        : {
            duration: r.duration,
            easing: EASE_IN,
            out: [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }],
            in: [
              { transform: 'scale(0.92)', opacity: 0 },
              { transform: 'scale(1)', opacity: 1 }
            ],
            inner: null
          };
  }
}

/** Every CSS property a plan animates. The motion rule is that this is a subset of transform and opacity. */
export function animatedProperties(p: Plan): Set<string> {
  const out = new Set<string>();
  for (const frames of [p.out, p.in, p.inner]) {
    for (const f of frames ?? []) for (const k of Object.keys(f)) if (k !== 'offset' && k !== 'easing' && k !== 'composite') out.add(k);
  }
  return out;
}
