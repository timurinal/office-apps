// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableElement } from '../../model/deck';
import { plainText } from '../../model/schema';
import { modelOf, testDeck } from '../../model/testing';
import { SelectionStore } from '../../editor/selection';
import type { CanvasFrame, SlidesContext } from '../types';
import { cellAtPoint, modelCell, rangeBox } from './cellGeometry';
import { DrawLayer } from './DrawLayer';
import { insertTable } from './place';
import { mergeCells } from './tableOps';
import { TableLayer } from './TableLayer';
import { cellEditor, clearCells, enterCell, tablesFor } from './tables';
import { arm, armedFor, disarm } from './tool';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  host.className = 'sl-canvas';
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  disarm();
});

function setup(can = true) {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [] }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  const focusCanvas = vi.fn();
  const notify = vi.fn();
  const ctx = {
    model,
    selection,
    can: { edit: can },
    slideId: 's1',
    design: model.design(),
    actions: { focusCanvas },
    notify
  } as unknown as SlidesContext;
  const frame = (): CanvasFrame => ({ slide: model.slide('s1')!, scale: 1, width: 1920, height: 1080, drag: null });
  return { model, selection, ctx, frame, focusCanvas, notify };
}

const pointer = (type: string, x: number, y: number, extra: Record<string, unknown> = {}): Event => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
};

describe('the drawing tool on the slide', () => {
  it('a click places the armed shape at its size, centred on the click, and puts the tool away', () => {
    const s = setup();
    arm(s.model, { kind: 'shape', shape: 'ellipse' });
    act(() => root.render(<DrawLayer c={s.ctx} frame={s.frame()} />));
    const catcher = host.querySelector('.sl-draw')!;
    expect(catcher).toBeTruthy();
    act(() => {
      catcher.dispatchEvent(pointer('pointerdown', 600, 400));
      catcher.dispatchEvent(pointer('pointerup', 600, 400));
    });
    const els = s.model.slide('s1')!.elements;
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'shape', shape: 'ellipse', x: 456, y: 256, w: 288, h: 288 });
    expect(s.selection.get().els).toEqual([els[0]!.id]);
    expect(armedFor(s.model)).toBeNull();
    expect(s.focusCanvas).toHaveBeenCalled();
    // One entry.
    s.model.undo();
    expect(s.model.slide('s1')!.elements).toHaveLength(0);
  });

  it('a drag draws it corner to corner', () => {
    const s = setup();
    arm(s.model, { kind: 'shape', shape: 'rect' });
    act(() => root.render(<DrawLayer c={s.ctx} frame={s.frame()} />));
    const catcher = host.querySelector('.sl-draw')!;
    act(() => {
      catcher.dispatchEvent(pointer('pointerdown', 700, 500));
      catcher.dispatchEvent(pointer('pointermove', 500, 300));
      catcher.dispatchEvent(pointer('pointerup', 400, 200));
    });
    expect(s.model.slide('s1')!.elements[0]).toMatchObject({ shape: 'rect', x: 400, y: 200, w: 300, h: 300 });
  });

  it('a dragged line goes end to end, with the arrow at the end', () => {
    const s = setup();
    arm(s.model, { kind: 'line', arrow: true });
    act(() => root.render(<DrawLayer c={s.ctx} frame={s.frame()} />));
    const catcher = host.querySelector('.sl-draw')!;
    act(() => {
      catcher.dispatchEvent(pointer('pointerdown', 800, 300));
      catcher.dispatchEvent(pointer('pointerup', 500, 100));
    });
    expect(s.model.slide('s1')!.elements[0]).toMatchObject({ type: 'line', x: 500, y: 100, w: 300, h: 200, flipH: true, line: { tail: 'arrow' } });
  });

  it('a text box has the caret', () => {
    const s = setup();
    arm(s.model, { kind: 'text' });
    act(() => root.render(<DrawLayer c={s.ctx} frame={s.frame()} />));
    const catcher = host.querySelector('.sl-draw')!;
    act(() => {
      catcher.dispatchEvent(pointer('pointerdown', 960, 540));
      catcher.dispatchEvent(pointer('pointerup', 960, 540));
    });
    const el = s.model.slide('s1')!.elements[0]!;
    expect(s.selection.get().editing).toBe(el.id);
    expect(s.focusCanvas).not.toHaveBeenCalled();
  });

  it('Escape puts the tool away, and nothing is drawn', () => {
    const s = setup();
    arm(s.model, { kind: 'shape', shape: 'rect' });
    act(() => root.render(<DrawLayer c={s.ctx} frame={s.frame()} />));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(armedFor(s.model)).toBeNull();
    expect(host.querySelector('.sl-draw')).toBeNull();
    expect(s.model.slide('s1')!.elements).toHaveLength(0);
  });

  it('is not held for a reader', () => {
    const s = setup(false);
    arm(s.model, { kind: 'shape', shape: 'rect' });
    act(() => root.render(<DrawLayer c={s.ctx} frame={s.frame()} />));
    expect(host.querySelector('.sl-draw')).toBeNull();
    expect(armedFor(s.model)).toBeNull();
  });

  it('a press on it never reaches the canvas behind', () => {
    const s = setup();
    arm(s.model, { kind: 'shape', shape: 'rect' });
    const behind = vi.fn();
    act(() =>
      root.render(
        <div onPointerDown={behind} onPointerUp={behind}>
          <DrawLayer c={s.ctx} frame={s.frame()} />
        </div>
      )
    );
    const catcher = host.querySelector('.sl-draw')!;
    act(() => {
      catcher.dispatchEvent(pointer('pointerdown', 10, 10));
      catcher.dispatchEvent(pointer('pointerup', 10, 10));
    });
    expect(behind).not.toHaveBeenCalled();
  });
});

// ── a table's cells ─────────────────────────────────────────────────────────

/** A 2 by 3 table, chosen, with its layer drawn. */
function withTable() {
  const s = setup();
  const id = insertTable({ model: s.model, selection: s.selection }, 2, 3)!;
  const draw = () => act(() => root.render(<TableLayer c={s.ctx} frame={s.frame()} />));
  draw();
  const table = () => s.model.element('s1', id) as TableElement;
  return { ...s, id, draw, table };
}

const tab = (back = false): boolean => {
  const ed = cellEditor()!;
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: back, bubbles: true, cancelable: true });
  let handled = false;
  act(() => {
    handled = ed.view.someProp('handleKeyDown', (f) => f(ed.view, e)) ?? false;
  });
  return handled;
};

describe('typing in a table', () => {
  it('puts the caret in a cell, and the text is the cell\'s', () => {
    const t = withTable();
    act(() => enterCell(t.model, 's1', t.id, 0, 1));
    const ed = cellEditor();
    expect(ed).not.toBeNull();
    act(() => {
      ed!.commands.insertContent('Hello');
    });
    expect(plainText(t.table().rows[0]!.cells[1]!.text)).toBe('Hello');
    expect(plainText(t.table().rows[0]!.cells[0]!.text)).toBe('');
  });

  it('shows no editor for a cell of a table that is not chosen, and forgets it', () => {
    const t = withTable();
    act(() => enterCell(t.model, 's1', t.id, 0, 0));
    expect(cellEditor()).not.toBeNull();
    act(() => t.selection.set({ els: [] }));
    t.draw();
    expect(cellEditor()).toBeNull();
    expect(tablesFor(t.model).editing).toBeNull();
    expect(tablesFor(t.model).chosen).toBeNull();
  });

  it('Tab goes to the next cell, Shift+Tab back, and past the last cell adds a row', () => {
    const t = withTable();
    act(() => enterCell(t.model, 's1', t.id, 0, 2));
    expect(tab()).toBe(true);
    expect(tablesFor(t.model).editing).toMatchObject({ r: 1, c: 0 });
    expect(tab(true)).toBe(true);
    expect(tablesFor(t.model).editing).toMatchObject({ r: 0, c: 2 });
    act(() => enterCell(t.model, 's1', t.id, 1, 2));
    expect(t.table().rows).toHaveLength(2);
    tab();
    expect(t.table().rows).toHaveLength(3);
    expect(tablesFor(t.model).editing).toMatchObject({ r: 2, c: 0 });
    // The new row was one undo entry; the typing before it is its own.
    t.model.undo();
    expect(t.table().rows).toHaveLength(2);
  });

  it('Tab skips the cells a merge covers', () => {
    const t = withTable();
    act(() => {
      mergeCells(t.model, 's1', t.id, { r1: 0, c1: 0, r2: 0, c2: 1 });
    });
    act(() => enterCell(t.model, 's1', t.id, 0, 0));
    tab();
    expect(tablesFor(t.model).editing).toMatchObject({ r: 0, c: 2 });
  });

  it('the header row types white and bold, as it is drawn', () => {
    const t = withTable();
    act(() => enterCell(t.model, 's1', t.id, 0, 0));
    const ed = cellEditor()!;
    act(() => {
      ed.commands.insertContent('Head');
    });
    const p = ed.view.dom.querySelector('p');
    expect(p?.getAttribute('style')).toContain('font-weight: 700');
    act(() => enterCell(t.model, 's1', t.id, 1, 0));
    act(() => {
      cellEditor()!.commands.insertContent('Body');
    });
    expect(cellEditor()!.view.dom.querySelector('p')?.getAttribute('style')).toContain('font-weight: 400');
  });

  it('is not entered for a reader', () => {
    const t = withTable();
    t.ctx.can.edit = false;
    t.draw();
    act(() => enterCell(t.model, 's1', t.id, 0, 0));
    t.draw();
    expect(cellEditor()).toBeNull();
    clearCells(t.model);
  });
});

describe('where the cells are', () => {
  const table = (): TableElement => ({
    type: 'table',
    id: 't',
    x: 100,
    y: 200,
    w: 300,
    h: 100,
    cols: [100, 200],
    rows: [
      { h: 40, cells: [{ text: { type: 'doc', content: [{ type: 'paragraph' }] } }, { text: { type: 'doc', content: [{ type: 'paragraph' }] } }] },
      { h: 60, cells: [{ text: { type: 'doc', content: [{ type: 'paragraph' }] }, colSpan: 2 }, { text: { type: 'doc', content: [{ type: 'paragraph' }] }, merged: true }] }
    ]
  });

  it('by the stored columns and rows, a merge covering what it covers', () => {
    expect(modelCell(table(), { r: 0, c: 1 })).toEqual({ x: 200, y: 200, w: 200, h: 40 });
    expect(modelCell(table(), { r: 1, c: 1 })).toEqual({ x: 100, y: 240, w: 300, h: 60 });
  });

  it('a point is in the cell whose box holds it, and not in a covered one', () => {
    expect(cellAtPoint(table(), { x: 150, y: 210 }, null)).toEqual({ r: 0, c: 0 });
    expect(cellAtPoint(table(), { x: 350, y: 250 }, null)).toEqual({ r: 1, c: 0 });
    expect(cellAtPoint(table(), { x: 10, y: 10 }, null)).toBeNull();
  });

  it('a range is the box from its first corner to its last, measured boxes first', () => {
    expect(rangeBox(table(), { r: 0, c: 0 }, { r: 1, c: 1 }, null)).toEqual({ x: 100, y: 200, w: 300, h: 100 });
    const measured = [{ r: 0, c: 0, box: { x: 100, y: 200, w: 100, h: 90 } }];
    expect(cellAtPoint(table(), { x: 150, y: 280 }, measured)).toEqual({ r: 0, c: 0 });
  });
});
