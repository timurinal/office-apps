// @vitest-environment happy-dom
/**
 * The formatting and data tools in the real editor: the ribbon, the keys, the filter, the dialogs and
 * the find bar on a local workbook, as a person reaches them. The tools' own rules are tested against
 * the model (`*.test.ts`) and the dialogs on their own (`panes/tools.dom.test.tsx`); this is that they
 * are wired to the page.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentMeta } from '@shared/api';

vi.mock('../../state', () => ({ useApp: () => ({ me: { id: 'u_ada', name: 'Ada Rowe' } }) }));

import { ToastHost } from '../../core/ui';
import { localMeta } from '../../docs/source';
import { RouterProvider } from '../../router';
import { closeFind } from '../panes/findStore';
import { closeTool } from '../panes/tools';
import { buildSheetSeed, localSheetSource } from '../model';
import { SheetsEditor } from '../SheetsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = { w: 900, h: 500 };

let host: HTMLDivElement;
let root: Root;

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const frame = () =>
  act(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );

const meta = (): DocumentMeta => ({ ...localMeta('Budget', 'local'), kind: 'sheets' });

async function open() {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('People');
    ['Name', 'Qty'].forEach((h, c) => s.cell(0, c, { value: h }));
    [['pear', 3], ['apple', 12], ['fig', 7]].forEach(([n, q], i) => {
      s.cell(i + 1, 0, { value: n as string });
      s.cell(i + 1, 1, { value: q as number });
    });
  });
  const source = localSheetSource({ state: seed.state, cells: seed.cells });
  act(() =>
    root.render(
      <RouterProvider>
        <ToastHost>
          <SheetsEditor source={source} meta={meta()} />
        </ToastHost>
      </RouterProvider>
    )
  );
  await wait(0);
  await wait(0);
  await frame();
}

const q = <T extends Element>(sel: string) => document.body.querySelector<T>(sel);
const grid = () => q<HTMLElement>('[role="grid"]')!;
const spoken = () => q('.sg-sr [role="gridcell"]')!.textContent;
const item = (id: string) => q<HTMLElement>(`[data-id="${id}"]`)!;
const tab = (label: string) => [...document.body.querySelectorAll<HTMLElement>('.oa-rb-tab')].find((e) => e.textContent === label)!;

const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  let prevented = false;
  act(() => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    prevented = e.defaultPrevented;
  });
  return prevented;
};

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
  closeTool();
  closeFind();
  document.body.querySelectorAll('.oa-toast, .oa-scrim, .sx-find, .sx-menu').forEach((n) => n.remove());
});

describe('Home', () => {
  it('has the font, alignment, number and styles controls, and presses Bold for the active cell', async () => {
    await open();
    for (const id of ['home.font-family', 'home.size', 'home.bold', 'home.borders', 'home.align', 'home.merge', 'home.number-format', 'home.currency', 'home.conditional', 'home.cell-styles', 'home.sort-filter', 'home.find']) {
      expect(item(id), id).not.toBeNull();
    }
    expect(item('home.bold').getAttribute('aria-pressed')).toBe('false');
    act(() => item('home.bold').click());
    await frame();
    expect(item('home.bold').getAttribute('aria-pressed')).toBe('true');
    act(() => item('home.bold').click());
    await frame();
    expect(item('home.bold').getAttribute('aria-pressed')).toBe('false');
  });

  it('takes Ctrl+B in the grid, and the page keeps the keyboard', async () => {
    await open();
    expect(keydown(grid(), 'b', { ctrlKey: true })).toBe(true);
    await frame();
    expect(item('home.bold').getAttribute('aria-pressed')).toBe('true');
    expect(keydown(grid(), 'z', { ctrlKey: true })).toBe(true);
    await frame();
    expect(item('home.bold').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows a number as currency from the format dropdown, and the dropdown follows the cell', async () => {
    await open();
    keydown(grid(), 'ArrowDown');
    keydown(grid(), 'ArrowRight');
    await frame();
    expect(spoken()).toBe('B2, 3');
    expect(item('home.number-format').textContent).toContain('General');
    act(() => item('home.number-format').click());
    await frame();
    act(() => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.startsWith('Currency'))!.click());
    await frame();
    expect(spoken()).toBe('B2, £3.00');
    expect(item('home.number-format').textContent).toContain('Currency');
  });

  it('sets the font size from the size box', async () => {
    await open();
    const box = item('home.size') as HTMLInputElement;
    act(() => box.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, '14');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    keydown(box, 'Enter');
    await frame();
    expect((item('home.size') as HTMLInputElement).value).toBe('14');
  });
});

describe('Data', () => {
  it('sorts A to Z with the active cell’s column, under its heading', async () => {
    await open();
    keydown(grid(), 'ArrowDown');
    await frame();
    act(() => tab('Data').click());
    await frame();
    act(() => item('data.sort-az').click());
    await frame();
    keydown(grid(), 'ArrowUp');
    keydown(grid(), 'ArrowDown');
    expect(spoken()).toBe('A2, apple');
  });

  it('turns the filter on with the button and with Ctrl+Shift+L, and Clear waits for a criterion', async () => {
    await open();
    keydown(grid(), 'ArrowDown');
    act(() => tab('Data').click());
    await frame();
    expect(item('data.filter').getAttribute('aria-pressed')).toBe('false');
    act(() => item('data.filter').click());
    await frame();
    expect(item('data.filter').getAttribute('aria-pressed')).toBe('true');
    expect((item('data.clear-filter') as HTMLButtonElement).disabled).toBe(true);
    expect(keydown(grid(), 'L', { ctrlKey: true, shiftKey: true })).toBe(true);
    await frame();
    expect(item('data.filter').getAttribute('aria-pressed')).toBe('false');
  });

  it('opens the filter menu for a header from the keyboard, as the grid reports it', async () => {
    await open();
    keydown(grid(), 'ArrowDown');
    act(() => tab('Data').click());
    await frame();
    act(() => item('data.filter').click());
    await frame();
    // Back on the header row: Alt+Down on a filter button is its menu.
    keydown(grid(), 'ArrowUp');
    keydown(grid(), 'ArrowDown', { altKey: true });
    await wait(50);
    expect(q('.sx-menu')).not.toBeNull();
    const values = [...document.body.querySelectorAll('.sx-menu-values .sx-check')].map((c) => c.textContent);
    expect(values).toEqual(['Select all', 'apple1', 'fig1', 'pear1']);
  });

  it('opens the sort dialog, fetched when asked for', async () => {
    await open();
    act(() => tab('Data').click());
    await frame();
    act(() => item('data.sort').click());
    await wait(100);
    expect(q('.oa-dialog h2')?.textContent).toBe('Sort');
  });
});

describe('Formulas', () => {
  it('inserts a function into the cell once the dialog has gone, and shows formulas as text', async () => {
    await open();
    keydown(grid(), 'ArrowDown');
    keydown(grid(), 'ArrowDown');
    keydown(grid(), 'ArrowDown');
    keydown(grid(), 'ArrowDown');
    act(() => tab('Formulas').click());
    await frame();
    act(() => item('formulas.insert').click());
    await wait(100);
    const search = q<HTMLInputElement>('input[aria-label="Search functions"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'sumif');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => [...document.body.querySelectorAll<HTMLButtonElement>('.oa-dialog button')].find((b) => b.textContent === 'Insert')!.click());
    await wait(300);
    expect(q<HTMLTextAreaElement>('.sg-editor textarea')?.value).toBe('=SUMIF(');
  });

  it('turns Show formulas on and off', async () => {
    await open();
    act(() => tab('Formulas').click());
    await frame();
    expect(item('formulas.show').getAttribute('aria-pressed')).toBe('false');
    act(() => item('formulas.show').click());
    await frame();
    expect(item('formulas.show').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Find', () => {
  it('opens on Ctrl+F in the grid, counts as it is typed, and selects the match', async () => {
    await open();
    expect(keydown(grid(), 'f', { ctrlKey: true })).toBe(true);
    await wait(50);
    const field = q<HTMLInputElement>('input[aria-label="Find"]')!;
    expect(field).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'p');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(250);
    // pear and apple.
    expect(q('.sx-find-count')?.textContent).toBe('2 found');
    keydown(field, 'Enter');
    await frame();
    expect(spoken()).toBe('A2, pear');
    keydown(field, 'Enter');
    await frame();
    expect(spoken()).toBe('A3, apple');
    keydown(field, 'Escape');
    await wait(200);
    expect(q('.sx-find')).toBeNull();
  });

  it('shows the replace row on Ctrl+H', async () => {
    await open();
    keydown(grid(), 'h', { ctrlKey: true });
    await wait(50);
    expect(q('input[aria-label="Replace with"]')).not.toBeNull();
  });
});
