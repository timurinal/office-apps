/**
 * FLIP: First, Last, Invert, Play.
 *
 * Change the layout straight away, then animate the *difference* with a
 * transform. It is how a list re-sorts, a margin card slides to where the text
 * moved, and the page glides to its new centre when a pane opens, without ever
 * animating `top`, `left` or `margin`.
 *
 * Positions are kept relative to a container, not the viewport, so a scroll
 * between two measurements is not read as movement.
 */

import { useCallback, useLayoutEffect, useRef } from 'react';
import { animate, DUR, EASE } from './index';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The transform that puts an element at `from` while it is laid out at `to`, or
 *  null when it has not moved enough to see. */
export function invert(
  from: Box,
  to: Box,
  { scale = false, epsilon = 0.5 }: { scale?: boolean; epsilon?: number } = {}
): { dx: number; dy: number; sx: number; sy: number } | null {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const sx = scale && to.w > 0 ? from.w / to.w : 1;
  const sy = scale && to.h > 0 ? from.h / to.h : 1;
  if (Math.abs(dx) < epsilon && Math.abs(dy) < epsilon && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
    return null;
  }
  return { dx, dy, sx, sy };
}

/** An element's box, relative to a container's origin (the viewport's if none). */
export function boxOf(el: Element, container?: Element | null): Box {
  const r = el.getBoundingClientRect();
  const o = container?.getBoundingClientRect();
  return { x: r.left - (o?.left ?? 0), y: r.top - (o?.top ?? 0), w: r.width, h: r.height };
}

/**
 * Animate one element from where it was to where it is now. `from` is its box
 * before the change, measured by the caller; this measures the box after.
 */
export function flip(
  el: Element,
  from: Box,
  options: { container?: Element | null; scale?: boolean; duration?: number } = {}
): Animation | null {
  const to = boxOf(el, options.container);
  const t = invert(from, to, { scale: options.scale ?? false });
  if (!t) return null;
  const start = `translate(${t.dx}px, ${t.dy}px)${options.scale ? ` scale(${t.sx}, ${t.sy})` : ''}`;
  return animate(el, [{ transform: start }, { transform: 'none' }], {
    duration: options.duration ?? DUR.slow,
    easing: EASE.out,
    fill: 'none'
  });
}

/**
 * A list whose members move. Give the container's ref to the element that holds
 * them and `item(key)` to each member; whenever `keys` changes, every member that
 * has moved slides from its old place to its new one.
 *
 * A member that is new does not animate here (give it an enter class), and one
 * that is gone is not drawn, so a leaver needs `usePresence` to hold it for a
 * moment.
 */
export function useFlipList(keys: readonly string[], options: { duration?: number } = {}) {
  const container = useRef<HTMLElement | null>(null);
  const members = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, Box>());

  useLayoutEffect(() => {
    const next = new Map<string, Box>();
    for (const [key, el] of members.current) {
      const to = boxOf(el, container.current);
      next.set(key, to);
      const from = before.current.get(key);
      if (from) flip(el, from, { container: container.current, ...options });
    }
    before.current = next;
    // `options` is read, not a trigger: a new object each render must not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join('\u0000')]);

  const item = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) members.current.set(key, el);
      else members.current.delete(key);
    },
    []
  );

  return { container, item };
}

/**
 * An element that glides to where a layout change leaves it. Give the returned ref
 * to the element, and list what changes the layout around it in `deps`; when one
 * of them changes, the element is laid out in its new place at once and plays the
 * distance back as a transform. It is how the page moves to its new centre when a
 * pane opens, and how it settles after the ribbon collapses.
 *
 * It measures with `offsetLeft` and `offsetTop`, which a scroll and a transform in
 * flight do not move, so a glide begun during another starts from where the element
 * really is. Only the first change after mount and after a window resize is skipped:
 * there is nothing to glide from.
 */
export function useGlide<T extends HTMLElement>(deps: readonly unknown[], options: { duration?: number } = {}) {
  const ref = useRef<T | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const now = { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop };
    const was = last.current;
    last.current = now;
    if (!was) return;
    const dx = was.x - now.x;
    const dy = was.y - now.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: options.duration ?? DUR.slow,
      easing: EASE.out,
      fill: 'none'
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useLayoutEffect(() => {
    const forget = () => {
      last.current = null;
    };
    window.addEventListener('resize', forget);
    return () => window.removeEventListener('resize', forget);
  }, []);

  return ref;
}
