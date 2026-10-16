// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transition } from '../model/deck';
import { modelOf, testDeck } from '../model/testing';
import { previewRequests, previewSlide } from '../present/previewBus';
import { Rail } from './Rail';
import { SelectionStore } from './selection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const TRANSITIONS: Record<string, Transition> = { b: { kind: 'fade' }, c: { kind: 'push', from: 'left' }, d: { kind: 'none' }, e: { kind: 'wipe' } };

function setup(transitions: Record<string, Transition> = TRANSITIONS, o: { edit?: boolean } = {}) {
  const model = modelOf(testDeck(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, layout: 'blank', elements: [], ...(transitions[id] ? { transition: transitions[id] } : {}) }))));
  const selection = new SelectionStore();
  selection.set({ slide: 'a', slides: ['a'], focus: 'canvas' });
  act(() => root.render(<Rail model={model} selection={selection} editable={o.edit ?? true} peers={[]} focusCanvas={() => undefined} />));
  return { model, selection };
}

const marker = (id: string): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>(`[data-slide="${id}"] [data-preview]`);
const press = (el: Element, type: string, init: MouseEventInit = {}) => {
  const e = type.startsWith('pointer') ? new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init }) : new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => void el.dispatchEvent(e));
  return e;
};
const click = (el: Element) => {
  press(el, 'pointerdown');
  press(el, 'pointerup');
  return press(el, 'click');
};

describe('the transition marker in the rail', () => {
  it('is under the number of each slide that has a transition, and of no other', () => {
    setup();
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => !!marker(id))).toEqual([false, true, true, false, true]);
    // Under the number: in its column, after it.
    const col = host.querySelector('[data-slide="b"] .sl-rail-num')!;
    expect(col.contains(marker('b'))).toBe(true);
    expect(col.firstElementChild!.textContent).toBe('2');
  });

  it('is a button named for the transition, so it can be told from the slide’s own option', () => {
    setup();
    expect(marker('b')!.tagName).toBe('BUTTON');
    expect(marker('b')!.getAttribute('aria-label')).toBe('Preview transition: Fade');
    expect(marker('c')!.getAttribute('aria-label')).toBe('Preview transition: Push');
    expect(marker('e')!.getAttribute('aria-label')).toBe('Preview transition: Wipe');
    expect(marker('b')!.title).toBe('Preview transition: Fade');
    // The number stays out of a screen reader's way: the option says it.
    expect(host.querySelector('[data-slide="b"] .sl-rail-num > [aria-hidden="true"]')!.textContent).toBe('2');
  });

  it('is not added by a transition the deck stores as none, which a file can carry', () => {
    setup();
    expect(marker('d')).toBeNull();
  });

  it('is not added by a transition whose kind this build does not know', () => {
    setup({ b: { kind: 'spin' as Transition['kind'] } });
    expect(marker('b')).toBeNull();
  });

  it('comes with a transition set after the rail was drawn, and goes with it', () => {
    vi.useFakeTimers();
    try {
      const t = setup({});
      expect(host.querySelectorAll('[data-preview]')).toHaveLength(0);
      act(() => void t.model.setSlides(['c'], { transition: { kind: 'zoom' } }));
      // A change inside a slide is drawn a moment after, in a transition (RAIL_DELAY_MS).
      act(() => void vi.advanceTimersByTime(400));
      expect(marker('c')?.getAttribute('aria-label')).toBe('Preview transition: Zoom');
      act(() => void t.model.setSlides(['c'], { transition: null }));
      act(() => void vi.advanceTimersByTime(400));
      expect(marker('c')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows to a reader who cannot edit, who can look at a transition as anyone can', () => {
    setup(TRANSITIONS, { edit: false });
    expect(marker('b')).not.toBeNull();
  });

  it('is not a tab stop: a deck of a hundred transitions is not a hundred of them, and the ribbon’s Preview is the keyboard’s', () => {
    setup();
    expect(marker('b')!.tabIndex).toBe(-1);
  });
});

describe('pressing the marker', () => {
  it('selects that slide, and asks for its preview by name', () => {
    const t = setup();
    const before = previewRequests();
    click(marker('c')!);
    expect(t.selection.get().slide).toBe('c');
    expect(t.selection.get().slides).toEqual(['c']);
    expect(previewRequests()).toBe(before + 1);
    expect(previewSlide()).toBe('c');
  });

  it('changes nothing about the selection but the slide: the press itself is not a click on the thumbnail', () => {
    const t = setup();
    t.selection.set({ slide: 'a', slides: ['a'], els: ['x'], focus: 'canvas' });
    press(marker('b')!, 'pointerdown');
    expect(t.selection.get()).toMatchObject({ slide: 'a', slides: ['a'], els: ['x'], focus: 'canvas' });
    press(marker('b')!, 'pointerup');
    expect(t.selection.get().slide).toBe('a');
  });

  it('does not begin a drag of the slide, or take the pointer from the marker', () => {
    const t = setup();
    const list = host.querySelector('.sl-rail-list')!;
    const capture = vi.fn();
    (list as unknown as { setPointerCapture: unknown }).setPointerCapture = capture;
    press(marker('b')!, 'pointerdown', { clientX: 5, clientY: 5 });
    press(marker('b')!, 'pointermove', { clientX: 5, clientY: 200 });
    press(marker('b')!, 'pointerup', { clientX: 5, clientY: 200 });
    expect(capture).not.toHaveBeenCalled();
    expect(host.querySelector('.sl-rail-drop')).toBeNull();
    expect(t.model.order().join('')).toBe('abcde');
  });

  it('keeps several chosen slides when it is on the slide that is on the canvas, and previews that one', () => {
    const t = setup();
    t.selection.set({ slide: 'b', slides: ['a', 'b', 'c'], focus: 'canvas' });
    const before = previewRequests();
    click(marker('b')!);
    expect(t.selection.get().slides).toEqual(['a', 'b', 'c']);
    expect(previewRequests()).toBe(before + 1);
    expect(previewSlide()).toBe('b');
  });

  it('leaves the caret where it was on the slide it is on: a press does not take focus', () => {
    const t = setup();
    t.selection.set({ slide: 'b', slides: ['b'], els: ['x'], editing: 'x', focus: 'canvas' });
    const down = press(marker('b')!, 'mousedown');
    expect(down.defaultPrevented).toBe(true);
    click(marker('b')!);
    expect(t.selection.get()).toMatchObject({ slide: 'b', els: ['x'], editing: 'x', focus: 'canvas' });
  });

  it('previews again each time it is pressed', () => {
    setup();
    const before = previewRequests();
    click(marker('b')!);
    click(marker('b')!);
    expect(previewRequests()).toBe(before + 2);
  });
});
