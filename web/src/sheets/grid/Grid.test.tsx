// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FormulaBar } from './FormulaBar';
import { Grid } from './Grid';
import { GridSession } from './session';
import { FakeSheet } from './testing/fake';
import { budgetSheet } from './testing/samples';
import type { GridIntent } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * happy-dom has no layout, so the box the grid measures is given: an 800 by 500 viewport, with
 * the 46px row header and 26px column header of a sheet of fewer than 10,000 rows, 26px rows
 * and (the budget's) columns 180, 112, 112, 112, 112, 120 wide.
 */
const VIEW = { w: 800, h: 500 };
const HW = 46;
const HH = 26;

const origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');

let host: HTMLDivElement;
let root: Root;
let sheet: FakeSheet;
let session: GridSession;
let intents: GridIntent[];
let refused: number;

function mount(over: { readOnly?: boolean; zoom?: number } = {}) {
  act(() =>
    root.render(
      <>
        <FormulaBar session={session} data={sheet} />
        <div style={{ position: 'relative', width: VIEW.w, height: VIEW.h }}>
          <Grid
            session={session}
            data={sheet}
            onIntent={(i) => {
              intents.push(i);
              sheet.apply(i);
            }}
            zoom={over.zoom ?? 100}
            readOnly={over.readOnly}
            onReadOnlyEdit={() => refused++}
          />
        </div>
      </>
    )
  );
}

/** The centre of a cell, in the viewport's pixels, at 100%. */
const centre = (row: number, col: number) => {
  const widths = [180, 112, 112, 112, 112, 120];
  const x = HW + widths.slice(0, col).reduce((a, b) => a + b, 0) + (widths[col] ?? 112) / 2;
  return { x, y: HH + row * 26 + 13 };
};

const scroller = () => host.querySelector<HTMLElement>('.sg-scroller')!;
const grid = () => host.querySelector<HTMLElement>('[role="grid"]')!;
const editorField = () => host.querySelector<HTMLTextAreaElement>('.sg-editor textarea')!;
const barField = () => host.querySelector<HTMLTextAreaElement>('.sg-fwrap textarea')!;

const pointer = (type: string, x: number, y: number, init: MouseEventInit = {}) =>
  act(() => void scroller().dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...init })));
const click = (row: number, col: number, init: MouseEventInit = {}) => {
  const { x, y } = centre(row, col);
  pointer('pointerdown', x, y, init);
  pointer('pointerup', x, y, init);
};
const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  let prevented = false;
  act(() => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    prevented = e.defaultPrevented;
  });
  return prevented;
};
const type = (field: HTMLTextAreaElement | HTMLInputElement, text: string) =>
  act(() => {
    // React tracks the value through the prototype's setter, so a change has to go through it.
    const proto = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, text);
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
/** The grid draws its overlays on a frame. */
const frame = () =>
  act(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );
const sent = (type: GridIntent['type']) => intents.filter((i) => i.type === type);

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => VIEW.w });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEW.h });
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: VIEW.w, bottom: VIEW.h, width: VIEW.w, height: VIEW.h, x: 0, y: 0, toJSON: () => ({}) };
  };
  if (typeof ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  sheet = budgetSheet();
  sheet.rows = 1000;
  session = new GridSession();
  intents = [];
  refused = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth);
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origClientHeight);
});

describe('what the screen reader is told', () => {
  it('is a grid that names its size and its active cell', () => {
    mount();
    const g = grid();
    expect(g.getAttribute('aria-rowcount')).toBe('1000');
    expect(g.getAttribute('aria-colcount')).toBe('26');
    const active = document.getElementById(g.getAttribute('aria-activedescendant')!)!;
    expect(active.getAttribute('role')).toBe('gridcell');
    expect(active.textContent).toBe('A1, Budget 2027');
  });

  it('follows the selection, and says a range', () => {
    mount();
    click(3, 1);
    const id = grid().getAttribute('aria-activedescendant')!;
    expect(document.getElementById(id)!.textContent).toBe('B4, £48,000');
    pointer('pointerdown', centre(3, 1).x, centre(3, 1).y, { shiftKey: true });
    pointer('pointermove', centre(6, 3).x, centre(6, 3).y);
    expect(document.getElementById(id)!.textContent).toContain('selection B4:D7');
  });

  it('is read only when the data says so', () => {
    sheet.readOnlyFlag = true;
    mount();
    expect(grid().getAttribute('aria-readonly')).toBe('true');
  });
});

describe('selecting', () => {
  it('a click selects the cell and says so', () => {
    mount();
    click(4, 2);
    expect(session.sel.active).toEqual({ row: 4, col: 2 });
    expect(sent('select').at(-1)).toEqual({ type: 'select', rect: { r1: 4, r2: 4, c1: 2, c2: 2 }, active: { row: 4, col: 2 } });
  });

  it('Shift extends from where the selection began', () => {
    mount();
    click(2, 1);
    click(5, 3, { shiftKey: true });
    expect(sent('select').at(-1)).toMatchObject({ rect: { r1: 2, r2: 5, c1: 1, c2: 3 }, active: { row: 2, col: 1 } });
  });

  it('a drag selects the rectangle it covers', () => {
    mount();
    const a = centre(1, 1);
    const b = centre(4, 3);
    pointer('pointerdown', a.x, a.y);
    pointer('pointermove', b.x, b.y);
    pointer('pointerup', b.x, b.y);
    expect(session.rect()).toEqual({ r1: 1, r2: 4, c1: 1, c2: 3 });
  });

  it('a column header selects the column, a row header the row, the corner everything', () => {
    mount();
    pointer('pointerdown', HW + 180 + 56, 10);
    pointer('pointerup', HW + 180 + 56, 10);
    expect(session.rect()).toEqual({ r1: 0, r2: 999, c1: 1, c2: 1 });
    pointer('pointerdown', 20, HH + 26 * 4 + 5);
    pointer('pointerup', 20, HH + 26 * 4 + 5);
    expect(session.rect()).toEqual({ r1: 4, r2: 4, c1: 0, c2: 25 });
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 10, 10);
    expect(session.rect()).toEqual({ r1: 0, r2: 999, c1: 0, c2: 25 });
  });

  it('the keyboard moves it and the rest of the key map reaches the reducer', () => {
    mount();
    click(2, 2);
    expect(keydown(grid(), 'ArrowDown')).toBe(true);
    expect(session.sel.active).toEqual({ row: 3, col: 2 });
    keydown(grid(), 'ArrowRight', { shiftKey: true });
    expect(session.rect()).toEqual({ r1: 3, r2: 3, c1: 2, c2: 3 });
    keydown(grid(), 'a', { ctrlKey: true });
    expect(session.rect()).toEqual({ r1: 0, r2: 999, c1: 0, c2: 25 });
    keydown(grid(), 'Home', { ctrlKey: true });
    expect(session.sel.active).toEqual({ row: 0, col: 0 });
    keydown(grid(), 'ArrowDown', { ctrlKey: true });
    expect(session.sel.active.row).toBe(2);
  });

  it('Tab and Enter move inside a selection', () => {
    mount();
    click(2, 1);
    click(4, 2, { shiftKey: true });
    keydown(grid(), 'Enter');
    expect(session.sel.active).toEqual({ row: 3, col: 1 });
    keydown(grid(), 'Tab');
    expect(session.sel.active).toEqual({ row: 3, col: 2 });
    keydown(grid(), 'Tab', { shiftKey: true });
    expect(session.sel.active).toEqual({ row: 3, col: 1 });
  });

  it('Ctrl+Space and Shift+Space take the column and the row', () => {
    mount();
    click(4, 2);
    keydown(grid(), ' ', { ctrlKey: true });
    expect(session.rect()).toEqual({ r1: 0, r2: 999, c1: 2, c2: 2 });
    click(4, 2);
    keydown(grid(), ' ', { shiftKey: true });
    expect(session.rect()).toEqual({ r1: 4, r2: 4, c1: 0, c2: 25 });
  });
});

describe('editing', () => {
  it('typing replaces the cell, Enter commits and moves down', () => {
    mount();
    click(11, 0);
    keydown(grid(), 'H');
    expect(session.edit).toMatchObject({ mode: 'enter', text: '' });
    type(editorField(), 'Hello');
    keydown(editorField(), 'Enter');
    expect(sent('input')).toEqual([{ type: 'input', at: { row: 11, col: 0 }, text: 'Hello' }]);
    expect(session.edit).toBeNull();
    expect(session.sel.active).toEqual({ row: 12, col: 0 });
    expect(sheet.editText(11, 0)).toBe('Hello');
  });

  it('F2 and Enter edit what is there, from its end', () => {
    mount();
    click(3, 0);
    keydown(grid(), 'F2');
    expect(session.edit).toMatchObject({ mode: 'edit', text: 'Salaries', selStart: 8 });
    keydown(editorField(), 'Escape');
    expect(session.edit).toBeNull();
    keydown(grid(), 'Enter');
    expect(session.edit).toMatchObject({ mode: 'edit', text: 'Salaries' });
  });

  it('a double click edits', () => {
    mount();
    click(3, 0);
    act(() => void scroller().dispatchEvent(new MouseEvent('dblclick', { clientX: centre(3, 0).x, clientY: centre(3, 0).y, bubbles: true })));
    expect(session.edit).toMatchObject({ mode: 'edit', text: 'Salaries' });
  });

  it('Escape cancels and sends nothing; an unchanged edit sends nothing', () => {
    mount();
    click(3, 0);
    keydown(grid(), 'F2');
    type(editorField(), 'Salaries!');
    keydown(editorField(), 'Escape');
    expect(sent('input')).toEqual([]);
    keydown(grid(), 'F2');
    keydown(editorField(), 'Enter');
    expect(sent('input')).toEqual([]);
  });

  it('Tab commits and moves right; an arrow in a value commits and moves', () => {
    mount();
    click(13, 0);
    keydown(grid(), '5');
    type(editorField(), '5');
    keydown(editorField(), 'Tab');
    expect(session.sel.active).toEqual({ row: 13, col: 1 });
    keydown(grid(), '6');
    type(editorField(), '6');
    keydown(editorField(), 'ArrowDown');
    expect(sent('input')).toHaveLength(2);
    expect(session.sel.active).toEqual({ row: 14, col: 1 });
  });

  it('Alt+Enter is a new line in the cell', () => {
    mount();
    click(13, 0);
    keydown(grid(), 'a');
    type(editorField(), 'a');
    keydown(editorField(), 'Enter', { altKey: true });
    expect(session.edit!.text).toBe('a\n');
  });

  it('clicking another cell commits, in a value', () => {
    mount();
    click(13, 0);
    keydown(grid(), 'x');
    type(editorField(), 'x');
    click(15, 2);
    expect(sent('input')).toEqual([{ type: 'input', at: { row: 13, col: 0 }, text: 'x' }]);
    expect(session.sel.active).toEqual({ row: 15, col: 2 });
  });

  it('the formula bar and the editor show the same text, in step', () => {
    mount();
    click(13, 0);
    keydown(grid(), '=');
    type(editorField(), '=SUM(B4');
    expect(barField().value).toBe('=SUM(B4');
    type(barField(), '=SUM(B4:B9');
    expect(editorField().value).toBe('=SUM(B4:B9');
    expect(session.edit!.focus).toBe('bar');
  });
});

describe('formulas', () => {
  it('colours the references in the text, and outlines them on the grid', () => {
    mount();
    click(13, 0);
    keydown(grid(), '=');
    type(editorField(), '=SUM(B4:B6)+C4');
    const spans = [...host.querySelectorAll<HTMLElement>('.sg-editor .sg-mirror span')];
    expect(spans.map((s) => s.textContent)).toEqual(['B4:B6', 'C4']);
    expect(spans[0]!.style.color).not.toBe(spans[1]!.style.color);
    expect(session.refs().map((r) => r.text)).toEqual(['B4:B6', 'C4']);
  });

  it('an arrow in a formula where an address may go points at a cell', () => {
    mount();
    click(13, 1);
    keydown(grid(), '=');
    type(editorField(), '=SUM(');
    keydown(editorField(), 'ArrowUp');
    keydown(editorField(), 'ArrowUp');
    expect(session.edit!.text).toBe('=SUM(B12');
    keydown(editorField(), 'ArrowUp', { shiftKey: true });
    expect(session.edit!.text).toBe('=SUM(B12:B11');
  });

  it('a click on a cell points at it, and a click after an operand ends the edit', () => {
    mount();
    click(13, 1);
    keydown(grid(), '=');
    type(editorField(), '=');
    click(3, 1);
    expect(session.edit!.text).toBe('=B4');
    expect(sent('input')).toEqual([]);
    type(editorField(), '=B4+1');
    click(5, 2);
    expect(sent('input')).toEqual([{ type: 'input', at: { row: 13, col: 1 }, text: '=B4+1' }]);
  });

  it('offers functions and names as the word is typed, Tab takes one', () => {
    mount();
    click(13, 1);
    keydown(grid(), '=');
    type(editorField(), '=SU');
    const rows = [...host.querySelectorAll('.sg-suggest li')].map((l) => l.textContent);
    expect(rows).toEqual(['SUM', 'SUMIF']);
    keydown(editorField(), 'ArrowDown');
    keydown(editorField(), 'Tab');
    expect(session.edit!.text).toBe('=SUMIF(');
    expect(session.edit!.mode).toBe('enter');
  });

  it('Escape closes the list first and cancels second', () => {
    mount();
    click(13, 1);
    keydown(grid(), '=');
    type(editorField(), '=SU');
    keydown(editorField(), 'Escape');
    expect(host.querySelector('.sg-suggest')).toBeNull();
    expect(session.edit).not.toBeNull();
    keydown(editorField(), 'Escape');
    expect(session.edit).toBeNull();
  });
});

describe('the formula bar', () => {
  it('shows the active address and the formula, and the references of the active cell', () => {
    mount();
    click(9, 5);
    const name = host.querySelector<HTMLInputElement>('.sg-name')!;
    expect(name.value).toBe('F10');
    expect(barField().value).toBe('=SUM(F4:F9)');
    expect([...host.querySelectorAll('.sg-fwrap .sg-mirror span')].map((s) => s.textContent)).toEqual(['F4:F9']);
    expect(session.refs().map((r) => r.rect)).toEqual([{ r1: 3, r2: 8, c1: 5, c2: 5 }]);
  });

  it('Cancel and Enter are for an edit, and only then', () => {
    mount();
    const cancel = host.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!;
    const enter = host.querySelector<HTMLButtonElement>('button[aria-label="Enter"]')!;
    expect(cancel.disabled).toBe(true);
    expect(enter.disabled).toBe(true);
    click(13, 0);
    keydown(grid(), 'x');
    type(editorField(), 'x');
    expect(cancel.disabled).toBe(false);
    act(() => void enter.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(sent('input')).toEqual([{ type: 'input', at: { row: 13, col: 0 }, text: 'x' }]);
    expect(session.sel.active).toEqual({ row: 13, col: 0 });
  });

  it('typing an address in the name box jumps there', () => {
    mount();
    const name = host.querySelector<HTMLInputElement>('.sg-name')!;
    act(() => void name.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    act(() => name.focus());
    for (const [text, rect] of [
      ['C7', { r1: 6, r2: 6, c1: 2, c2: 2 }],
      ['b2:d4', { r1: 1, r2: 3, c1: 1, c2: 3 }],
      ['$B$3', { r1: 2, r2: 2, c1: 1, c2: 1 }],
      ['C:D', { r1: 0, r2: 999, c1: 2, c2: 3 }],
      ['5:6', { r1: 4, r2: 5, c1: 0, c2: 25 }]
    ] as const) {
      type(name, text);
      keydown(name, 'Enter');
      expect(session.rect(), text).toEqual(rect);
    }
  });

  it('refuses an address that is not one', () => {
    mount();
    const name = host.querySelector<HTMLInputElement>('.sg-name')!;
    act(() => name.focus());
    type(name, 'nowhere');
    keydown(name, 'Enter');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(session.sel.active).toEqual({ row: 0, col: 0 });
  });

  it('has fx, which starts a formula', () => {
    mount();
    click(13, 0);
    act(() => void host.querySelector<HTMLButtonElement>('button[aria-label="Insert function"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(session.edit).toMatchObject({ text: '=', focus: 'bar', mode: 'enter' });
  });

  it('everything in it is a control in the tab order', () => {
    mount();
    const bar = host.querySelector('[data-sg-bar]')!;
    const stops = [...bar.querySelectorAll<HTMLElement>('input, button, textarea')].filter((e) => !(e as HTMLButtonElement).disabled && e.tabIndex >= 0);
    expect(stops.map((e) => e.getAttribute('aria-label'))).toEqual(['Name box', 'Insert function', 'Formula']);
  });
});

describe('the clipboard', () => {
  const clipboard = (init: Record<string, string> = {}) => {
    const map = new Map(Object.entries(init));
    return { setData: (t: string, v: string) => void map.set(t, v), getData: (t: string) => map.get(t) ?? '', map };
  };
  const fire = (type: 'copy' | 'cut' | 'paste', data: ReturnType<typeof clipboard>) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: data });
    act(() => void grid().dispatchEvent(e));
    return e;
  };

  it('copies both flavours of the selection and marks it', async () => {
    mount();
    click(3, 0);
    click(4, 1, { shiftKey: true });
    const data = clipboard();
    const e = fire('copy', data);
    expect(e.defaultPrevented).toBe(true);
    expect(data.getData('text/plain')).toBe('Salaries\t£48,000\nContractors\t£6,500');
    expect(data.getData('text/html')).toContain('<table>');
    expect(session.clip).toMatchObject({ rect: { r1: 3, r2: 4, c1: 0, c2: 1 }, cut: false });
    await frame();
    expect(host.querySelector('.sg-clip')).toBeTruthy();
  });

  it('pastes at the selection\'s top left, with the text and the HTML, and selects what landed', () => {
    mount();
    click(13, 1);
    fire('paste', clipboard({ 'text/plain': 'a\tb\nc\td', 'text/html': '<table><tr><td>a</td></tr></table>' }));
    expect(sent('paste')).toEqual([{ type: 'paste', at: { row: 13, col: 1 }, text: 'a\tb\nc\td', html: '<table><tr><td>a</td></tr></table>' }]);
    expect(session.rect()).toEqual({ r1: 13, r2: 14, c1: 1, c2: 2 });
    expect(sheet.rowsOf({ r1: 13, r2: 14, c1: 1, c2: 2 })).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('pastes text alone when that is all there is', () => {
    mount();
    click(13, 1);
    fire('paste', clipboard({ 'text/plain': 'x' }));
    expect(sent('paste')).toEqual([{ type: 'paste', at: { row: 13, col: 1 }, text: 'x' }]);
  });

  it('a cut is removed by the paste, which says where it came from', () => {
    mount();
    click(3, 0);
    const data = clipboard();
    fire('cut', data);
    expect(sheet.editText(3, 0)).toBe('Salaries');
    click(15, 0);
    fire('paste', clipboard({ 'text/plain': data.getData('text/plain') }));
    expect(sent('paste').at(-1)).toMatchObject({ cut: { r1: 3, r2: 3, c1: 0, c2: 0 } });
        expect(sheet.editText(3, 0)).toBe('');
    expect(sheet.editText(15, 0)).toBe('Salaries');
    expect(session.clip).toBeNull();
  });

  it('Escape drops the marker', () => {
    mount();
    click(3, 0);
    fire('copy', clipboard());
    keydown(grid(), 'Escape');
    expect(session.clip).toBeNull();
  });

  it('leaves a paste into the editor to the editor', () => {
    mount();
    click(13, 0);
    keydown(grid(), 'F2');
    const data = clipboard({ 'text/plain': 'pasted' });
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: data });
    act(() => void editorField().dispatchEvent(e));
    expect(sent('paste')).toEqual([]);
  });
});

describe('Delete', () => {
  it('clears the selection', () => {
    mount();
    click(3, 1);
    click(4, 2, { shiftKey: true });
    keydown(grid(), 'Delete');
    expect(sent('clear')).toEqual([{ type: 'clear', rect: { r1: 3, r2: 4, c1: 1, c2: 2 } }]);
    expect(sheet.editText(3, 1)).toBe('');
  });
});

describe('a sheet that cannot be changed', () => {
  it('refuses typing, F2, Delete and a paste, and tells the host each time', () => {
    sheet.readOnlyFlag = true;
    mount();
    click(3, 0);
    keydown(grid(), 'x');
    keydown(grid(), 'F2');
    keydown(grid(), 'Delete');
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => 'x', setData: () => undefined } });
    act(() => void grid().dispatchEvent(e));
    expect(session.edit).toBeNull();
    expect(refused).toBe(4);
    expect(intents.filter((i) => i.type !== 'select')).toEqual([]);
  });

  it('still selects, and copies', () => {
    sheet.readOnlyFlag = true;
    mount();
    click(3, 0);
    expect(session.sel.active).toEqual({ row: 3, col: 0 });
    expect(host.querySelector('.sg-handle')).toBeNull();
  });

  it('is also what a host can ask for, over data that is editable', () => {
    mount({ readOnly: true });
    click(3, 0);
    keydown(grid(), 'x');
    expect(session.edit).toBeNull();
    expect(refused).toBe(1);
  });

  it('cannot start an edit from the formula bar', () => {
    sheet.readOnlyFlag = true;
    mount();
    click(3, 0);
    expect(barField().readOnly).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Insert function"]')!.disabled).toBe(true);
  });
});

describe('the overlays', () => {
  it('draw the selection, a handle on it, and other people with their names', async () => {
    sheet.peerList = [{ clientId: 7, name: 'Priya', color: '#886193', rect: { r1: 4, r2: 4, c1: 2, c2: 2 }, active: { row: 4, col: 2 } }];
    mount();
    await frame();
    expect(host.querySelector('.sg-sel')).toBeTruthy();
    expect(host.querySelector('.sg-handle')).toBeTruthy();
    const peer = host.querySelector<HTMLElement>('.sg-peer')!;
    expect(peer.style.getPropertyValue('--peer')).toBe('#886193');
    expect(peer.querySelector('.sg-flag')!.textContent).toBe('Priya');
  });

  it('outline the references of the formula in the cell', async () => {
    mount();
    click(9, 5);
    await frame();
    const refs = host.querySelectorAll('.sg-ref');
    expect(refs).toHaveLength(1);
    expect((refs[0] as HTMLElement).style.getPropertyValue('--ref')).toBe('#43a873');
  });

  it('hide the handle while a cell is being edited, and the selection\'s tint', async () => {
    mount();
    click(13, 0);
    keydown(grid(), 'x');
    await frame();
    expect(host.querySelector('.sg-handle')).toBeNull();
    expect(host.querySelector('.sg-sel')!.className).toContain('sg-sel-editing');
  });

  it('put a guide where a column would end while its header edge is dragged, and send the size on release', async () => {
    mount();
    const edge = HW + 180;
    pointer('pointerdown', edge, 10);
    pointer('pointermove', edge + 40, 10);
    await frame();
    expect(host.querySelector('.sg-guide')).toBeTruthy();
    pointer('pointerup', edge + 40, 10);
    expect(sent('resize')).toEqual([{ type: 'resize', axis: 'col', from: 0, to: 0, size: 220 }]);
    await frame();
    expect(host.querySelector('.sg-guide')).toBeNull();
  });

  it('send a fill when the handle is dragged, and select what it covered', async () => {
    mount();
    click(3, 5);
    await frame();
    const x = HW + 180 + 112 * 4 + 120;
    const y = HH + 26 * 4;
    pointer('pointerdown', x - 0.5, y - 0.5);
    pointer('pointermove', centre(6, 5).x, centre(6, 5).y);
    pointer('pointerup', centre(6, 5).x, centre(6, 5).y);
    expect(sent('fill')).toEqual([{ type: 'fill', source: { r1: 3, r2: 3, c1: 5, c2: 5 }, target: { r1: 3, r2: 6, c1: 5, c2: 5 } }]);
    expect(session.rect()).toEqual({ r1: 3, r2: 6, c1: 5, c2: 5 });
  });

  it('send a move when a selected row is dragged to another place', () => {
    mount();
    pointer('pointerdown', 20, HH + 26 * 7 + 5);
    pointer('pointerup', 20, HH + 26 * 7 + 5);
    expect(session.rect()).toEqual({ r1: 7, r2: 7, c1: 0, c2: 25 });
    pointer('pointerdown', 20, HH + 26 * 7 + 5);
    pointer('pointermove', 20, HH + 26 * 3 + 5);
    pointer('pointerup', 20, HH + 26 * 3 + 5);
    expect(sent('move')).toEqual([{ type: 'move', axis: 'row', from: 7, to: 3, count: 1 }]);
    expect(session.rect()).toEqual({ r1: 3, r2: 3, c1: 0, c2: 25 });
  });

  it('send an autofit on a double click on a header edge', () => {
    mount();
    const edge = HW + 180;
    act(() => void scroller().dispatchEvent(new MouseEvent('dblclick', { clientX: edge, clientY: 10, bubbles: true })));
    expect(sent('autofit')).toEqual([{ type: 'autofit', axis: 'col', from: 0, to: 0 }]);
  });

  it('resize every selected column when one of them is dragged', () => {
    mount();
    pointer('pointerdown', HW + 90, 10);
    pointer('pointerup', HW + 90, 10);
    pointer('pointerdown', HW + 180 + 56, 10, { shiftKey: true });
    pointer('pointerup', HW + 180 + 56, 10, { shiftKey: true });
    expect(session.rect()).toMatchObject({ c1: 0, c2: 1 });
    const edge = HW + 180 + 112;
    pointer('pointerdown', edge, 10);
    pointer('pointermove', edge - 30, 10);
    pointer('pointerup', edge - 30, 10);
    expect(sent('resize')).toEqual([{ type: 'resize', axis: 'col', from: 0, to: 1, size: 82 }]);
  });
});

describe('validation lists and filters', () => {
  it('offer the choices of a selected cell with a list, and send the one chosen', async () => {
    sheet.lists.set(13 * 16384 + 1, ['Pending', 'Approved']);
    sheet.put(13, 1, 'Pending');
    mount();
    click(13, 1);
    await frame();
    const arrow = host.querySelector<HTMLButtonElement>('button[aria-label="Show choices"]')!;
    expect(arrow).toBeTruthy();
    act(() => void arrow.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(['Pending', 'Approved']);
    act(() => void host.querySelectorAll('[role="option"]')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(sent('choose')).toEqual([{ type: 'choose', at: { row: 13, col: 1 }, value: 'Approved' }]);
  });

  it('opens the list from the keyboard with Alt+Down', () => {
    sheet.lists.set(13 * 16384 + 1, ['Pending', 'Approved']);
    sheet.put(13, 1, 'Pending');
    mount();
    click(13, 1);
    keydown(grid(), 'ArrowDown', { altKey: true });
    expect(host.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it('tell the host a filter button was pressed', () => {
    sheet.filterInfo = { headerRow: 2, cols: [1, 2], active: [] };
    mount();
    // The button is at the right of the header cell, 18px square.
    const cell = centre(2, 1);
    pointer('pointerdown', cell.x + 112 / 2 - 3 - 9, cell.y);
    expect(sent('filterMenu')).toEqual([{ type: 'filterMenu', col: 1 }]);
  });
});

describe('zoom', () => {
  it('scales every size: the same click lands on a different cell', () => {
    mount({ zoom: 200 });
    // At 200% row 3 is at y = 52 + 3*52, the header 92 wide.
    pointer('pointerdown', 92 + 400, 52 + 52 * 3 + 20);
    pointer('pointerup', 92 + 400, 52 + 52 * 3 + 20);
    expect(session.sel.active).toEqual({ row: 3, col: 1 });
    expect(host.querySelector<HTMLElement>('.sg-cells')!.style.left).toBe('92px');
  });
});
