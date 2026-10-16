// @vitest-environment happy-dom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { box, modelOf, testDeck } from '../model/testing';
import { Canvas, type CanvasProps } from './Canvas';
import { SelectionStore } from './selection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(editable: boolean) {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ ...box(100, 100, 400, 200), id: 'a' }] }]));
  const selection = new SelectionStore({ slide: 's1', slides: ['s1'], els: ['a'], editing: null, focus: 'canvas' });
  const onReadOnlyEdit = vi.fn();
  const props: CanvasProps = {
    model,
    selection,
    editable,
    scale: 0.5,
    fit: true,
    peers: [],
    awareness: null,
    desk: createRef<HTMLDivElement>(),
    editStart: { current: null },
    onDeskSize: () => undefined,
    snap: () => null,
    layers: () => null,
    onEditor: () => undefined,
    onActivity: () => undefined,
    onNewSlide: () => undefined,
    onReadOnlyEdit
  };
  act(() => root.render(<Canvas {...props} />));
  const key = (k: string) => act(() => void host.querySelector('.sl-desk')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
  return { model, selection, onReadOnlyEdit, key };
}

describe('a key that would change the slide, on a page that cannot', () => {
  it('says so, for a character, Delete and Enter on a chosen box, and changes nothing', () => {
    const { model, selection, onReadOnlyEdit, key } = mount(false);
    key('x');
    key('Delete');
    key('Enter');
    expect(onReadOnlyEdit).toHaveBeenCalledTimes(3);
    expect(selection.get().editing).toBeNull();
    expect(model.slide('s1')!.elements.map((e) => e.id)).toEqual(['a']);
    // Moving round the slides is reading, not editing.
    key('PageDown');
    key('Escape');
    expect(onReadOnlyEdit).toHaveBeenCalledTimes(3);
    model.destroy();
  });

  it('is quiet where the slide can be changed', () => {
    const { onReadOnlyEdit, key, selection, model } = mount(true);
    key('x');
    expect(onReadOnlyEdit).not.toHaveBeenCalled();
    expect(selection.get().editing).toBe('a');
    model.destroy();
  });
});

describe('a drag', () => {
  it('lands where the button came up, when the last move has not been drawn yet', () => {
    const { model } = mount(true);
    const slide = host.querySelector('.sl-canvas')!;
    const fire = (type: string, x: number) =>
      slide.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: 100 }));
    // The box is 100 to 500 across on the slide, 50 to 250 on screen at half scale.
    act(() => void fire('pointerdown', 100));
    act(() => void fire('pointermove', 120));
    // The last move and the release together, with no render between them.
    act(() => {
      fire('pointermove', 150);
      fire('pointerup', 150);
    });
    expect(model.element('s1', 'a')).toMatchObject({ x: 200, y: 100 });
    model.destroy();
  });
});
