// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelOf, testDeck } from '../model/testing';
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

function setup(over: { onMenu?: boolean; answer?: boolean } = {}) {
  const model = modelOf(testDeck(['a', 'b', 'c'].map((id) => ({ id, layout: 'blank', elements: [] }))));
  const selection = new SelectionStore();
  selection.set({ slide: 'a', slides: ['a'], focus: 'canvas' });
  const onMenu = vi.fn(() => over.answer ?? true);
  act(() => root.render(<Rail model={model} selection={selection} editable peers={[]} focusCanvas={() => undefined} {...(over.onMenu === false ? {} : { onMenu })} />));
  return { model, selection, onMenu };
}

const item = (id: string): HTMLElement => host.querySelector<HTMLElement>(`[data-slide="${id}"]`)!;
const rightClick = (id: string, init: MouseEventInit = {}) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 50, ...init });
  act(() => void item(id).dispatchEvent(e));
  return e;
};

describe('the rail\'s right click', () => {
  it('chooses the slide under it, asks for the slide menu for the chosen slides there, and takes the browser\'s', () => {
    const t = setup();
    const e = rightClick('b');
    expect(t.selection.get().slides).toEqual(['b']);
    expect(t.selection.get().focus).toBe('rail');
    expect(t.onMenu).toHaveBeenCalledWith(['b'], { x: 30, y: 50 }, host.querySelector('.sl-rail'));
    expect(e.defaultPrevented).toBe(true);
  });

  it('keeps several chosen slides when the click is on one of them', () => {
    const t = setup();
    t.selection.set({ slide: 'a', slides: ['a', 'b'] });
    rightClick('b');
    expect(t.onMenu).toHaveBeenCalledWith(['a', 'b'], expect.anything(), expect.anything());
  });

  it('leaves the browser\'s menu where there is no menu to show', () => {
    setup({ answer: false });
    expect(rightClick('b').defaultPrevented).toBe(false);
    setup({ onMenu: false });
    expect(rightClick('b').defaultPrevented).toBe(false);
  });

  it('leaves the browser\'s menu to Shift', () => {
    const t = setup();
    expect(rightClick('b', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(t.onMenu).not.toHaveBeenCalled();
  });

  it('opens from the menu key at the slide on the canvas', () => {
    const t = setup();
    const rail = host.querySelector<HTMLElement>('.sl-rail')!;
    item('a').getBoundingClientRect = () => ({ left: 10, top: 20, right: 150, bottom: 100, width: 140, height: 80, x: 10, y: 20, toJSON: () => ({}) });
    const e = new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true });
    act(() => void rail.dispatchEvent(e));
    expect(t.onMenu).toHaveBeenCalledWith(['a'], { x: 34, y: 44 }, rail);
  });
});
