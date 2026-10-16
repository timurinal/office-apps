// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentMeta } from '@shared/api';

vi.mock('../state', () => ({ useApp: () => ({ me: { id: 'u_ada', name: 'Ada Rowe' } }) }));

import { ToastHost } from '../core/ui';
import { localMeta } from '../docs/source';
import { RouterProvider } from '../router';
import { REMOTE, buildSheetSeed, localSheetSource } from './model';
import { FakeRoom } from './model/testing/fakeRoom';
import { sheetOrderOf, sheetsOf, part } from './model/structure';
import { SheetsEditor } from './SheetsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** happy-dom has no layout, so the box the grid measures is given. */
const VIEW = { w: 900, h: 500 };

let host: HTMLDivElement;
let root: Root;

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const frame = () =>
  act(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );

const meta = (over: Partial<DocumentMeta> = {}): DocumentMeta => ({ ...localMeta('Budget', 'local'), kind: 'sheets', ...over });

/** The structure document of the workbook that is open, for a test to be somebody else with. */
let theirs: Y.Doc | null = null;

async function open(over: Partial<DocumentMeta> = {}) {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Costs');
    s.cell(0, 0, { value: 10 }).cell(1, 0, { value: 20 });
    b.addSheet('Headcount');
  });
  const inner = localSheetSource({ state: seed.state, cells: seed.cells });
  const source = {
    ...inner,
    connect: (events: Parameters<typeof inner.connect>[0]) => {
      const c = inner.connect(events);
      theirs = c.doc;
      return c;
    }
  };
  act(() =>
    root.render(
      <RouterProvider>
        <ToastHost>
          <SheetsEditor source={source} meta={meta(over)} />
        </ToastHost>
      </RouterProvider>
    )
  );
  // The model is made in an effect, and the source's snapshot comes a microtask later.
  await flush();
  await flush();
  await frame();
}

const q = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const grid = () => q<HTMLElement>('[role="grid"]')!;
/** The cell the screen reader is told about: "A1, 10". */
const spoken = () => q('.sg-sr [role="gridcell"]')!.textContent;

const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  let prevented = false;
  act(() => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    prevented = e.defaultPrevented;
  });
  return prevented;
};

const type = (field: HTMLTextAreaElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

/** Type into the active cell the way a person does: a key starts the edit, the field takes the text, Enter ends it. */
async function enter(text: string) {
  keydown(grid(), text[0]!);
  const field = q<HTMLTextAreaElement>('.sg-editor textarea')!;
  type(field, text);
  keydown(field, 'Enter');
  await frame();
}

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

const toast = () => document.body.querySelector('.oa-toast')?.textContent ?? null;

beforeEach(() => {
  // The grid's size, everywhere but the ribbon, which then has no layout and draws every group.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('.oa-rb-strip') ? 0 : VIEW.w;
    }
  });
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-toast').forEach((n) => n.remove());
});

describe('the page', () => {
  it('is the banner, the ribbon tabs Excel has, the formula bar, the grid and the footer', async () => {
    await open();
    expect(q('[role="banner"]')).not.toBeNull();
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent).filter((t) => t === 'Home' || t === 'View' || t === 'Insert')).toEqual(['Home', 'Insert', 'View']);
    // The formula bar is the banner's fourth row, inside it.
    expect(q('[role="banner"] [aria-label="Formula bar"]')).not.toBeNull();
    expect(grid().getAttribute('aria-label')).toBe('Budget');
    expect(spoken()).toBe('A1, 10');
    // The sheet tabs and the sum are in the footer.
    expect([...host.querySelectorAll('.oa-footer [role="tab"]')].map((t) => t.textContent)).toEqual(['Costs', 'Headcount']);
    // A local file has no room: no Share, no comments, no people.
    expect(host.textContent).not.toContain('Share');
    expect(q('[aria-label="People here"]')).toBeNull();
    expect(host.textContent).toContain('On this device');
  });

  it('is the app that is on screen: Sheets green, on a full-bleed stage', async () => {
    await open();
    expect(q('.oa-shell')!.getAttribute('data-app')).toBe('sheets');
    expect(q('.oa-stage')!.getAttribute('data-bleed')).toBe('true');
    // The marker Home's card lands on.
    expect(q('.oa-sheet-page')!.hasAttribute('data-doc-page')).toBe(true);
  });
});

describe('the View tab', () => {
  const tab = (label: string) => [...host.querySelectorAll<HTMLElement>('.oa-rb-tab')].find((e) => e.textContent === label)!;

  it('zooms the footer\'s slider and the grid together, from a button', async () => {
    await open();
    act(() => tab('View').click());
    await frame();
    expect(q('.oa-zoom-pct')!.textContent).toBe('100%');
    act(() => button('Zoom in').click());
    expect(q('.oa-zoom-pct')!.textContent).toBe('110%');
    expect((q('.oa-shell') as HTMLElement).style.getPropertyValue('--page-zoom')).toBe('1.1');
    act(() => q<HTMLElement>('[data-id="view.zoom-100"]')!.click());
    expect(q('.oa-zoom-pct')!.textContent).toBe('100%');
    // Zoom out stops at 50%.
    for (let i = 0; i < 8; i++) act(() => button('Zoom out').click());
    expect(q('.oa-zoom-pct')!.textContent).toBe('50%');
    expect(button('Zoom out').disabled).toBe(true);
  });

  it('turns the gridlines off and on', async () => {
    await open();
    act(() => tab('View').click());
    await frame();
    const lines = () => q<HTMLElement>('.sg-root')!.style.getPropertyValue('--sg-line');
    expect(lines()).toBe('');
    act(() => q<HTMLElement>('[data-id="view.gridlines"]')!.click());
    expect(lines()).toBe('var(--sg-paper)');
    expect(q('[data-id="view.gridlines"]')!.getAttribute('aria-pressed')).toBe('false');
    act(() => q<HTMLElement>('[data-id="view.gridlines"]')!.click());
    expect(lines()).toBe('');
  });
});

describe('editing', () => {
  it('types into a cell, and the ribbon and Ctrl+Z follow', async () => {
    await open();
    expect(button('Undo').disabled).toBe(true);

    // A3 is below the two numbers: the active cell moves there with the keys.
    keydown(grid(), 'ArrowDown');
    keydown(grid(), 'ArrowDown');
    await enter('7');
    await frame();
    expect(button('Undo').disabled).toBe(false);

    // Select A3 again and read it back.
    keydown(grid(), 'ArrowUp');
    expect(spoken()).toContain('A3, 7');

    // Ctrl+Z is the page's: the grid leaves it alone, and the undo empties A3.
    expect(keydown(grid(), 'z', { ctrlKey: true })).toBe(true);
    await frame();
    expect(spoken()).toContain('A3, empty');
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(false);

    // Ctrl+Y and Ctrl+Shift+Z both redo.
    keydown(grid(), 'y', { ctrlKey: true });
    await frame();
    expect(spoken()).toContain('A3, 7');
    keydown(grid(), 'z', { ctrlKey: true });
    keydown(grid(), 'Z', { ctrlKey: true, shiftKey: true });
    await frame();
    expect(spoken()).toContain('A3, 7');
  });

  it('adds up the selection in the footer, and follows an edit made inside it', async () => {
    await open();
    const sum = () => q('.sg-status')?.textContent ?? null;
    // A1:A2 is 10 and 20.
    keydown(grid(), 'ArrowDown', { shiftKey: true });
    await wait(200);
    expect(sum()).toBe('Sum: 30');
    // Change A1 (the active cell) to 40: the sum catches up within a moment, with nobody moving the selection.
    keydown(grid(), 'F2');
    const field = q<HTMLTextAreaElement>('.sg-editor textarea')!;
    type(field, '40');
    keydown(field, 'Enter');
    await wait(200);
    expect(sum()).toBe('Sum: 60');
  });

  it('shows another sheet from its tab, with that sheet\'s own selection', async () => {
    await open();
    const second = [...host.querySelectorAll<HTMLElement>('.oa-footer [role="tab"]')].find((t) => t.textContent === 'Headcount')!;
    act(() => second.click());
    await frame();
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(spoken()).toBe('A1, empty');
  });

  it('adds a sheet from the footer and shows it', async () => {
    await open();
    act(() => button('New sheet').click());
    await frame();
    const names = [...host.querySelectorAll('.oa-footer [role="tab"]')].map((t) => t.textContent);
    expect(names).toHaveLength(3);
    expect(host.querySelector('.oa-footer [role="tab"][aria-selected="true"]')!.textContent).toBe(names[2]);
  });
});

describe('somebody else inserting a row while this person types', () => {
  it('lands the typing on the cell it began on, not on whatever slid into its place', async () => {
    await open();
    // Begin an edit on A2 (the 20), and leave it open.
    keydown(grid(), 'ArrowDown');
    keydown(grid(), '5');
    const field = q<HTMLTextAreaElement>('.sg-editor textarea')!;
    type(field, '5');

    // Another person inserts a row above the first, as their own step arriving from the room.
    act(() => {
      const first = sheetOrderOf(theirs!).get(0)!;
      theirs!.transact(() => part(sheetsOf(theirs!).get(first)!, 'rowOrder').insert(0, ['zzzzzzzz']), REMOTE);
    });
    await frame();
    expect(q('.sg-editor[data-open="true"]')).not.toBeNull();

    keydown(field, 'Enter');
    await frame();
    const at = async (row: number) => {
      for (let i = 0; i < 10; i++) keydown(grid(), 'ArrowUp');
      for (let i = 0; i < row; i++) keydown(grid(), 'ArrowDown');
      await frame();
      return spoken();
    };
    // The inserted row is A1 and the 10 is A2, untouched; the 20 that was being edited is A3, and is now 5.
    expect(await at(1)).toBe('A2, 10');
    expect(await at(2)).toBe('A3, 5');
  });
});

describe('a reader', () => {
  it('sees the grid, cannot change it, and is told so', async () => {
    await open({ role: 'viewer' });
    expect(spoken()).toBe('A1, 10');
    expect(host.textContent).toContain('View only');
    expect(grid().getAttribute('aria-readonly')).toBe('true');
    expect(button('Undo').disabled).toBe(true);
    expect(button('Paste').disabled).toBe(true);

    keydown(grid(), '9');
    await frame();
    expect(q('.sg-editor[data-open="true"]')).toBeNull();
    expect(toast()).toBe('You can view this spreadsheet, not edit it.');
    expect(spoken()).toBe('A1, 10');
  });

  it('may not copy from a link whose owner turned downloads off', async () => {
    await open({ role: 'viewer', canDownload: false, principal: 'link' });
    expect(q('button[aria-label="Copy"]')).toBeNull();
    expect(q('button[aria-label="Cut"]')).toBeNull();
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    act(() => void grid().dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
  });
});

describe('a sheet that takes a moment to open', () => {
  // A room's snapshot comes in parts. The page waits half a second before it says how far it has got, so a sheet that
  // opens at once never flashes a line, and then shows the share of the parts that have come.
  it('says how far it is after half a second, and not before; and the line goes when the cells are in', async () => {
    const seed = buildSheetSeed((b) => {
      b.addSheet('Costs').cell(0, 0, { value: 10 });
    });
    const room = new FakeRoom(seed);
    const client = room.client('a', 4);
    act(() =>
      root.render(
        <RouterProvider>
          <ToastHost>
            <SheetsEditor source={client.source} meta={meta({ id: 'room-doc' })} />
          </ToastHost>
        </RouterProvider>
      )
    );
    await flush();
    // The connection, the structure, and the first of four parts.
    act(() => void client.deliver(4));
    await frame();
    expect(q('[role="progressbar"]')).toBeNull();
    expect(q('.oa-sheet-skel')).not.toBeNull();

    await wait(650);
    const bar = q('[role="progressbar"]')!;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('aria-label')).toBe('Opening this spreadsheet');
    expect(bar.getAttribute('aria-valuenow')).toBe('20');
    expect(bar.querySelector('span')!.style.transform).toBe('scaleX(0.2)');

    act(() => void client.deliver(1));
    await frame();
    expect(q('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('40');

    act(() => void client.deliver());
    await flush();
    await frame();
    expect(q('[role="progressbar"]')).toBeNull();
    expect(grid()).not.toBeNull();
  });

  it('never shows the line for a sheet that opens at once', async () => {
    await open();
    expect(q('[role="progressbar"]')).toBeNull();
    await wait(650);
    expect(q('[role="progressbar"]')).toBeNull();
  });
});

describe('the right-click menu', () => {
  const scroller = () => q<HTMLElement>('.sg-scroller')!;
  const rightClick = (x: number, y: number, init: MouseEventInit = {}) => {
    let e!: MouseEvent;
    act(() => {
      scroller().dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, button: 2, bubbles: true, cancelable: true }));
      e = new MouseEvent('contextmenu', { clientX: x, clientY: y, button: 2, bubbles: true, cancelable: true, ...init });
      scroller().dispatchEvent(e);
    });
    return e;
  };
  const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]');
  const labels = () => [...(menu()?.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]') ?? [])].map((r) => r.querySelector('.oa-menu-label')!.textContent);
  const row = (label: string) => [...menu()!.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((r) => r.querySelector('.oa-menu-label')!.textContent === label)!;
  // The row header is 46px wide and the column header 26px tall; a cell is 112 by 26.
  const cellAt = (r: number, c: number) => ({ x: 46 + (c === 0 ? 20 : 180 + (c - 1) * 112 + 20), y: 26 + r * 26 + 13 });

  it('opens over a cell with the cell menu, takes the browser\'s, and runs a row on the cell that was clicked', async () => {
    await open();
    const { x, y } = cellAt(1, 0);
    const e = rightClick(x, y);
    expect(e.defaultPrevented).toBe(true);
    expect(menu()!.getAttribute('aria-label')).toBe('Cells');
    expect(labels()).toEqual(['Cut', 'Copy', 'Paste', 'Paste values', 'Insert', 'Delete', 'Clear contents', 'Sort', 'Filter', 'Format cells…']);
    expect(spoken()).toBe('A2, 20');
    act(() => row('Clear contents').click());
    // The menu is leaving. Asked before the frame, which on a loaded machine can outlast the exit.
    expect(menu()!.getAttribute('data-state')).toBe('closed');
    await frame();
    expect(spoken()).toBe('A2, empty');
    // The keyboard is back on the grid.
    expect(document.activeElement).toBe(grid());
  });

  it('opens over a column header with the column menu, and Column width opens its dialog', async () => {
    await open();
    rightClick(46 + 20, 13);
    expect(menu()!.getAttribute('aria-label')).toBe('Columns');
    expect(labels()).toContain('Column width…');
    act(() => row('Column width…').click());
    await wait(50);
    await flush();
    expect(document.body.querySelector('[role="dialog"] h2')!.textContent).toBe('Column width');
  });

  it('is the browser\'s with Shift held', async () => {
    await open();
    const { x, y } = cellAt(0, 0);
    const e = rightClick(x, y, { shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  it('is only Copy for a viewer', async () => {
    await open({ role: 'viewer' });
    const { x, y } = cellAt(0, 0);
    rightClick(x, y);
    expect(labels()).toEqual(['Copy']);
  });

  it('draws no menu for a viewer who may not download, and does not show the browser\'s either', async () => {
    await open({ role: 'viewer', canDownload: false, principal: 'link' });
    const { x, y } = cellAt(0, 0);
    const e = rightClick(x, y);
    expect(menu()).toBeNull();
    expect(e.defaultPrevented).toBe(true);
  });
});
