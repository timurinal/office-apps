// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionStore } from '../editor/selection';
import { modelOf, testDeck } from '../model/testing';
import type { SlidesContext } from '../modules/types';
import { Sorter } from './Sorter';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const COLS = 3;

// A browser lays the grid out; this DOM does not. Three to a row, 100 by 60, 20 between them.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const index = (el: HTMLElement): number => IDS.indexOf(el.getAttribute('data-slide') ?? '');
const layout: Record<string, (el: HTMLElement) => number> = {
  offsetLeft: (el) => (index(el) % COLS) * 120,
  offsetTop: (el) => Math.floor(index(el) / COLS) * 80,
  offsetWidth: () => 100,
  offsetHeight: () => 60
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  for (const [k, get] of Object.entries(layout)) {
    saved[k] = Object.getOwnPropertyDescriptor(proto, k);
    Object.defineProperty(proto, k, { configurable: true, get(this: HTMLElement) { return index(this) < 0 ? 0 : get(this); } });
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(proto, k, d);
    else delete proto[k];
  }
});

function setup(over: { edit?: boolean; hidden?: string[] } = {}) {
  const model = modelOf(testDeck(IDS.map((id) => ({ id, layout: 'blank', elements: [], ...(over.hidden?.includes(id) ? { hidden: true } : {}) }))));
  const selection = new SelectionStore();
  selection.set({ slide: 'a', slides: ['a'], focus: 'canvas' });
  const setView = vi.fn();
  const focusCanvas = vi.fn();
  const ctx = { model, selection, can: { edit: over.edit ?? true }, zoom: 100, fit: false, setView, actions: { focusCanvas } } as unknown as SlidesContext;
  act(() => root.render(<Sorter ctx={ctx} />));
  return { model, selection, ctx, setView, focusCanvas };
}

const options = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="option"]')];
const item = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-slide="${id}"]`)!;
const sorter = (): HTMLElement => host.querySelector<HTMLElement>('.sl-sorter')!;
const order = (m: ReturnType<typeof setup>['model']): string => m.order().join('');

type Mods = Partial<{ shiftKey: boolean; ctrlKey: boolean; button: number }>;
const pointer = (type: string, target: Element, x: number, y: number, mods: Mods = {}) =>
  act(() => void target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...mods })));
const click = (id: string, mods: Mods = {}) => {
  pointer('pointerdown', item(id), 5, 5, mods);
  pointer('pointerup', item(id), 5, 5, mods);
};
const undo = (m: ReturnType<typeof setup>['model']): boolean => {
  let did = false;
  act(() => void (did = m.undo()));
  return did;
};
const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => act(() => void sorter().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods })));

describe('the slide sorter', () => {
  it('draws every slide as an option, numbered, and says which is on the canvas, chosen and hidden', () => {
    setup({ hidden: ['c'] });
    expect(options().map((o) => o.getAttribute('aria-label'))).toEqual(['Slide 1', 'Slide 2', 'Slide 3, hidden', 'Slide 4', 'Slide 5', 'Slide 6', 'Slide 7']);
    expect(item('a').hasAttribute('data-active')).toBe(true);
    expect(item('a').getAttribute('aria-selected')).toBe('true');
    expect(item('b').getAttribute('aria-selected')).toBe('false');
    expect(item('c').hasAttribute('data-hidden')).toBe(true);
    expect(host.querySelector('.sl-sort-list')!.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('is sized by the zoom', () => {
    const t = setup();
    const list = host.querySelector<HTMLElement>('.sl-sort-list')!;
    expect(list.style.getPropertyValue('--sl-sort-w')).toBe('320px');
    act(() => root.render(<Sorter ctx={{ ...t.ctx, zoom: 150 }} />));
    expect(list.style.getPropertyValue('--sl-sort-w')).toBe('480px');
    act(() => root.render(<Sorter ctx={{ ...t.ctx, fit: true }} />));
    expect(list.style.getPropertyValue('--sl-sort-w')).toBe('224px');
  });

  it('takes the slide list’s keys, so Ctrl+D copies slides and Ctrl+A chooses them all', () => {
    const t = setup();
    expect(t.selection.get().focus).toBe('rail');
  });
});

describe('choosing', () => {
  it('a click shows the slide, Shift a range, Ctrl one more or one fewer', () => {
    const t = setup();
    click('c');
    expect(t.selection.get()).toMatchObject({ slide: 'c', slides: ['c'] });
    click('e', { shiftKey: true });
    expect(t.selection.get().slides).toEqual(['c', 'd', 'e']);
    click('a', { ctrlKey: true });
    expect(t.selection.get().slides).toEqual(['a', 'c', 'd', 'e']);
    click('d', { ctrlKey: true });
    expect(t.selection.get().slides).toEqual(['a', 'c', 'e']);
    expect(item('c').getAttribute('aria-selected')).toBe('true');
  });

  it('a press on one of several chosen waits for the release before it chooses that one alone', () => {
    const t = setup();
    click('a');
    click('c', { shiftKey: true });
    pointer('pointerdown', item('b'), 5, 5);
    expect(t.selection.get().slides).toEqual(['a', 'b', 'c']);
    pointer('pointerup', item('b'), 5, 5);
    expect(t.selection.get().slides).toEqual(['b']);
  });

  it('a double click opens the slide in Normal view, with the keyboard on it', async () => {
    const t = setup();
    act(() => void item('d').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(t.selection.get().slide).toBe('d');
    expect(t.setView).toHaveBeenCalledWith('normal');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(t.focusCanvas).toHaveBeenCalled();
  });
});

describe('the keyboard', () => {
  it('arrows step through the slides, Shift extends, Home and End jump', () => {
    const t = setup();
    key('ArrowRight');
    expect(t.selection.get().slide).toBe('b');
    key('ArrowRight', { shiftKey: true });
    expect(t.selection.get().slides).toEqual(['b', 'c']);
    key('End');
    expect(t.selection.get().slide).toBe('g');
    key('Home');
    expect(t.selection.get().slide).toBe('a');
    key('ArrowLeft');
    expect(t.selection.get().slide).toBe('a');
  });

  it('Up and Down go by a row', () => {
    const t = setup();
    key('ArrowDown');
    expect(t.selection.get().slide).toBe('d');
    key('ArrowUp');
    expect(t.selection.get().slide).toBe('a');
  });

  it('Enter opens the slide, Delete deletes the chosen', () => {
    const t = setup();
    key('ArrowRight');
    key('Enter');
    expect(t.setView).toHaveBeenCalledWith('normal');
    expect(t.selection.get().slide).toBe('b');
    key('Delete');
    expect(order(t.model)).toBe('acdefg');
    expect(t.selection.get().slide).toBe('c');
  });

  it('Alt with an arrow moves the chosen slides one place, as one step', () => {
    const t = setup();
    click('c');
    key('ArrowLeft', { altKey: true });
    expect(order(t.model)).toBe('acbdefg');
    key('ArrowRight', { altKey: true });
    key('ArrowRight', { altKey: true });
    expect(order(t.model)).toBe('abdcefg');
    // Each key is a step of its own.
    undo(t.model);
    expect(order(t.model)).toBe('abcdefg');
    undo(t.model);
    expect(order(t.model)).toBe('acbdefg');
    // At the start there is nowhere to go.
    click('a');
    key('ArrowLeft', { altKey: true });
    expect(order(t.model)).toBe('acbdefg');
  });
});

describe('dragging', () => {
  it('drops the chosen slide where the pointer lets go, as one step; one undo puts it back', () => {
    const t = setup();
    click('a');
    pointer('pointerdown', item('a'), 50, 30);
    // Past the threshold, then over the right half of the last slide in the second row (index 5, left 240): after it.
    pointer('pointermove', item('a'), 60, 35);
    expect(item('a').hasAttribute('data-dragging')).toBe(true);
    pointer('pointermove', item('a'), 320, 110);
    expect(host.querySelector('.sl-sort-drop')).not.toBeNull();
    pointer('pointerup', item('a'), 320, 110);
    expect(order(t.model)).toBe('bcdefag');
    expect(host.querySelector('.sl-sort-drop')).toBeNull();
    expect(undo(t.model)).toBe(true);
    expect(order(t.model)).toBe('abcdefg');
    expect(t.model.canUndo()).toBe(false);
  });

  it('drags every chosen slide together, in deck order', () => {
    const t = setup();
    click('b');
    click('d', { ctrlKey: true });
    pointer('pointerdown', item('d'), 50, 110);
    pointer('pointermove', item('d'), 60, 112);
    expect(item('b').hasAttribute('data-dragging')).toBe(true);
    expect(item('d').hasAttribute('data-dragging')).toBe(true);
    // Before the first slide.
    pointer('pointermove', item('d'), 10, 30);
    pointer('pointerup', item('d'), 10, 30);
    expect(order(t.model)).toBe('bdacefg');
  });

  it('a small movement is a click, not a drag', () => {
    const t = setup();
    pointer('pointerdown', item('b'), 50, 30);
    pointer('pointermove', item('b'), 52, 31);
    pointer('pointerup', item('b'), 52, 31);
    expect(order(t.model)).toBe('abcdefg');
    expect(t.selection.get().slide).toBe('b');
  });

  it('a cancelled drag changes nothing', () => {
    const t = setup();
    pointer('pointerdown', item('a'), 50, 30);
    pointer('pointermove', item('a'), 300, 110);
    pointer('pointercancel', item('a'), 300, 110);
    expect(order(t.model)).toBe('abcdefg');
    expect(host.querySelector('.sl-sort-drop')).toBeNull();
  });

  it('dropped where it was changes nothing and makes no undo entry', () => {
    const t = setup();
    pointer('pointerdown', item('b'), 170, 30);
    pointer('pointermove', item('b'), 180, 35);
    pointer('pointerup', item('b'), 180, 35);
    expect(order(t.model)).toBe('abcdefg');
    expect(t.model.canUndo()).toBe(false);
  });

  it('a reader cannot move a slide, and can still choose one', () => {
    const t = setup({ edit: false });
    pointer('pointerdown', item('a'), 50, 30);
    pointer('pointermove', item('a'), 300, 110);
    expect(host.querySelector('.sl-sort-drop')).toBeNull();
    pointer('pointerup', item('a'), 300, 110);
    expect(order(t.model)).toBe('abcdefg');
    key('Delete');
    expect(order(t.model)).toBe('abcdefg');
    click('c');
    expect(t.selection.get().slide).toBe('c');
  });
});

describe('the menu', () => {
  const rightClick = (id: string) => act(() => void item(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })));
  const rows = (): string[] => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent ?? '');
  const pick = (label: string) => act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === label)!.click());

  it('has the rail’s rows, and acts on the slide it was opened on', () => {
    const t = setup();
    rightClick('c');
    expect(rows()).toEqual(['New slide', 'Duplicate slide', 'Delete slide', 'Hide slide']);
    expect(t.selection.get().slide).toBe('c');
    pick('Hide slide');
    expect(t.model.slide('c')!.hidden).toBe(true);
    rightClick('c');
    expect(rows()[3]).toBe('Show slide');
    pick('Delete slide');
    expect(order(t.model)).toBe('abdefg');
  });

  it('says slides when several are chosen, and copies them', () => {
    const t = setup();
    click('a');
    click('b', { shiftKey: true });
    rightClick('a');
    expect(rows()).toEqual(['New slide', 'Duplicate slides', 'Delete slides', 'Hide slides']);
    pick('Duplicate slides');
    expect(t.model.order()).toHaveLength(9);
  });

  it('is not offered to a reader', () => {
    setup({ edit: false });
    rightClick('c');
    expect(rows()).toEqual([]);
  });
});

describe('after a drop', () => {
  /** Where each thumbnail is, from its place among its neighbours in the page, as a browser would lay the grid out. */
  const place = (el: HTMLElement) => {
    const i = [...el.parentElement!.children].filter((c) => c.hasAttribute('data-slide')).indexOf(el);
    return { left: (i % COLS) * 120, top: Math.floor(i / COLS) * 80, width: 100, height: 60, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
  };
  const animations: { id: string; frames: Keyframe[] }[] = [];
  const realRect = Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    animations.length = 0;
    Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.hasAttribute('data-slide') ? place(this) : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
    };
    (Element.prototype as unknown as { animate: unknown }).animate = function (this: HTMLElement, frames: Keyframe[]) {
      animations.push({ id: this.getAttribute('data-slide') ?? '', frames });
      return { finished: Promise.resolve() };
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = realRect;
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    delete document.documentElement.dataset.motion;
  });

  const dropFirstAtTheEnd = () => {
    pointer('pointerdown', item('a'), 50, 30);
    pointer('pointermove', item('a'), 60, 35);
    pointer('pointermove', item('a'), 320, 110);
    pointer('pointerup', item('a'), 320, 110);
  };

  it('the others glide to their places: each one that moved plays a transform, and the one that did not stays', () => {
    const t = setup();
    // The first layout is measured, and plays nothing.
    expect(animations).toEqual([]);
    dropFirstAtTheEnd();
    expect(order(t.model)).toBe('bcdefag');
    const moved = animations.map((a) => a.id).sort();
    expect(moved).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    for (const a of animations) {
      // Only transform moves: nothing here animates a position.
      expect(Object.keys(a.frames[0]!)).toEqual(['transform']);
      expect(a.frames[1]).toEqual({ transform: 'none' });
    }
    // Each starts where it was: the first slide at the top left, now at the end of the second row; the second, a column over.
    const from = (id: string) => animations.find((a) => a.id === id)!.frames[0]!.transform;
    expect(from('a')).toBe('translate(-240px, -80px)');
    expect(from('b')).toBe('translate(120px, 0px)');
    // 'g' sat in the last place before and after.
    expect(animations.some((a) => a.id === 'g')).toBe(false);
  });

  it('plays nothing when motion is off', () => {
    document.documentElement.dataset.motion = 'off';
    setup();
    dropFirstAtTheEnd();
    expect(animations).toEqual([]);
  });

  it('plays nothing for a change of size, which is not a drop', () => {
    const t = setup();
    act(() => root.render(<Sorter ctx={{ ...t.ctx, zoom: 140 }} />));
    expect(animations).toEqual([]);
  });
});
