// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionStore } from '../editor/selection';
import type { ElementJSON, TextDoc } from '../model/deck';
import { plainText } from '../model/schema';
import { box, modelOf, testDeck, txt } from '../model/testing';
import { FindHost } from './FindBar';
import { DEFAULT_FIND } from './findActions';
import { closeFind, findNow, openFind, setFind } from './findStore';
import { findModule } from './find';
import type { SlidesContext } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shape = (id: string, text: TextDoc): ElementJSON => ({ ...box(0, 0), id, text }) as ElementJSON;

function setup(over: { edit?: boolean } = {}) {
  const model = modelOf(
    testDeck([
      { id: 's1', layout: 'blank', elements: [shape('a', txt('Hello there')), shape('b', txt('say hello'))] },
      { id: 's2', layout: 'blank', elements: [shape('c', txt('Goodbye'))], notes: txt('hello notes') },
      { id: 's3', layout: 'blank', elements: [shape('d', txt('HELLO again'))] }
    ])
  );
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'], focus: 'canvas' });
  const calls: string[] = [];
  const notify = vi.fn();
  const ctx = {
    model,
    selection,
    can: { edit: over.edit ?? true },
    view: 'normal',
    slideIndex: 0,
    setView: (v: string) => void calls.push(`view:${v}`),
    select: {
      slide: (id: string) => void (calls.push(`slide:${id}`), selection.showSlide(id, model.order())),
      elements: (ids: string[]) => void calls.push(`elements:${ids.join(',')}`),
      editText: (el: string) => void calls.push(`edit:${el}`)
    },
    notes: { shown: true, setShown: (on: boolean) => void calls.push(`notes:${on}`) },
    actions: { focusCanvas: () => void calls.push('focus-canvas') },
    notify
  } as unknown as SlidesContext;
  return { model, ctx, calls, notify };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  closeFind();
  setFind({ replace: false, replacement: '', options: DEFAULT_FIND });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  closeFind();
});

const bar = (): HTMLElement | null => host.querySelector<HTMLElement>('[role="search"]');
const field = (label: string): HTMLInputElement => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (label: string): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;
const count = (): string => host.querySelector('.sl-find-count')!.textContent ?? '';
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const enter = (el: HTMLElement, shiftKey = false) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true })));
const render = (t: ReturnType<typeof setup>) => act(() => root.render(<FindHost ctx={t.ctx} />));

describe('opening the bar', () => {
  it('is not there until it is asked for, and asked for again puts the caret back in the field', () => {
    const t = setup();
    render(t);
    expect(bar()).toBeNull();
    act(() => openFind());
    expect(bar()).not.toBeNull();
    const input = field('Find');
    input.blur();
    act(() => openFind());
    expect(document.activeElement).toBe(input);
  });

  it('opens from the Find menu on Home, from Ctrl+F and Ctrl+H, and Replace is for someone who can edit', () => {
    expect(findModule.keys!.map((k) => k.keys)).toEqual(['Mod+F', 'Mod+H']);
    const t = setup({ edit: false });
    const replace = findModule.keys!.find((k) => k.keys === 'Mod+H')!;
    expect(replace.when!(t.ctx)).toBe(false);
    const find = findModule.keys!.find((k) => k.keys === 'Mod+F')!;
    expect(find.when).toBeUndefined();
    find.run(t.ctx);
    expect(findNow().open).toBe(true);
    const menu = findModule.ribbon[0]!.items[0]!;
    if (menu.type !== 'menu') throw new Error('a menu');
    expect(menu.entries.map((e) => e.label)).toEqual(['Find', 'Replace']);
    expect(menu.entries[1]!.disabled!(t.ctx)).toBe(true);
  });

  it('listens for Ctrl+F and Ctrl+H in a text box, where the page’s own keys are not heard', () => {
    const t = setup();
    const page = document.createElement('div');
    page.className = 'sl-page';
    const box = document.createElement('div');
    box.setAttribute('contenteditable', 'true');
    page.appendChild(box);
    document.body.appendChild(page);
    render(t);
    const press = (key: string, target: Element = box) => {
      const e = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
      act(() => void target.dispatchEvent(e));
      return e;
    };
    expect(press('f').defaultPrevented).toBe(true);
    expect(findNow().open).toBe(true);
    expect(findNow().replace).toBe(false);
    expect(press('h').defaultPrevented).toBe(true);
    expect(findNow().replace).toBe(true);
    // Not in a text box, or not on the page: the browser's.
    expect(press('f', page).defaultPrevented).toBe(false);
    const title = document.createElement('input');
    document.body.appendChild(title);
    expect(press('f', title).defaultPrevented).toBe(false);
    title.remove();
    page.remove();
  });
});

describe('searching', () => {
  it('counts what it finds as the person types, in every slide and the notes', () => {
    const t = setup();
    render(t);
    act(() => openFind());
    expect(count()).toBe('');
    type(field('Find'), 'hello');
    expect(count()).toBe('4 found');
    type(field('Find'), 'zebra');
    expect(count()).toBe('No matches');
    expect(button('Next match').disabled).toBe(true);
    type(field('Find'), 'hello');
    act(() => button('Notes').click());
    expect(count()).toBe('3 found');
    act(() => button('Match case').click());
    expect(count()).toBe('1 found');
  });

  it('goes to the next match from the slide on screen, and the one after, and wraps', () => {
    const t = setup();
    render(t);
    act(() => openFind());
    type(field('Find'), 'hello');
    enter(field('Find'));
    expect(t.calls).toEqual(['slide:s1', 'edit:a']);
    expect(count()).toBe('1 of 4');
    enter(field('Find'));
    expect(count()).toBe('2 of 4');
    expect(t.calls.slice(2)).toEqual(['slide:s1', 'edit:b']);
    // The third is in the notes of the second slide: the notes are shown, with no box entered.
    enter(field('Find'));
    expect(count()).toBe('3 of 4');
    expect(t.calls.slice(4)).toEqual(['slide:s2', 'notes:true']);
    act(() => button('Next match').click());
    expect(count()).toBe('4 of 4');
    expect(t.calls.slice(6)).toEqual(['slide:s3', 'edit:d']);
    // Past the last, round to the first.
    enter(field('Find'));
    expect(count()).toBe('1 of 4');
    // And back, Shift+Enter or the button, wrapping the other way.
    enter(field('Find'), true);
    expect(count()).toBe('4 of 4');
    act(() => button('Previous match').click());
    expect(count()).toBe('3 of 4');
  });

  it('opens Normal view before showing a match, so it is never hidden in the sorter', () => {
    const t = setup();
    (t.ctx as unknown as { view: string }).view = 'sorter';
    render(t);
    act(() => openFind());
    type(field('Find'), 'goodbye');
    enter(field('Find'));
    expect(t.calls[0]).toBe('view:normal');
  });

  it('shows a reader the match’s box, chosen, and no caret', () => {
    const t = setup({ edit: false });
    render(t);
    act(() => openFind());
    type(field('Find'), 'goodbye');
    enter(field('Find'));
    expect(t.calls).toEqual(['slide:s2', 'elements:c']);
    // A reader has no replace row.
    expect(field('Replace with')).toBeNull();
  });

  it('closes with Escape or its button, and gives the slide the keyboard', () => {
    const t = setup();
    render(t);
    act(() => openFind());
    act(() => void field('Find').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(findNow().open).toBe(false);
    expect(t.calls).toContain('focus-canvas');
    act(() => openFind());
    act(() => button('Close find').click());
    expect(findNow().open).toBe(false);
  });

  it('remembers what was typed when it is closed and opened again', () => {
    const t = setup();
    render(t);
    act(() => openFind());
    type(field('Find'), 'hello');
    act(() => closeFind());
    act(() => openFind());
    expect(field('Find').value).toBe('hello');
  });
});

describe('replacing', () => {
  const texts = (m: ReturnType<typeof setup>['model']): string[] => m.order().flatMap((id) => m.slide(id)!.elements.map((e) => plainText((e as { text: TextDoc }).text)));

  it('shows the Replace row on Ctrl+H, or with its button', () => {
    const t = setup();
    render(t);
    act(() => openFind());
    expect(field('Replace with')).toBeNull();
    act(() => button('Replace').click());
    expect(field('Replace with')).not.toBeNull();
  });

  it('Replace changes the match gone to and moves on to the next', () => {
    const t = setup();
    render(t);
    act(() => openFind({ replace: true }));
    type(field('Find'), 'hello');
    type(field('Replace with'), 'hi');
    // The first press goes to the first match; the next replaces it.
    act(() => button('Replace').click());
    expect(count()).toBe('1 of 4');
    expect(texts(t.model)[0]).toBe('Hello there');
    act(() => button('Replace').click());
    expect(texts(t.model)[0]).toBe('hi there');
    // On to the next, not back to the same place.
    expect(t.calls.at(-1)).toBe('edit:b');
  });

  it('Replace does not find a replacement that contains the query again', () => {
    const t = setup();
    render(t);
    act(() => openFind({ replace: true }));
    type(field('Find'), 'hello');
    type(field('Replace with'), 'hello hello');
    act(() => button('Replace').click());
    act(() => button('Replace').click());
    expect(texts(t.model)[0]).toBe('hello hello there');
    expect(t.calls.at(-1)).not.toBe('edit:a');
  });

  it('Replace all is one step over every slide, says so, and one undo takes it all back', () => {
    const t = setup();
    render(t);
    act(() => openFind({ replace: true }));
    type(field('Find'), 'hello');
    type(field('Replace with'), 'hi');
    act(() => button('Replace all').click());
    expect(texts(t.model)).toEqual(['hi there', 'say hi', 'Goodbye', 'hi again']);
    expect(plainText(t.model.slide('s2')!.notes)).toBe('hi notes');
    expect(t.notify).toHaveBeenCalledWith({ text: 'Replaced 4 matches on 3 slides.' });
    act(() => void t.model.undo());
    expect(texts(t.model)).toEqual(['Hello there', 'say hello', 'Goodbye', 'HELLO again']);
    expect(plainText(t.model.slide('s2')!.notes)).toBe('hello notes');
    expect(t.model.canUndo()).toBe(false);
  });

  it('Replace all tells a reader, who cannot get here, nothing: the row is not drawn', () => {
    const t = setup({ edit: false });
    render(t);
    act(() => openFind({ replace: true }));
    expect(button('Replace all')).toBeUndefined();
  });
});
