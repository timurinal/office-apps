// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionStore } from '../../editor/selection';
import type { ElementJSON, TableElement } from '../../model/deck';
import { box, modelOf, testDeck, txt } from '../../model/testing';
import { tablesFor, clearCells } from '../../modules/insert/tables';
import type { CanvasFrame, SlidesContext } from '../../modules/types';
import { ContextMenuLayer, contextItems } from './ContextMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let model: ReturnType<typeof modelOf>;
beforeEach(() => {
  host = document.createElement('div');
  host.className = 'sl-desk';
  const canvas = document.createElement('div');
  canvas.className = 'sl-canvas';
  host.appendChild(canvas);
  document.body.appendChild(host);
  root = createRoot(canvas);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('[data-app]').forEach((n) => n.remove());
  if (model) clearCells(model);
});

function open(elements: ElementJSON[], can = true, download = true) {
  model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  const panes = { open: vi.fn(), isOpen: () => false, close: vi.fn(), toggle: vi.fn() };
  const editText = vi.fn();
  const ctx = {
    model,
    selection,
    can: { edit: can, download },
    slideId: 's1',
    panes,
    select: { elements: (ids: string[]) => selection.set({ els: ids, editing: null }), editText },
    actions: { focusCanvas: vi.fn() },
    notify: vi.fn()
  } as unknown as SlidesContext;
  const frame = (): CanvasFrame => ({ slide: model.slide('s1')!, scale: 1, width: 1920, height: 1080, drag: null });
  act(() => root.render(<ContextMenuLayer c={ctx} frame={frame()} />));
  return { model, selection, ctx, panes, editText };
}

/** A right click at slide px (x, y): the canvas is at the origin and a scale of 1 in a page with no layout. */
function rightClick(x: number, y: number): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
  act(() => {
    host.querySelector('.sl-canvas')!.dispatchEvent(e);
  });
  return e;
}

const menu = (): HTMLElement | null => document.body.querySelector('[role="menu"][aria-label="Shape"]');
const rows = (): string[] => [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map((r) => r.querySelector('.oa-menu-label')!.textContent!);

describe('a right click on the slide', () => {
  it('over an element chooses it and opens the menu, with Format shape first', () => {
    const s = open([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    const e = rightClick(200, 200);
    expect(e.defaultPrevented).toBe(true);
    expect(s.selection.get().els).toEqual(['a']);
    expect(rows().slice(0, 2)).toEqual(['Format shape', 'Edit text']);
    expect(rows()).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste', 'Duplicate', 'Delete']));
    // Arrange's rows follow, so this is the one menu.
    expect(rows()).toEqual(expect.arrayContaining(['Bring to front', 'Send to back', 'Align left', 'Rotate right 90°']));
  });

  it('runs an Arrange row on what was clicked', () => {
    const s = open([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    rightClick(200, 200);
    act(() => {
      ([...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((r) => r.textContent!.includes('Bring to front')))!.click();
    });
    expect(s.model.slide('s1')!.elements.map((e) => e.id)).toEqual(['b', 'a']);
    s.model.undo();
    expect(s.model.slide('s1')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps open while the menu itself is scrolled, and goes when anything else is', () => {
    open([{ ...box(100, 100, 400, 300), id: 'a' }]);
    rightClick(200, 200);
    act(() => {
      menu()!.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    });
    expect(menu()?.getAttribute('data-state')).toBe('open');
    act(() => {
      host.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    });
    expect(menu()?.getAttribute('data-state')).toBe('closed');
  });

  it('Format shape opens the pane, and the menu goes', () => {
    const s = open([{ ...box(100, 100, 400, 300), id: 'a' }]);
    rightClick(200, 200);
    act(() => {
      (menu()!.querySelector('[role="menuitem"]') as HTMLElement).click();
    });
    expect(s.panes.open).toHaveBeenCalledWith('format');
    expect(menu()?.getAttribute('data-state')).toBe('closed');
  });

  it('over a chosen element in a choice of several keeps the choice', () => {
    const s = open([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    s.selection.set({ els: ['a', 'b'] });
    rightClick(200, 200);
    expect(s.selection.get().els).toEqual(['a', 'b']);
    expect(rows()).not.toContain('Edit text');
  });

  it('over the background is the browser\'s', () => {
    open([{ ...box(100, 100, 400, 300), id: 'a' }]);
    const e = rightClick(1500, 900);
    expect(e.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it('inside a text box being typed in is the browser\'s: spelling and paste', () => {
    open([{ ...box(100, 100, 400, 300), id: 'a' }]);
    const editing = document.createElement('div');
    editing.setAttribute('contenteditable', 'true');
    host.querySelector('.sl-canvas')!.appendChild(editing);
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200, button: 2 });
    act(() => {
      editing.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it('is not for a reader', () => {
    open([{ ...box(100, 100, 400, 300), id: 'a' }], false);
    const e = rightClick(200, 200);
    expect(e.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it('has no Cut or Copy where downloads are off', () => {
    const s = open([{ ...box(100, 100, 400, 300), id: 'a' }], true, false);
    s.selection.set({ els: ['a'] });
    expect(contextItems(s.ctx).map((i) => i.label)).not.toContain('Copy');
    expect(contextItems(s.ctx).map((i) => i.label)).toContain('Paste');
  });

  it('Edit text puts the caret in the shape, and Delete removes it in one step', () => {
    const s = open([{ ...box(100, 100, 400, 300), id: 'a' }]);
    rightClick(200, 200);
    act(() => {
      ([...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((r) => r.textContent!.includes('Edit text')))!.click();
    });
    expect(s.editText).toHaveBeenCalledWith('a', 'end');
    rightClick(200, 200);
    act(() => {
      ([...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((r) => r.textContent!.includes('Delete')))!.click();
    });
    expect(s.model.slide('s1')!.elements).toHaveLength(0);
    s.model.undo();
    expect(s.model.slide('s1')!.elements).toHaveLength(1);
  });

  it('over a table also has its rows, columns, merge and split, acting on the cell that was clicked', () => {
    const table: TableElement = {
      type: 'table',
      id: 't',
      x: 100,
      y: 100,
      w: 300,
      h: 100,
      cols: [100, 100, 100],
      rows: [0, 1].map((r) => ({ h: 50, cells: [0, 1, 2].map((c) => ({ text: txt(`${r}.${c}`) })) }))
    };
    const s = open([table]);
    rightClick(250, 160);
    // Row 2, column 2.
    expect(tablesFor(s.model).chosen).toMatchObject({ a: { r: 1, c: 1 } });
    expect(rows()).toEqual(expect.arrayContaining(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete rows', 'Delete columns', 'Merge cells', 'Split cell']));
    act(() => {
      ([...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((r) => r.textContent!.includes('Insert row above')))!.click();
    });
    expect((s.model.element('s1', 't') as TableElement).rows).toHaveLength(3);
  });
});
