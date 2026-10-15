/**
 * Motion: the design system's numbers, and the few helpers the rest of the app
 * moves with.
 *
 * Every animation in Office comes from here or from a CSS class in styles.css that
 * uses the same tokens, so reduced motion is decided in two places and no more:
 * `motionOff()` below, and the `@media (prefers-reduced-motion)` and
 * `[data-motion="off"]` blocks in styles.css.
 *
 * The rules, from docs/design/README.md "Motion":
 *
 *   - 120ms for hover and press, 180ms for reveals and tab switches, 280ms for
 *     dialogs and panes, 420ms for a route change. Out is faster (120ms) and
 *     eases in.
 *   - Only `transform` and `opacity` animate, so the compositor runs the motion
 *     and it never costs a frame of typing. If you reach for `width`, `height`,
 *     `top` or `margin`, use `flip()` instead: change the layout at once and
 *     animate the difference with a transform.
 *   - Reduced motion drops the transform and keeps the opacity.
 *   - Never animate text as it is typed, your own caret, scrolling, or anything
 *     under a drag.
 *
 * Where to put a new motion:
 *
 *   enter or leave of one element      a CSS class (`oa-pop`, `oa-rise`, `oa-slide-in`,
 *                                      `oa-fade`) and `usePresence()` (presence.ts) for the leave
 *   a list or a set of cards moving    `useFlipList()` (flip.ts)
 *   a layout change you cannot avoid   `flip()` around it (flip.ts)
 *   a route or a dialog morphing       `viewTransition()` (viewTransition.ts)
 *   anything else, once                `animate()` below
 */

import { useSyncExternalStore } from 'react';

/** Milliseconds, matching `--dur-*` in tokens/motion.css. */
export const DUR = { instant: 80, fast: 120, base: 180, slow: 280, page: 420 } as const;

export const EASE = {
  /** Going in. */
  out: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  /** Going out: faster, and it eases in. */
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)'
} as const;

// ── reduced motion ──────────────────────────────────────────────────────────

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether movement is off: the reader asks for less of it, or the desktop app has
 * set `data-motion="off"` on the root from its own setting.
 */
export function motionOff(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.dataset.motion === 'off') return true;
  return typeof matchMedia === 'function' && matchMedia(QUERY).matches;
}

function subscribe(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const mql = typeof matchMedia === 'function' ? matchMedia(QUERY) : null;
  mql?.addEventListener('change', cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    mql?.removeEventListener('change', cb);
    mo.disconnect();
  };
}

/** `motionOff()` as state, for the rare render that has to choose. */
export function useMotionOff(): boolean {
  return useSyncExternalStore(subscribe, motionOff, () => true);
}

// ── keyframes ───────────────────────────────────────────────────────────────

/** Drop the properties that move, keep the ones that fade. */
export function withoutMovement(frames: Keyframe[]): Keyframe[] {
  const moving = ['transform', 'translate', 'scale', 'rotate'];
  return frames.map((f) => {
    const out: Keyframe = { ...f };
    for (const k of moving) delete out[k];
    return out;
  });
}

/** What a frame list animates, for deciding whether anything is left to run. */
const animatesSomething = (frames: Keyframe[]): boolean =>
  frames.some((f) => Object.keys(f).some((k) => k !== 'offset' && k !== 'easing' && k !== 'composite'));

/**
 * The enter shapes. Each is the state the element starts from; the element's own
 * style is where it ends, so none of them needs to know the resting value.
 */
export const ENTER: Record<'fade' | 'rise' | 'pop' | 'slideRight' | 'slideLeft', Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  /** Menus, dropdowns, popovers and the palette: 4px up. */
  rise: [
    { opacity: 0, transform: 'translateY(4px)' },
    { opacity: 1, transform: 'none' }
  ],
  /** Dialogs: 95 to 100%. Below about 0.94 the text visibly resamples on the way in. */
  pop: [
    { opacity: 0, transform: 'scale(0.95)' },
    { opacity: 1, transform: 'none' }
  ],
  /** A pane from the right edge: 16px and a fade. */
  slideRight: [
    { opacity: 0, transform: 'translateX(16px)' },
    { opacity: 1, transform: 'none' }
  ],
  slideLeft: [
    { opacity: 0, transform: 'translateX(-16px)' },
    { opacity: 1, transform: 'none' }
  ]
};

export interface AnimateOptions {
  duration?: number;
  easing?: string;
  delay?: number;
  fill?: FillMode;
}

/**
 * Run keyframes on an element, through the Web Animations API.
 *
 * Returns null when nothing ran: movement is off and the frames only move, or the
 * environment has no `animate` (a test's DOM). Callers never need to check; they
 * can await `finished(animation)` either way.
 */
export function animate(el: Element, frames: Keyframe[], options: AnimateOptions = {}): Animation | null {
  if (typeof (el as HTMLElement).animate !== 'function') return null;
  const run = motionOff() ? withoutMovement(frames) : frames;
  if (!animatesSomething(run)) return null;
  return el.animate(run, {
    duration: options.duration ?? DUR.slow,
    easing: options.easing ?? EASE.out,
    delay: options.delay ?? 0,
    fill: options.fill ?? 'both'
  });
}

/** Resolves when the animation has finished or been cancelled; at once for null. */
export function finished(animation: Animation | null): Promise<void> {
  if (!animation) return Promise.resolve();
  return animation.finished.then(
    () => undefined,
    () => undefined
  );
}

/** Play an enter shape on an element that has just been added. */
export function enter(el: Element, kind: keyof typeof ENTER, options: AnimateOptions = {}): Animation | null {
  return animate(el, ENTER[kind], { duration: kind === 'rise' || kind === 'fade' ? DUR.base : DUR.slow, ...options });
}

/** The leave shape: the enter, backwards, and faster. */
export function leave(el: Element, kind: keyof typeof ENTER, options: AnimateOptions = {}): Promise<void> {
  const frames = [...ENTER[kind]].reverse();
  return finished(animate(el, frames, { duration: DUR.fast, easing: EASE.in, ...options }));
}
