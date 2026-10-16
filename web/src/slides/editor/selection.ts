/**
 * What is chosen in the editor: the slide on the canvas, the slides chosen in the rail, the
 * elements chosen on the slide, and the shape whose text has the caret.
 *
 * It is a store and not React state, because the rail, the canvas, the ribbon and the footer each
 * follow it and none of them should re-render the page when it changes. A component reads it with
 * `useSelection`; a command reads `get()` when it runs.
 *
 * It is this person's alone and never written to the deck. Other people see it through awareness
 * (presence.ts). When the deck changes under it (somebody deleted the slide on screen, or the
 * element chosen), `repair` drops what is gone and keeps the canvas on the nearest slide.
 */

import { useSyncExternalStore } from 'react';

export interface Selection {
  /** The slide on the canvas: null in a deck with no slides. */
  slide: string | null;
  /** The slides chosen in the rail, in deck order; `slide` is always one of them. */
  slides: readonly string[];
  /** Elements chosen on `slide`: top-level ids, or one group's children after a second click. */
  els: readonly string[];
  /** The shape whose text has the caret. It is in `els` too. */
  editing: string | null;
  /** Where the keyboard acts: the rail on slides, the canvas on elements. */
  focus: 'rail' | 'canvas';
}

export const EMPTY_SELECTION: Selection = { slide: null, slides: [], els: [], editing: null, focus: 'canvas' };

/** What `repair` needs to know of the deck. */
export interface DeckLookup {
  order: () => readonly string[];
  hasElement: (slideId: string, elId: string) => boolean;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export function sameSelection(a: Selection, b: Selection): boolean {
  return a.slide === b.slide && a.editing === b.editing && a.focus === b.focus && sameList(a.slides, b.slides) && sameList(a.els, b.els);
}

export class SelectionStore {
  private state: Selection;
  private listeners = new Set<() => void>();
  /** Where the slide on the canvas was, to stay near it when it is deleted. */
  private lastIndex = 0;

  constructor(initial: Selection = EMPTY_SELECTION) {
    this.state = initial;
  }

  get(): Selection {
    return this.state;
  }

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  set(patch: Partial<Selection>): void {
    const next = { ...this.state, ...patch };
    if (next.editing && !next.els.includes(next.editing)) next.els = [next.editing];
    if (next.slide && !next.slides.includes(next.slide)) next.slides = [next.slide];
    if (sameSelection(next, this.state)) return;
    this.state = next;
    for (const l of [...this.listeners]) l();
  }

  /**
   * A slide on the canvas. Alone, unless `extend`: `range` chooses every slide from the one on the
   * canvas to it (the rail's Shift), `toggle` adds it or takes it away (Ctrl).
   */
  showSlide(id: string, order: readonly string[], extend?: 'range' | 'toggle'): void {
    const at = order.indexOf(id);
    if (at < 0) return;
    this.lastIndex = at;
    const s = this.state;
    if (extend === 'range' && s.slide) {
      const from = order.indexOf(s.slide);
      const [a, b] = from < at ? [from, at] : [at, from];
      const slides = from < 0 ? [id] : order.slice(a, b + 1);
      this.set({ slide: id, slides, els: s.slide === id ? s.els : [], editing: null, focus: 'rail' });
      return;
    }
    if (extend === 'toggle' && s.slide) {
      const has = s.slides.includes(id);
      if (has && s.slides.length > 1) {
        const slides = s.slides.filter((x) => x !== id);
        const slide = id === s.slide ? slides[slides.length - 1]! : s.slide;
        this.set({ slide, slides, els: slide === s.slide ? s.els : [], editing: null, focus: 'rail' });
        return;
      }
      const slides = order.filter((x) => x === id || s.slides.includes(x));
      this.set({ slide: id, slides, els: [], editing: null, focus: 'rail' });
      return;
    }
    this.set({ slide: id, slides: [id], els: s.slide === id ? s.els : [], editing: s.slide === id ? s.editing : null });
  }

  /** Drop what the deck no longer has; keep the canvas on the nearest slide. */
  repair(deck: DeckLookup): void {
    const order = deck.order();
    const s = this.state;
    let slide = s.slide && order.includes(s.slide) ? s.slide : null;
    if (!slide && order.length) slide = order[Math.min(this.lastIndex, order.length - 1)]!;
    if (slide) this.lastIndex = order.indexOf(slide);
    const slides = order.filter((id) => id === slide || s.slides.includes(id));
    const sameSlide = slide === s.slide;
    const els = sameSlide && slide ? s.els.filter((id) => deck.hasElement(slide, id)) : [];
    const editing = sameSlide && slide && s.editing && els.includes(s.editing) ? s.editing : null;
    this.set({ slide, slides, els, editing });
  }
}

/** The selection, or a slice of it, re-rendering only when that slice changes. */
export function useSelection<T = Selection>(store: SelectionStore, pick: (s: Selection) => T = (s) => s as unknown as T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}
