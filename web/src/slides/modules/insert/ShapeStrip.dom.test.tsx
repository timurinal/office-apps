// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RibbonFitContext } from '../../../core/shell/Ribbon';
import { SelectionStore } from '../../editor/selection';
import { modelOf, testDeck } from '../../model/testing';
import type { SlidesContext } from '../types';
import { GALLERY_KINDS, HOME_SHAPES, HomeShapes, SHAPE_NAMES } from './ShapeGallery';
import { armedFor, disarm } from './tool';

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
  disarm();
});

function setup(o: { edit?: boolean; slide?: boolean; collapsed?: boolean } = {}) {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [] }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  const ctx = { model, selection, can: { edit: o.edit ?? true }, slideId: o.slide === false ? null : 's1', design: model.design(), actions: { focusCanvas: vi.fn() }, notify: vi.fn() } as unknown as SlidesContext;
  const render = (collapsed = o.collapsed ?? false) =>
    act(() =>
      root.render(
        <RibbonFitContext.Provider value={{ collapsed }}>
          <HomeShapes ctx={ctx} />
        </RibbonFitContext.Provider>
      )
    );
  render();
  return { model, selection, ctx, render };
}

const tile = (label: string): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>(`.sl-shapes-inline [data-rb-item][aria-label="${label}"]`);
const tiles = (): string[] => [...host.querySelectorAll('.sl-shapes-inline .sl-shape-mini')].map((b) => b.getAttribute('aria-label')!);
const click = (el: Element, detail = 1) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail })));
const opener = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('[data-id="home.shapes"]')!;
const popover = (): HTMLElement | null => host.querySelector<HTMLElement>('.sl-shapes');
const inPopover = (label: string): HTMLButtonElement => popover()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe('the shapes the strip keeps in reach', () => {
  it('are the shapes that are used most, each one the gallery has, once', () => {
    expect(HOME_SHAPES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(HOME_SHAPES).size).toBe(HOME_SHAPES.length);
    for (const p of HOME_SHAPES) expect(p === 'line' || p === 'arrow' || GALLERY_KINDS.includes(p), p).toBe(true);
    // Two rows of a whole number of columns: no row is short.
    expect(HOME_SHAPES.length % 2).toBe(0);
  });
});

describe('Home’s inline gallery, while the strip has room for it', () => {
  it('is those shapes, in order, as buttons named for them, and a button for the rest', () => {
    setup();
    expect(tiles()).toEqual(HOME_SHAPES.map((p) => (p === 'line' ? 'Line' : p === 'arrow' ? 'Arrow' : SHAPE_NAMES[p])));
    expect(host.querySelector('.sl-shapes-inline')!.getAttribute('aria-label')).toBe('Shapes');
    expect(opener().getAttribute('aria-label')).toBe('More shapes');
    expect(opener().getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('has each tile on the strip’s keyboard, so the arrows pass along it', () => {
    setup();
    for (const b of host.querySelectorAll('.sl-shapes-inline .sl-shape-mini')) expect((b as HTMLElement).hasAttribute('data-rb-item')).toBe(true);
    expect(new Set([...host.querySelectorAll('[data-rb-item]')].map((b) => (b as HTMLElement).dataset.id)).size).toBe(HOME_SHAPES.length + 1);
  });

  it('arms the shape on a press, as the gallery does, and shows which is armed', () => {
    const t = setup();
    click(tile('Oval')!);
    expect(armedFor(t.model)).toEqual({ kind: 'shape', shape: 'ellipse' });
    expect(tile('Oval')!.getAttribute('aria-pressed')).toBe('true');
    expect(tile('Rectangle')!.getAttribute('aria-pressed')).toBe('false');
    // A second press puts it away.
    click(tile('Oval')!);
    expect(armedFor(t.model)).toBeNull();
  });

  it('arms the line and the arrow tools, which the gallery’s Draw group has', () => {
    const t = setup();
    click(tile('Line')!);
    expect(armedFor(t.model)).toEqual({ kind: 'line', arrow: false });
    click(tile('Arrow')!);
    expect(armedFor(t.model)).toEqual({ kind: 'line', arrow: true });
  });

  it('places the shape in the middle of the slide on a press the keyboard made, which cannot drag', () => {
    const t = setup();
    click(tile('Rectangle')!, 0);
    const els = t.model.slide('s1')!.elements;
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'shape', shape: 'rect' });
    expect(t.selection.get().els).toEqual([els[0]!.id]);
    expect(armedFor(t.model)).toBeNull();
  });

  it('does exactly what the same tile in the full gallery does, for every one of them', () => {
    const t = setup();
    for (const p of HOME_SHAPES) {
      const label = p === 'line' ? 'Line' : p === 'arrow' ? 'Arrow' : SHAPE_NAMES[p];
      // Armed by the inline tile.
      click(tile(label)!);
      const inline = armedFor(t.model);
      disarm();
      // Armed by the gallery's.
      click(opener());
      click(inPopover(label));
      expect(armedFor(t.model), label).toEqual(inline);
      disarm();
      // Placed by a keyboard press on each.
      const before = t.model.slide('s1')!.elements.length;
      click(tile(label)!, 0);
      click(opener());
      click(inPopover(label), 0);
      const [a, b] = t.model.slide('s1')!.elements.slice(before);
      const { id: _a, ...first } = a!;
      const { id: _b, ...second } = b!;
      expect(second, label).toEqual(first);
    }
  });

  it('opens the whole gallery from its button, and puts it away after a choice', () => {
    setup();
    expect(popover()).toBeNull();
    click(opener());
    expect(opener().getAttribute('aria-expanded')).toBe('true');
    expect(popover()).not.toBeNull();
    expect(popover()!.getAttribute('aria-label')).toBe('Shapes');
    // Every shape the deck can hold, and the text box, line and arrow.
    for (const kind of GALLERY_KINDS) expect(inPopover(SHAPE_NAMES[kind]), kind).not.toBeNull();
    expect(inPopover('Text box')).not.toBeNull();
    click(inPopover(SHAPE_NAMES.star5));
    expect(opener().getAttribute('aria-expanded')).toBe('false');
  });

  it('takes no focus from the slide with a press, as the ribbon’s buttons do', () => {
    setup();
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => void tile('Oval')!.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
  });

  it('is off for a reader who cannot edit, and where the deck has no slide', () => {
    setup({ edit: false });
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-rb-item]')) expect(b.disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(host);
    setup({ slide: false });
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-rb-item]')) expect(b.disabled).toBe(true);
  });
});

describe('Home’s gallery once the strip is short of room', () => {
  it('is the Shapes button alone, and it opens the same gallery', () => {
    setup({ collapsed: true });
    expect(host.querySelector('.sl-shapes-inline')).toBeNull();
    expect(host.querySelectorAll('.sl-shape-mini')).toHaveLength(0);
    expect(opener().textContent).toContain('Shapes');
    expect(opener().getAttribute('aria-label')).toBeNull();
    click(opener());
    expect(popover()).not.toBeNull();
    expect(inPopover('Oval')).not.toBeNull();
  });

  it('goes from one form to the other as the strip says, and keeps the tool that was armed', () => {
    const t = setup();
    click(tile('Oval')!);
    t.render(true);
    expect(host.querySelector('.sl-shapes-inline')).toBeNull();
    expect(armedFor(t.model)).toEqual({ kind: 'shape', shape: 'ellipse' });
    t.render(false);
    expect(tile('Oval')!.getAttribute('aria-pressed')).toBe('true');
  });
});
