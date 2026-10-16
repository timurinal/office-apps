// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartElement, ElementJSON, ShapeElement, TableElement } from '../../model/deck';
import { plainText } from '../../model/schema';
import { box, modelOf, peerOf, sync, testDeck, txt } from '../../model/testing';
import { createTextFormat } from '../../editor/format';
import { SelectionStore } from '../../editor/selection';
import { tablesFor, clearCells } from '../../modules/insert/tables';
import type { SlidesContext } from '../../modules/types';
import { FormatPane } from './FormatPane';
import { cmToPx, PX_PER_CM } from './units';

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
  document.body.querySelectorAll('[data-app]').forEach((n) => n.remove());
  clearCells(lastModel!);
});

let lastModel: ReturnType<typeof modelOf> | null = null;

const shape = (id: string, over: Partial<ShapeElement> = {}): ShapeElement => ({ ...box(100, 200, 400, 200), id, ...over });

function open(elements: ElementJSON[], chosen: string[], can = true) {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements }]));
  lastModel = model;
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'], els: chosen });
  const notify = vi.fn();
  const ctx = {
    model,
    selection,
    can: { edit: can },
    design: model.design(),
    slideId: 's1',
    text: createTextFormat({ model: () => model, selection, editor: () => null }),
    notify,
    panes: { isOpen: () => true, open: () => undefined, close: () => undefined, toggle: () => undefined },
    actions: { focusCanvas: () => undefined }
  } as unknown as SlidesContext;
  const draw = () => act(() => root.render(<FormatPane ctx={ctx} />));
  draw();
  return { model, selection, ctx, notify, draw };
}

const field = (label: string): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!el) throw new Error(`no field ${label}`);
  return el;
};
/** A native dropdown by its name, and a choice made in it. (Cast: happy-dom's select does not satisfy `querySelector`'s constraint.) */
const select = (label: string): HTMLSelectElement => {
  const el = host.querySelector(`select[aria-label="${label}"]`) as unknown as HTMLSelectElement | null;
  if (!el) throw new Error(`no dropdown ${label}`);
  return el;
};
const choose = (label: string, value: string): void => {
  const el = select(label);
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const button = (label: string): HTMLButtonElement => {
  const el = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
  if (!el) throw new Error(`no button ${label}`);
  return el;
};

/** Types into a field as a person does: focus, the text, then Enter or leaving. */
function type(el: HTMLInputElement | HTMLTextAreaElement, text: string, how: 'enter' | 'blur' = 'enter'): void {
  act(() => {
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    if (how === 'enter') el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    else el.blur();
  });
}

const click = (el: Element, init: MouseEventInit = {}): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
};

const tabs = (): string[] => [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '');

describe('the pane with nothing chosen', () => {
  it('says what to do', () => {
    const p = open([shape('a')], []);
    expect(host.textContent).toContain('Choose a shape, picture or table to format it.');
    expect(host.querySelector('input')).toBeNull();
    p.model.destroy();
  });
});

describe('size and position', () => {
  it('shows a shape\'s size and position in centimetres, as the board does', () => {
    open([shape('a')], ['a']);
    expect(tabs()).toEqual(['Shape options', 'Text options']);
    click(button('Size and position'));
    expect(field('Height').value).toBe('3.53 cm');
    expect(field('Width').value).toBe('7.06 cm');
    expect(field('Rotation').value).toBe('0°');
    expect(field('Horizontal position').value).toBe('1.76 cm');
    expect(field('Vertical position').value).toBe('3.53 cm');
  });

  it('a height typed in is one step, one undo entry', () => {
    const p = open([shape('a')], ['a']);
    click(button('Size and position'));
    type(field('Height'), '5');
    expect(p.model.element('s1', 'a')!.h).toBeCloseTo(cmToPx(5), 1);
    expect(field('Height').value).toBe('5.00 cm');
    p.model.undo();
    expect(p.model.element('s1', 'a')!.h).toBe(200);
    expect(p.model.canUndo()).toBe(false);
  });

  it('takes another unit, and puts the old value back for what is not a length', () => {
    const p = open([shape('a')], ['a']);
    click(button('Size and position'));
    type(field('Width'), '2 in');
    expect(p.model.element('s1', 'a')!.w).toBeCloseTo(cmToPx(5.08), 1);
    type(field('Width'), 'wide', 'blur');
    expect(p.model.element('s1', 'a')!.w).toBeCloseTo(cmToPx(5.08), 1);
    expect(field('Width').value).toBe('5.08 cm');
  });

  it('Escape puts the old value back, and an arrow steps it, Shift ten times as far', () => {
    const p = open([shape('a')], ['a']);
    click(button('Size and position'));
    act(() => {
      field('Width').focus();
    });
    act(() => {
      field('Width').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    });
    expect(p.model.element('s1', 'a')!.w).toBeCloseTo(400 + cmToPx(0.1), 1);
    act(() => {
      field('Width').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(p.model.element('s1', 'a')!.w).toBeCloseTo(400 + cmToPx(0.1) - cmToPx(1), 1);
    const before = p.model.element('s1', 'a')!.w;
    act(() => {
      field('Width').value = '99';
    });
    act(() => {
      field('Width').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(p.model.element('s1', 'a')!.w).toBe(before);
  });

  it('shows a value only when every chosen element has it, and sets each of them in one step', () => {
    const p = open([shape('a'), shape('b', { w: 600, x: 700 })], ['a', 'b']);
    click(button('Size and position'));
    expect(field('Height').value).toBe('3.53 cm');
    expect(field('Width').value).toBe('');
    expect(field('Horizontal position').value).toBe('');
    type(field('Width'), '10');
    expect(p.model.element('s1', 'a')!.w).toBeCloseTo(cmToPx(10), 1);
    expect(p.model.element('s1', 'b')!.w).toBeCloseTo(cmToPx(10), 1);
    expect(field('Width').value).toBe('10.00 cm');
    p.model.undo();
    expect(p.model.element('s1', 'a')!.w).toBe(400);
    expect(p.model.element('s1', 'b')!.w).toBe(600);
    expect(p.model.canUndo()).toBe(false);
  });

  it('Lock aspect ratio keeps each one\'s proportions', () => {
    const p = open([shape('a'), shape('b', { w: 100, h: 400 })], ['a', 'b']);
    click(button('Size and position'));
    click(host.querySelector('input[type="checkbox"]')!);
    expect(p.model.element('s1', 'a')!.lockAspect).toBe(true);
    expect(p.model.element('s1', 'b')!.lockAspect).toBe(true);
    type(field('Width'), '10');
    const w = cmToPx(10);
    expect(p.model.element('s1', 'a')!.h).toBeCloseTo((200 * w) / 400, 1);
    expect(p.model.element('s1', 'b')!.h).toBeCloseTo((400 * w) / 100, 1);
  });

  it('measures from the centre when asked, and writes the corner', () => {
    const p = open([shape('a')], ['a']);
    click(button('Size and position'));
    choose('Position from', 'centre');
    expect(field('Horizontal position').value).toBe(`${(300 / PX_PER_CM).toFixed(2)} cm`);
    type(field('Horizontal position'), '10');
    expect(p.model.element('s1', 'a')!.x).toBeCloseTo(cmToPx(10) - 200, 1);
  });

  it('turns by degrees, and 0 takes the turn away', () => {
    const p = open([shape('a')], ['a']);
    click(button('Size and position'));
    type(field('Rotation'), '45');
    expect(p.model.element('s1', 'a')!.rot).toBe(45);
    type(field('Rotation'), '0');
    expect(p.model.element('s1', 'a')!.rot).toBeUndefined();
  });

  it('is live for the other person the moment it is made', () => {
    const p = open([shape('a')], ['a']);
    const other = peerOf(p.model.doc);
    click(button('Size and position'));
    type(field('Height'), '4');
    sync(p.model.doc, other.doc);
    expect(other.element('s1', 'a')!.h).toBeCloseTo(cmToPx(4), 1);
    other.destroy();
  });

  it('is off for a reader, and writes nothing', () => {
    const p = open([shape('a')], ['a'], false);
    click(button('Size and position'));
    expect(field('Height').disabled).toBe(true);
    expect(p.model.canUndo()).toBe(false);
  });

  it('a table\'s size scales its columns and rows, not only its frame', () => {
    const table: TableElement = { type: 'table', id: 't', x: 0, y: 0, w: 200, h: 100, cols: [100, 100], rows: [{ h: 50, cells: [{ text: txt('a') }, { text: txt('b') }] }, { h: 50, cells: [{ text: txt('c') }, { text: txt('d') }] }] };
    const p = open([table], ['t']);
    click(button('Size and position'));
    type(field('Width'), '7.0668');
    const t = p.model.element('s1', 't') as TableElement;
    expect(t.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(t.w, 1);
    expect(t.w).toBeCloseTo(cmToPx(7.0668), 1);
    expect(t.cols[0]).toBeCloseTo(t.w / 2, 1);
    expect(t.rows.reduce((a, r) => a + r.h, 0)).toBeCloseTo(100, 1);
  });
});

describe('the text box and alt text', () => {
  it('anchors, wraps and fits the text, and sets its margins', () => {
    const p = open([shape('a')], ['a']);
    click(button('Size and position'));
    click(button('Text box'));
    click(button('Middle'));
    expect((p.model.element('s1', 'a') as ShapeElement).textBox).toMatchObject({ anchor: 'middle' });
    choose('Autofit', 'shrink');
    expect((p.model.element('s1', 'a') as ShapeElement).textBox).toMatchObject({ autofit: 'shrink', anchor: 'middle' });
    const wrap = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Wrap text in shape')!.querySelector('input')!;
    click(wrap);
    expect((p.model.element('s1', 'a') as ShapeElement).textBox).toMatchObject({ wrap: false });
    type(field('Left margin'), '1');
    expect((p.model.element('s1', 'a') as ShapeElement).textBox!.insets).toMatchObject({ l: expect.closeTo(cmToPx(1), 1), t: 7.2, r: 14.4, b: 7.2 });
  });

  it('alt text is committed when the field is left, and is one step', () => {
    const p = open([shape('a')], ['a']);
    click(button('Size and position'));
    click(button('Alt text'));
    const ta = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Alt text"]')!;
    type(ta, 'A blue box', 'blur');
    expect(p.model.element('s1', 'a')!.alt).toBe('A blue box');
    p.model.undo();
    expect(p.model.element('s1', 'a')!.alt).toBeUndefined();
  });
});

describe('fill and line', () => {
  it('a shape with no fill gets a solid one in the theme\'s accent, and a transparency', () => {
    const p = open([shape('a')], ['a']);
    expect(button('No fill').getAttribute('aria-pressed')).toBe('true');
    click(button('Solid'));
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toEqual({ kind: 'solid', color: { theme: 'accent1' } });
    type(field('Fill transparency'), '25');
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toEqual({ kind: 'solid', color: { theme: 'accent1' }, alpha: 0.75 });
    expect(field('Fill transparency').value).toBe('25%');
  });

  it('a colour is picked from the theme, and stored as a slot', () => {
    const p = open([shape('a', { fill: { kind: 'solid', color: '#ff0000' } })], ['a']);
    click(host.querySelector('button[aria-label^="Fill colour"]')!);
    const chip = document.body.querySelector<HTMLButtonElement>('button[aria-label="Accent 3"]')!;
    expect(chip).toBeTruthy();
    click(chip);
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toEqual({ kind: 'solid', color: { theme: 'accent3' } });
    // The panel is leaving once it has chosen (it fades out, held for the length of the exit).
    expect(document.body.querySelector('.sl-float')?.getAttribute('data-state')).toBe('closed');
  });

  it('a hex colour is typed, and a bad one is refused in place', () => {
    const p = open([shape('a', { fill: { kind: 'solid', color: '#ff0000' } })], ['a']);
    click(host.querySelector('button[aria-label^="Fill colour"]')!);
    const hex = document.body.querySelector<HTMLInputElement>('input[aria-label="Hex colour"]')!;
    type(hex, 'zzz');
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toEqual({ kind: 'solid', color: '#ff0000' });
    type(hex, '#0A0');
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toEqual({ kind: 'solid', color: '#00aa00' });
  });

  it('a gradient starts where the solid colour was, and its angle is a field', () => {
    const p = open([shape('a', { fill: { kind: 'solid', color: { theme: 'accent2' } } })], ['a']);
    click(button('Gradient'));
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toMatchObject({ kind: 'gradient', angle: 90, stops: [{ at: 0, color: { theme: 'accent2' } }, { at: 1 }] });
    type(field('Gradient angle'), '45');
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toMatchObject({ angle: 45 });
  });

  it('shows no fill kind when shapes differ, and a choice sets all of them', () => {
    const p = open([shape('a', { fill: { kind: 'solid', color: '#ff0000' } }), shape('b')], ['a', 'b']);
    for (const l of ['No fill', 'Solid', 'Gradient']) expect(button(l).getAttribute('aria-pressed')).toBe('false');
    click(button('Solid'));
    expect((p.model.element('s1', 'b') as ShapeElement).fill).toMatchObject({ kind: 'solid' });
    expect((p.model.element('s1', 'a') as ShapeElement).fill).toMatchObject({ kind: 'solid', color: '#ff0000' });
    p.model.undo();
    expect((p.model.element('s1', 'b') as ShapeElement).fill).toBeUndefined();
  });

  it('the line has a width in points, a dash and a colour', () => {
    const p = open([shape('a', { line: { color: '#000000', width: 4 } })], ['a']);
    expect(field('Line width').value).toBe('2 pt');
    type(field('Line width'), '3');
    expect((p.model.element('s1', 'a') as ShapeElement).line).toEqual({ color: '#000000', width: 6 });
    choose('Line dash', 'dash');
    expect((p.model.element('s1', 'a') as ShapeElement).line).toMatchObject({ dash: 'dash', width: 6 });
  });

  it('a line has its heads, which a shape does not', () => {
    const p = open([{ type: 'line', id: 'l', x: 0, y: 0, w: 100, h: 0, line: { color: '#000000', width: 4 } }], ['l']);
    choose('Line end', 'arrow');
    expect(p.model.element('s1', 'l')).toMatchObject({ line: { tail: 'arrow' } });
    const q = open([shape('a')], ['a']);
    expect(host.querySelector('select[aria-label="Line end"]')).toBeNull();
    q.model.destroy();
  });

  it('a picture has an outline and no fill', () => {
    open([{ type: 'image', id: 'i', x: 0, y: 0, w: 100, h: 100, asset: { id: 'a' } }], ['i']);
    expect(host.querySelector('input[aria-label="Line width"]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Solid')).toBe(false);
  });
});

describe('effects', () => {
  it('a shadow, and a rounded rectangle\'s corner', () => {
    const p = open([shape('a', { shape: 'roundRect' })], ['a']);
    click(button('Effects'));
    type(field('Corner radius'), '50');
    expect((p.model.element('s1', 'a') as ShapeElement).adjust).toBe(0.25);
    const shadow = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Shadow')!.querySelector('input')!;
    click(shadow);
    expect((p.model.element('s1', 'a') as ShapeElement).shadow).toBe(true);
  });

  it('has no corner for a rectangle', () => {
    open([shape('a')], ['a']);
    click(button('Effects'));
    expect(host.querySelector('input[aria-label="Corner radius"]')).toBeNull();
  });
});

describe('text options', () => {
  it('sets the paragraph spacing of the chosen shapes\' text, in one step', () => {
    const p = open([shape('a', { text: txt('one', 'two') }), shape('b', { text: txt('three') })], ['a', 'b']);
    act(() => click(host.querySelectorAll('[role="tab"]')[1]!));
    type(field('Space before'), '12');
    const a = p.model.element('s1', 'a') as ShapeElement;
    expect(a.text!.content.every((para) => para.attrs?.spaceBefore === 12)).toBe(true);
    expect(plainText(a.text)).toBe('one\ntwo');
    expect(((p.model.element('s1', 'b') as ShapeElement).text!.content[0]!.attrs as Record<string, unknown>).spaceBefore).toBe(12);
    type(field('Line spacing'), '1.5');
    expect((p.model.element('s1', 'a') as ShapeElement).text!.content[0]!.attrs).toMatchObject({ lineHeight: 1.5, spaceBefore: 12 });
    p.model.undo();
    expect((p.model.element('s1', 'a') as ShapeElement).text!.content[0]!.attrs).not.toHaveProperty('lineHeight');
  });

  it('the type\'s colour is the ribbon\'s, stored as hex', () => {
    const p = open([shape('a', { text: txt('hello') })], ['a']);
    act(() => click(host.querySelectorAll('[role="tab"]')[1]!));
    click(host.querySelector('button[aria-label^="Text colour"]')!);
    click(document.body.querySelector('button[aria-label="Red"]')!);
    const run = (p.model.element('s1', 'a') as ShapeElement).text!.content[0]!.content![0]!;
    expect(run.marks).toEqual([{ type: 'textStyle', attrs: { color: '#ff0000' } }]);
  });

  it('says what to do when nothing has text', () => {
    open([{ type: 'image', id: 'i', x: 0, y: 0, w: 1, h: 1, asset: { id: 'a' } }], ['i']);
    act(() => click(host.querySelectorAll('[role="tab"]')[1]!));
    expect(host.textContent).toContain('Choose a shape with text to format it.');
  });
});

describe('a chart', () => {
  const chart = (): ChartElement => ({
    type: 'chart',
    id: 'c',
    x: 0,
    y: 0,
    w: 800,
    h: 400,
    chart: 'column',
    categories: ['Q1', 'Q2'],
    series: [
      { name: 'North', values: [1, 2] },
      { name: 'South', values: [3, 4] }
    ]
  });

  it('opens on its own tool, with its kind, its title and its data', () => {
    open([chart()], ['c']);
    expect(select('Chart type')).toBeTruthy();
    expect(field('Series 1 name').value).toBe('North');
    expect(field('North, Q2').value).toBe('2');
    expect(field('Category 2').value).toBe('Q2');
  });

  it('a value is a number, committed when it is left, and one step', () => {
    const p = open([chart()], ['c']);
    type(field('North, Q2'), '4,25', 'blur');
    expect((p.model.element('s1', 'c') as ChartElement).series[0]!.values).toEqual([1, 4.25]);
    p.model.undo();
    expect((p.model.element('s1', 'c') as ChartElement).series[0]!.values).toEqual([1, 2]);
  });

  it('a value that is not a number says so, and writes nothing', () => {
    const p = open([chart()], ['c']);
    type(field('South, Q1'), 'lots', 'blur');
    expect(field('South, Q1').getAttribute('aria-invalid')).toBe('true');
    expect((p.model.element('s1', 'c') as ChartElement).series[1]!.values).toEqual([3, 4]);
  });

  it('adds and removes rows and series, and renames them', () => {
    const p = open([chart()], ['c']);
    click(button('Add row'));
    expect((p.model.element('s1', 'c') as ChartElement).categories).toEqual(['Q1', 'Q2', 'Item 3']);
    expect((p.model.element('s1', 'c') as ChartElement).series.map((s) => s.values.length)).toEqual([3, 3]);
    click(button('Add series'));
    expect((p.model.element('s1', 'c') as ChartElement).series).toHaveLength(3);
    type(field('Series 3 name'), 'West', 'blur');
    expect((p.model.element('s1', 'c') as ChartElement).series[2]!.name).toBe('West');
    click(button('Remove row 1'));
    expect((p.model.element('s1', 'c') as ChartElement).categories).toEqual(['Q2', 'Item 3']);
    click(button('Remove series 2'));
    expect((p.model.element('s1', 'c') as ChartElement).series.map((s) => s.name)).toEqual(['North', 'West']);
  });

  it('changes its kind and its title', () => {
    const p = open([chart()], ['c']);
    choose('Chart type', 'pie');
    expect((p.model.element('s1', 'c') as ChartElement).chart).toBe('pie');
    type(field('Chart title'), 'Sales', 'blur');
    expect((p.model.element('s1', 'c') as ChartElement).title).toBe('Sales');
    // A pie has one series to draw: no button to add another.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Add series')).toBe(false);
  });
});

describe('a table', () => {
  const table = (): TableElement => ({
    type: 'table',
    id: 't',
    x: 0,
    y: 0,
    w: 300,
    h: 150,
    cols: [100, 100, 100],
    rows: [0, 1, 2].map((r) => ({ h: 50, cells: [0, 1, 2].map((c) => ({ text: txt(`${r}.${c}`) })) })),
    firstRow: true
  });

  it('opens on its own tool, and the map chooses a cell, or with Shift a range', () => {
    const p = open([table()], ['t']);
    const cell = (r: number, c: number) => host.querySelector<HTMLButtonElement>(`button[aria-label="Row ${r}, column ${c}"]`)!;
    click(cell(2, 2));
    expect(tablesFor(p.model).chosen).toMatchObject({ a: { r: 1, c: 1 }, b: { r: 1, c: 1 } });
    click(cell(3, 3), { shiftKey: true });
    expect(tablesFor(p.model).chosen).toMatchObject({ a: { r: 1, c: 1 }, b: { r: 2, c: 2 } });
    expect(cell(3, 3).getAttribute('aria-pressed')).toBe('true');
    expect(cell(1, 1).getAttribute('aria-pressed')).toBe('false');
  });

  it('merges the chosen cells and splits them again, each in one step', () => {
    const p = open([table()], ['t']);
    click(host.querySelector('button[aria-label="Row 1, column 1"]')!);
    expect(button('Merge cells').disabled).toBe(true);
    click(host.querySelector('button[aria-label="Row 2, column 2"]')!, { shiftKey: true });
    click(button('Merge cells'));
    expect((p.model.element('s1', 't') as TableElement).rows[0]!.cells[0]).toMatchObject({ rowSpan: 2, colSpan: 2 });
    // The map draws it as one cell now.
    expect(host.querySelector('button[aria-label="Row 1, column 1, merged 2 by 2"]')).not.toBeNull();
    click(button('Split cell'));
    expect((p.model.element('s1', 't') as TableElement).rows[0]!.cells[0]!.rowSpan).toBeUndefined();
    p.model.undo();
    expect((p.model.element('s1', 't') as TableElement).rows[0]!.cells[0]).toMatchObject({ rowSpan: 2 });
  });

  it('adds and deletes rows and columns at the chosen cell', () => {
    const p = open([table()], ['t']);
    click(host.querySelector('button[aria-label="Row 2, column 2"]')!);
    click(button('Row below'));
    expect((p.model.element('s1', 't') as TableElement).rows).toHaveLength(4);
    click(button('Column left'));
    expect((p.model.element('s1', 't') as TableElement).cols).toHaveLength(4);
    click(button('Delete rows'));
    expect((p.model.element('s1', 't') as TableElement).rows).toHaveLength(3);
  });

  it('turns the header row and the bands on and off, and fills and aligns the chosen cells', () => {
    const p = open([table()], ['t']);
    const header = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Header row')!.querySelector('input')!;
    click(header);
    expect((p.model.element('s1', 't') as TableElement).firstRow).toBe(false);
    click(host.querySelector('button[aria-label="Row 2, column 1"]')!);
    click(host.querySelector('button[aria-label="Row 3, column 1"]')!, { shiftKey: true });
    click(button('Middle'));
    const t = p.model.element('s1', 't') as TableElement;
    expect([t.rows[1]!.cells[0]!.anchor, t.rows[2]!.cells[0]!.anchor, t.rows[0]!.cells[0]!.anchor]).toEqual(['middle', 'middle', undefined]);
    click(host.querySelector('button[aria-label^="Cell fill"]')!);
    click(document.body.querySelector('button[aria-label="Accent 2"]')!);
    expect((p.model.element('s1', 't') as TableElement).rows[2]!.cells[0]!.fill).toEqual({ kind: 'solid', color: { theme: 'accent2' } });
  });
});
