/**
 * Ctrl and the wheel, a pinch, and Ctrl with = - 0: the editor's zoom, never the browser's.
 *
 * The browser's zoom is the wrong one in an editor: it scales the chrome with the page, and the
 * desktop app keeps it per site, so every document after opens at it. While an editor is on screen
 * one listener for the wheel and one for the keys, on the window, take both:
 *
 *   wheel   Ctrl and a notched wheel steps by ten, to the next ten. A trackpad pinch, which the
 *           browser reports as Ctrl and a small fractional delta, zooms smoothly by a factor. The
 *           point under the pointer holds still.
 *   keys    Ctrl+= or Ctrl++ (with or without Shift, and the keypad's) in, Ctrl+- out, Ctrl+0 back
 *           to where the editor starts: Fit in Slides, 100% in Docs and Sheets. The centre of the
 *           view holds still.
 *
 * Both prevent the browser's default. The wheel is taken anywhere on the page, over a field or a
 * dialog too, since the browser's zoom there would scale the whole site and be remembered. The
 * keys are not taken in a dialog, nor in a field outside the content such as the zoom slider or a
 * Find box; inside it they are: a Docs page and a Slides text box are editable text rather than
 * fields, and a cell's editor is inside `[data-zoom-content]`. A key that something else has
 * already taken (Sheets' Ctrl+- on whole rows) is left to it. While Slides' show is on screen,
 * the editor turns all of it off and the show's wheel and keys are its own.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export interface Pt {
  x: number;
  y: number;
}

/** Percent per notch, and what a pinch's delta is divided by for its factor. */
const NOTCH = 10;
const PINCH = 100;

/** `next` within the range, except that a zoom outside the range never moves away from it. */
function towards(current: number, next: number, min: number, max: number): number {
  if (next < current) return Math.max(next, Math.min(min, current));
  if (next > current) return Math.min(next, Math.max(max, current));
  return current;
}

/** One step of ten in or out, to the next multiple of ten: 87 in is 90, and 90 in is 100. */
export function stepZoom(current: number, dir: 1 | -1, min: number, max: number): number {
  const next = dir > 0 ? Math.floor(current / NOTCH + 1e-9) * NOTCH + NOTCH : Math.ceil(current / NOTCH - 1e-9) * NOTCH - NOTCH;
  return towards(current, next, min, max);
}

/** A wheel's zoom: a notch (lines, or a big pixel delta) steps by ten; anything finer, a pinch, scales. */
export function wheelZoom(current: number, e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, min: number, max: number): number {
  if (!e.deltaY) return current;
  if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) return stepZoom(current, e.deltaY < 0 ? 1 : -1, min, max);
  return towards(current, current * Math.exp(-e.deltaY / PINCH), min, max);
}

/** Which zoom key an event is, if any. */
export function zoomKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): 'in' | 'out' | 'reset' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') return 'in';
  if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') return 'out';
  if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') return 'reset';
  return null;
}

/** Whether a zoom key at `target` is the zoom's: not in a dialog, nor in a field outside the content. */
export function keyZoomsHere(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest('[role="dialog"], [role="alertdialog"], dialog')) return false;
  return !(target.closest('input, textarea, select') && !target.closest('[data-zoom-content]'));
}

export interface ZoomGesture {
  /** False while the content is not what is on screen (Slides' show): the browser has it all. */
  enabled?: boolean;
  /** The zoom now, as a percentage. */
  value: number;
  min: number;
  max: number;
  /** Zoom to a whole `percent`, holding `at` (client px) still, or the centre of the view for null. */
  set: (percent: number, at: Pt | null) => void;
  /** Ctrl+0. */
  reset: () => void;
}

/** The wheel and the keys, for as long as the component that calls this is mounted. */
export function useZoomGesture(g: ZoomGesture): void {
  const latest = useRef(g);
  latest.current = g;
  const enabled = g.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    // What was asked for last, unrounded, so that a pinch's small steps add up instead of each
    // rounding away; and the zoom it was asked from, for a second event before the first is drawn.
    let asked: { value: number; from: number } | null = null;
    const now = (): number => {
      const v = latest.current.value;
      return asked && (Math.round(asked.value) === v || asked.from === v) ? asked.value : v;
    };
    const go = (next: number, at: Pt | null) => {
      const g = latest.current;
      const from = g.value;
      asked = { value: next, from };
      if (Math.round(next) !== from) g.set(Math.round(next), at);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const g = latest.current;
      const base = now();
      const next = wheelZoom(base, e, g.min, g.max);
      if (next !== base) go(next, { x: e.clientX, y: e.clientY });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const key = zoomKey(e);
      if (!key || !keyZoomsHere(e.target)) return;
      e.preventDefault();
      const g = latest.current;
      if (key === 'reset') {
        asked = null;
        g.reset();
        return;
      }
      const base = now();
      const next = stepZoom(base, key === 'in' ? 1 : -1, g.min, g.max);
      if (next !== base) go(next, null);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled]);
}

/**
 * Holds a point of the content still across a zoom. Call the function it returns just before the
 * zoom changes, with the client point to hold (null for the centre of `scroller`); once the new
 * `scale` is drawn, `scroller` is scrolled so that the same point of the content is there again.
 * Where the content is smaller than the scroller and centred in it, there is nothing to scroll.
 */
export function useHoldStill(scroller: () => HTMLElement | null, content: () => Element | null, scale: number): (at: Pt | null) => void {
  const pending = useRef<{ at: Pt; left: number; top: number; scale: number } | null>(null);
  const current = useRef(scale);
  current.current = scale;
  const find = useRef({ scroller, content });
  find.current = { scroller, content };

  // The first render after the call is the zoom's; one that did not change the scale drops it.
  useLayoutEffect(() => {
    const p = pending.current;
    pending.current = null;
    if (!p || p.scale === scale) return;
    const s = find.current.scroller();
    const c = find.current.content();
    if (!s || !c) return;
    const r = c.getBoundingClientRect();
    const k = scale / p.scale;
    s.scrollLeft += r.left + (p.at.x - p.left) * k - p.at.x;
    s.scrollTop += r.top + (p.at.y - p.top) * k - p.at.y;
  });

  return useCallback((at: Pt | null) => {
    const s = find.current.scroller();
    const c = find.current.content();
    if (!s || !c) return;
    // A second call before the first zoom is drawn keeps the first's starting point.
    if (pending.current) {
      if (at) pending.current.at = at;
      return;
    }
    const v = s.getBoundingClientRect();
    const r = c.getBoundingClientRect();
    pending.current = { at: at ?? { x: v.left + s.clientWidth / 2, y: v.top + s.clientHeight / 2 }, left: r.left, top: r.top, scale: current.current };
  }, []);
}
