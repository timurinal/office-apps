/**
 * The two layers other people's carets are drawn in, beside an editor's root and never inside it.
 *
 *   .oa-carets-under   just before the root: each person's selection, as rectangles under the text
 *   .oa-carets         after it, above the text: each person's caret and name
 *
 * Both are zero-sized, absolutely placed at the same corner, `aria-hidden` and without the pointer.
 * Positions are measured in the window (`coordsAtPos`, `Range.getClientRects`) and turned into
 * the layers' own coordinates through their transform, read from a probe 1000px along the layer's
 * x axis. A layer inside a scaled slide or a zoomed page therefore scales with it, and scrolling
 * moves the layers with the text, so it needs no redraw. Inside a turned box (a rotated shape) a
 * client rectangle is the bounding box of what is turned, not where the text is, so the turn is
 * taken off while measuring and put back before anything is painted (`straighten`).
 */

import type { EditorView } from '@tiptap/pm/view';
import { animate, DUR, EASE } from '../../motion';

export interface CaretDraw {
  /** The awareness client: one caret each. */
  id: number;
  name: string;
  color: string;
  anchor: number;
  head: number;
  /** The move is the other person's (their caret or their edit), so it glides. */
  glide: boolean;
}

/** client = origin + [[a, -b], [b, a]] · local: a scale and a turn, as CSS transforms make them. */
interface Frame {
  ox: number;
  oy: number;
  a: number;
  b: number;
  /** The scale, |(a, b)|. */
  s: number;
}

interface Drawn {
  caret: HTMLElement;
  bar: HTMLElement;
  label: HTMLElement;
  sels: HTMLElement[];
  x: number;
  y: number;
  h: number;
  anim: Animation | null;
}

const PROBE = 1000;
/** Further than this on screen is a jump, not a glide. */
const GLIDE_MAX = 600;
/** A selection draws at most this many rectangles. */
const MAX_RECTS = 400;

const el = (cls: string): HTMLElement => {
  const e = document.createElement('div');
  e.className = cls;
  return e;
};

/** The probe is 1000px left of the layer's corner (carets.css), so it never widens what scrolls. */
function frameOf(layer: HTMLElement, probe: HTMLElement): Frame {
  const o = layer.getBoundingClientRect();
  const p = probe.getBoundingClientRect();
  const a = (o.left - p.left) / PROBE;
  const b = (o.top - p.top) / PROBE;
  const s = Math.hypot(a, b);
  // Not laid out (a test's DOM, a hidden pane): the layer's corner and no scale.
  return s > 1e-6 ? { ox: o.left, oy: o.top, a, b, s } : { ox: o.left, oy: o.top, a: 1, b: 0, s: 1 };
}

function toLocal(f: Frame, x: number, y: number): { x: number; y: number } {
  const dx = x - f.ox;
  const dy = y - f.oy;
  const s2 = f.s * f.s;
  return { x: (f.a * dx + f.b * dy) / s2, y: (f.a * dy - f.b * dx) / s2 };
}

/** A client rectangle in the layer's coordinates, by its centre and its size. */
function localRect(f: Frame, r: { left: number; top: number; right: number; bottom: number }) {
  const c = toLocal(f, (r.left + r.right) / 2, (r.top + r.bottom) / 2);
  const w = (r.right - r.left) / f.s;
  const h = (r.bottom - r.top) / f.s;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Take the turn off the editor's turned ancestors (a rotated shape's inline `rotate()`), and return
 * what puts it back. A transform moves no layout, so this costs a style pass and not a reflow, and
 * nothing is painted in between.
 */
function straighten(from: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  for (let e = from.parentElement; e && e !== document.body; e = e.parentElement) {
    const t = e.style.transform;
    if (!t.includes('rotate(')) continue;
    const box = e;
    box.style.transform = t.replace(/rotate\([^)]*\)/g, '').trim() || 'none';
    undo.push(() => {
      box.style.transform = t;
    });
  }
  return () => {
    for (const u of undo) u();
  };
}

/**
 * The client rectangles of the text between two positions, from the top-level blocks that are on
 * screen or within a screen of it: a selection of the whole of a long document is measured where
 * it can be seen. `culled` says some were left out, so a scroll has to draw again.
 */
export function rangeRects(view: EditorView, from: number, to: number): { rects: DOMRect[]; culled: boolean } {
  const rects: DOMRect[] = [];
  let range: Range;
  try {
    const a = view.domAtPos(from, 1);
    const b = view.domAtPos(to, -1);
    range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } catch {
    return { rects, culled: false };
  }
  const blocks: Element[] = [];
  view.state.doc.forEach((node, offset) => {
    if (offset + node.nodeSize <= from || offset >= to) return;
    const dom = view.nodeDOM(offset);
    if (dom instanceof Element) blocks.push(dom);
  });
  const height = window.innerHeight || 0;
  const top = -height;
  const bottom = 2 * height;
  // Blocks run down the page in order: the first one not wholly above the band.
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid]!.getBoundingClientRect().bottom < top) lo = mid + 1;
    else hi = mid;
  }
  let culled = lo > 0;
  const sub = document.createRange();
  outer: for (let i = lo; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.getBoundingClientRect().top > bottom) {
      culled = true;
      break;
    }
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text;
      if (!text.length || !range.intersectsNode(text)) continue;
      // A bullet, a page break or a widget's text is not the person's selection.
      const off = text.parentElement?.closest('[contenteditable="false"]');
      if (off && off !== view.dom && view.dom.contains(off)) continue;
      sub.selectNodeContents(text);
      if (text === range.startContainer) sub.setStart(text, range.startOffset);
      if (text === range.endContainer) sub.setEnd(text, range.endOffset);
      const list = sub.getClientRects();
      for (let k = 0; k < list.length; k++) {
        const r = list[k]!;
        if (r.width <= 0 || r.height <= 0) continue;
        rects.push(r);
        if (rects.length >= MAX_RECTS) break outer;
      }
    }
  }
  return { rects, culled };
}

export class CaretLayer {
  readonly under = el('oa-carets-under');
  readonly over = el('oa-carets');
  private readonly probe = el('oa-carets-probe');
  private readonly drawn = new Map<number, Drawn>();
  /** The last drawing left part of a selection out: a scroll draws again. */
  culled = false;

  constructor() {
    this.under.setAttribute('aria-hidden', 'true');
    this.over.setAttribute('aria-hidden', 'true');
    this.over.appendChild(this.probe);
  }

  get empty(): boolean {
    return this.drawn.size === 0;
  }

  /** The selections just before the root, so they are under its text; the carets after it. */
  private place(view: EditorView): boolean {
    const root = view.dom;
    const parent = root.parentElement;
    if (!parent) return false;
    if (this.under.parentElement !== parent || this.under.nextSibling !== root) parent.insertBefore(this.under, root);
    if (this.over.parentElement !== parent) parent.appendChild(this.over);
    return true;
  }

  render(view: EditorView, carets: readonly CaretDraw[]): void {
    if (!carets.length && this.empty) return;
    if (!this.place(view)) {
      this.clear();
      return;
    }
    let f = frameOf(this.over, this.probe);
    const turned = Math.abs(f.b) > 1e-6;
    const restore = turned ? straighten(view.dom) : null;
    if (restore) f = frameOf(this.over, this.probe);
    try {
      this.draw(view, f, carets);
    } finally {
      restore?.();
    }
  }

  private draw(view: EditorView, f: Frame, carets: readonly CaretDraw[]): void {
    const seen = new Set<number>();
    let culled = false;
    for (const c of carets) {
      let at: { left: number; right: number; top: number; bottom: number };
      try {
        at = view.coordsAtPos(c.head);
      } catch {
        continue;
      }
      seen.add(c.id);
      const box = localRect(f, at);
      const d = this.drawn.get(c.id) ?? this.make(c.id);
      d.caret.style.setProperty('--oa-caret-c', c.color);
      if (d.label.textContent !== c.name) d.label.textContent = c.name;
      this.move(d, f, round(box.x), round(box.y), round(box.h), c.glide);

      const sels: { x: number; y: number; w: number; h: number }[] = [];
      if (c.anchor !== c.head) {
        const res = rangeRects(view, Math.min(c.anchor, c.head), Math.max(c.anchor, c.head));
        culled ||= res.culled;
        for (const r of res.rects) sels.push(localRect(f, r));
      }
      this.selections(d, c.color, sels);
    }
    this.culled = culled;
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.remove(d);
      this.drawn.delete(id);
    }
  }

  private make(id: number): Drawn {
    const caret = el('oa-caret');
    const bar = el('oa-caret-bar');
    const label = el('oa-caret-label');
    caret.appendChild(bar);
    caret.appendChild(label);
    this.over.appendChild(caret);
    const d: Drawn = { caret, bar, label, sels: [], x: NaN, y: NaN, h: NaN, anim: null };
    this.drawn.set(id, d);
    return d;
  }

  private move(d: Drawn, f: Frame, x: number, y: number, h: number, glide: boolean): void {
    if (h !== d.h) {
      d.bar.style.height = `${h}px`;
      d.h = h;
    }
    if (x === d.x && y === d.y) return;
    const from = `translate(${d.x}px, ${d.y}px)`;
    const to = `translate(${x}px, ${y}px)`;
    const dx = (x - d.x) * f.s;
    const dy = (y - d.y) * f.s;
    const first = Number.isNaN(d.x);
    d.x = x;
    d.y = y;
    d.caret.style.transform = to;
    d.anim?.cancel();
    d.anim = null;
    if (first || !glide || Math.abs(dy) > GLIDE_MAX || Math.abs(dx) > GLIDE_MAX) return;
    d.anim = animate(d.caret, [{ transform: from }, { transform: to }], { duration: DUR.fast, easing: EASE.out, fill: 'none' });
    // The next move cancels it, which rejects `finished`; nothing waits on it.
    d.anim?.finished.catch(() => undefined);
  }

  private selections(d: Drawn, color: string, rects: readonly { x: number; y: number; w: number; h: number }[]): void {
    while (d.sels.length > rects.length) d.sels.pop()!.remove();
    rects.forEach((r, i) => {
      let s = d.sels[i];
      if (!s) {
        s = el('oa-caret-sel');
        this.under.appendChild(s);
        d.sels.push(s);
      }
      s.style.setProperty('--oa-caret-c', color);
      s.style.transform = `translate(${round(r.x)}px, ${round(r.y)}px)`;
      s.style.width = `${round(r.w)}px`;
      s.style.height = `${round(r.h)}px`;
    });
  }

  private remove(d: Drawn): void {
    d.anim?.cancel();
    d.caret.remove();
    for (const s of d.sels) s.remove();
  }

  private clear(): void {
    for (const d of this.drawn.values()) this.remove(d);
    this.drawn.clear();
  }

  destroy(): void {
    this.clear();
    this.under.remove();
    this.over.remove();
  }
}
