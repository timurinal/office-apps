/**
 * The DOM that sits over the canvas: selection rectangles, other people's cursors, the
 * outlines of a formula's references, the clipboard's dashes, the fill handle and the guides
 * of a drag.
 *
 * Each is a plain `div` placed with `transform`, which is all that is ever animated: the
 * selection glides to a new cell in 80ms on the compositor, and a scroll frame moves every one
 * of them with the canvas in the same task. A glide is only for a selection that moved by
 * itself: scrolling, a drag and a resize set the position outright, or the rectangle would
 * trail the cells it is on.
 *
 * The pool is imperative on purpose. These move on every scroll frame, and going through React
 * for sixty updates a second to move four rectangles is the one cost this page can avoid.
 */

import { DUR, EASE, enter, leave, motionOff } from '../../motion';
import type { Box } from './geometry';

export interface OverlayItem {
  key: string;
  boxes: readonly Box[];
  cls: string;
  vars?: Record<string, string>;
  /** Eased between positions when the frame allows it. */
  glide?: boolean;
  /** Fade in when it appears and out when it goes. */
  fade?: boolean;
  /** A name flag on the first box. */
  label?: string;
}

interface Entry {
  els: HTMLDivElement[];
  fade: boolean;
}

interface Placed {
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vars: string;
  label: string;
}

export class OverlayPool {
  private entries = new Map<string, Entry>();
  private placed = new WeakMap<HTMLElement, Placed>();

  constructor(private readonly host: HTMLElement) {}

  update(items: readonly OverlayItem[], animate: boolean): void {
    const seen = new Set<string>();
    const glide = animate && !motionOff();
    for (const it of items) {
      seen.add(it.key);
      let e = this.entries.get(it.key);
      if (!e) {
        e = { els: [], fade: it.fade === true };
        this.entries.set(it.key, e);
      }
      while (e.els.length < it.boxes.length) {
        const el = document.createElement('div');
        this.host.appendChild(el);
        if (it.fade) enter(el, 'fade', { duration: DUR.fast });
        e.els.push(el);
      }
      while (e.els.length > it.boxes.length) e.els.pop()!.remove();
      it.boxes.forEach((b, i) => this.place(e!.els[i]!, b, it, glide && it.glide === true, i === 0 ? (it.label ?? '') : ''));
    }
    for (const [key, e] of this.entries) {
      if (seen.has(key)) continue;
      this.entries.delete(key);
      // Only what faded in fades out: the fill handle and the selection are there or they are not.
      for (const el of e.els) {
        if (e.fade) void leave(el, 'fade').then(() => el.remove());
        else el.remove();
      }
    }
  }

  private place(el: HTMLDivElement, b: Box, it: OverlayItem, glide: boolean, label: string): void {
    const vars = it.vars ? Object.entries(it.vars).map(([k, v]) => `${k}:${v}`).join(';') : '';
    const last = this.placed.get(el);
    const reset = !last || last.vars !== vars;
    if (!last || last.cls !== it.cls) el.className = it.cls;
    if (reset) el.style.cssText = vars;
    // The transition is written together with the transform it is for, so the browser sees
    // both at once; a scroll frame turns it off and the rectangle lands where it belongs. An
    // element that has only just been made has nowhere to glide from.
    el.style.transition = glide && last ? `transform ${DUR.instant}ms ${EASE.out}` : 'none';
    if (reset || last.x !== b.x || last.y !== b.y) el.style.transform = `translate(${b.x}px, ${b.y}px)`;
    if (reset || last.w !== b.w) el.style.width = `${b.w}px`;
    if (reset || last.h !== b.h) el.style.height = `${b.h}px`;
    if (!last || last.label !== label) {
      el.replaceChildren();
      if (label) {
        const flag = document.createElement('span');
        flag.className = 'sg-flag';
        flag.textContent = label;
        el.appendChild(flag);
      }
    }
    // Only when it changes: a same-value write is still a style invalidation, and a remote edit that moves
    // nothing on this page redraws the overlays all the same.
    const flag = b.y < 18 ? 'in' : 'out';
    if (el.dataset.flag !== flag) el.dataset.flag = flag;
    this.placed.set(el, { cls: it.cls, x: b.x, y: b.y, w: b.w, h: b.h, vars, label });
  }

  clear(): void {
    for (const e of this.entries.values()) for (const el of e.els) el.remove();
    this.entries.clear();
  }
}
