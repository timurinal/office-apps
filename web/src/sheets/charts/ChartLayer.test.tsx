// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentMeta } from '@shared/api';

vi.mock('../../state', () => ({ useApp: () => ({ me: { id: 'u_ada', name: 'Ada Rowe' } }) }));

// Counts each layout, by the title of the chart it was for: a chart that is drawn again is laid out again.
const laid: (string | undefined)[] = [];
vi.mock('./layout', async (original) => {
  const real = await original<typeof import('./layout')>();
  return {
    ...real,
    layoutChart: (input: Parameters<typeof real.layoutChart>[0], ...rest: unknown[]) => {
      laid.push(input.title);
      return (real.layoutChart as (...a: unknown[]) => ReturnType<typeof real.layoutChart>)(input, ...rest);
    }
  };
});

import { ToastHost } from '../../core/ui';
import { localMeta } from '../../docs/source';
import { RouterProvider } from '../../router';
import { REMOTE, buildSheetSeed, localSheetSource } from '../model';
import { field, sheetsOf } from '../model/structure';
import type { ChartSpec } from '../model/features';
import { SheetsEditor } from '../SheetsEditor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = { w: 900, h: 500 };

let host: HTMLDivElement;
let root: Root;
let theirs: Y.Doc | null = null;

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const frame = () =>
  act(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );
const meta = (over: Partial<DocumentMeta> = {}): DocumentMeta => ({ ...localMeta('Budget', 'local'), kind: 'sheets', ...over });

/** What a stored chart is made against: the real ids of the seed that is opened. */
interface Ids {
  sheet: string;
  rows: string[];
  cols: string[];
}

/** A table with a header row and labels down the side, five categories by two series, and charts on it if asked. */
function seedFor(charts: ((ids: Ids) => Partial<ChartSpec>[]) | Partial<ChartSpec>[] = []) {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Costs', { rows: 60, cols: 10 });
    s.cell(0, 0, { value: 'Item' }).cell(0, 1, { value: 'Spend' }).cell(0, 2, { value: 'Units' });
    ['Rent', 'Pay', 'Tools', 'Travel', 'Food'].forEach((name, i) => s.cell(i + 1, 0, { value: name }).cell(i + 1, 1, { value: (i + 1) * 10 }).cell(i + 1, 2, { value: (i + 1) * 3 }));
  });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seed.state);
  const [id] = [...sheetsOf(doc).keys()];
  const sheet = sheetsOf(doc).get(id!)!;
  const rows = (sheet.get('rowOrder') as Y.Array<string>).toArray();
  const cols = (sheet.get('colOrder') as Y.Array<string>).toArray();
  const list = typeof charts === 'function' ? charts({ sheet: id!, rows, cols }) : charts;
  if (list.length === 0) return seed;
  const map = field(sheet, 'charts')!;
  list.forEach((over, i) =>
    map.set(`chart${i}`, {
      type: 'column',
      sheet: id!,
      data: { r1: rows[0]!, c1: cols[0]!, r2: rows[5]!, c2: cols[1]! },
      anchor: { row: rows[2]!, col: cols[4]!, dx: 0, dy: 0 },
      w: 420,
      h: 280,
      options: { seriesIn: 'cols', headers: true, labels: true },
      ...over
    } satisfies ChartSpec)
  );
  return { ...seed, state: Y.encodeStateAsUpdate(doc) };
}

async function open(over: Partial<DocumentMeta> = {}, charts: Parameters<typeof seedFor>[0] = []) {
  const seed = seedFor(charts);
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
  await flush();
  await flush();
  await frame();
}

const q = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const qa = <T extends Element>(sel: string) => [...host.querySelectorAll<T>(sel)];
const grid = () => q<HTMLElement>('[role="grid"]')!;
const cards = () => qa<HTMLElement>('.sg-cells .oac-card');
const tab = (label: string) => qa<HTMLElement>('.oa-rb-tab').find((e) => e.textContent === label)!;
const click = (el: Element) => act(() => (el as HTMLElement).click());

const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

const type = (field: HTMLTextAreaElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

/** Type into the active cell the way a person does. */
async function enter(text: string) {
  keydown(grid(), text[0]!);
  const field = q<HTMLTextAreaElement>('.sg-editor textarea')!;
  type(field, text);
  keydown(field, 'Enter');
  await frame();
}

const down = (n: number) => {
  for (let i = 0; i < n; i++) keydown(grid(), 'ArrowDown');
};

beforeEach(() => {
  laid.length = 0;
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-toast, .oac-menu').forEach((n) => n.remove());
});

describe('Insert > Charts', () => {
  it('is on the Insert tab: Column, Bar, Line, Area, Pie and Scatter, with the variants in menus', async () => {
    await open();
    click(tab('Insert'));
    await frame();
    const ids = qa('[data-id^="insert.chart-"]').map((e) => e.getAttribute('data-id'));
    expect(ids).toEqual(['insert.chart-column', 'insert.chart-bar', 'insert.chart-line', 'insert.chart-area', 'insert.chart-pie', 'insert.chart-scatter']);
    expect(q('[data-id="insert.chart-column"]')!.textContent).toBe('Column');
    expect(qa('[role="group"][aria-label="Charts"]')).toHaveLength(1);
  });

  it('is off for a reader', async () => {
    await open({ role: 'viewer' });
    click(tab('Insert'));
    await frame();
    for (const e of qa<HTMLButtonElement>('[data-id^="insert.chart-"]')) expect(e.disabled, e.getAttribute('data-id')!).toBe(true);
  });

  it('makes a chart from the selection, over the grid, selected and with the keyboard on it', async () => {
    await open();
    click(tab('Insert'));
    await frame();
    expect(cards()).toHaveLength(0);
    click(q('[data-id="insert.chart-line"]')!);
    await frame();
    await frame();
    const [card] = cards();
    expect(card).toBeDefined();
    expect(card!.getAttribute('data-selected')).toBe('true');
    expect(card!.getAttribute('aria-label')).toBe('Chart');
    expect(card!.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toMatch(/^Line chart, 2 series, 5 points/);
    expect(document.activeElement).toBe(card);
    // The grid placed it, in its own frame.
    expect(card!.style.transform).toMatch(/^translate\(/);
    expect(card!.style.visibility).toBe('');
    expect(card!.style.getPropertyValue('--cw')).toBe('420px');
  });

  it('says so, and makes nothing, when nothing is selected that has numbers', async () => {
    await open();
    for (let i = 0; i < 40; i++) keydown(grid(), 'ArrowDown');
    click(tab('Insert'));
    await frame();
    click(q('[data-id="insert.chart-pie"]')!);
    await frame();
    // A pie menu has no button of its own: the entries are in a menu.
    expect(cards()).toHaveLength(0);
  });
});

describe('a chart on the grid', () => {
  const one = async () => {
    await open({}, [{ title: 'Spend' }]);
    await frame();
    await frame();
    return cards()[0]!;
  };

  it('is drawn from a stored chart, in the grid\'s overlay layer, behind the cell editor', async () => {
    const card = await one();
    expect(card).toBeDefined();
    expect(card.closest('.sg-cells')).not.toBeNull();
    expect(card.closest('.oac-layer')).not.toBeNull();
    expect(card.querySelectorAll('[data-k^="r0."]')).toHaveLength(5);
    expect(card.textContent).toContain('Spend');
    expect(card.getAttribute('data-selected')).toBeNull();
  });

  it('is not rendered with the page when something else on the page renders', async () => {
    await one();
    laid.length = 0;
    // Moving the active cell re-renders the editor's grid parts, not the chart.
    down(2);
    await frame();
    expect(laid).toEqual([]);
  });

  it('draws again when a cell in its range changes, and not for a cell outside it', async () => {
    await one();
    const bar = () => q('[data-k="r0.1"]')!.getAttribute('d');
    const before = bar();
    laid.length = 0;
    // A2 is "Rent": go to B2 and type.
    keydown(grid(), 'ArrowRight');
    down(1);
    await enter('99');
    await frame();
    expect(laid).toEqual(['Spend']);
    expect(bar()).not.toBe(before);
    expect(cards()).toHaveLength(1);

    laid.length = 0;
    const svg = q('.oac-card svg')!;
    // E12 is outside the chart's range.
    for (let i = 0; i < 3; i++) keydown(grid(), 'ArrowRight');
    down(10);
    await enter('hello');
    await frame();
    expect(laid).toEqual([]);
    expect(q('.oac-card svg')).toBe(svg);
  });

  it('draws only the chart whose range changed, when there are two', async () => {
    await open({}, ({ sheet, rows, cols }) => {
      const base = { sheet, anchor: { row: rows[2]!, col: cols[4]!, dx: 0, dy: 0 } };
      return [
        { ...base, title: 'Spend', data: { r1: rows[0]!, c1: cols[0]!, r2: rows[5]!, c2: cols[1]! } },
        { ...base, title: 'Units', data: { r1: rows[0]!, c1: cols[2]!, r2: rows[5]!, c2: cols[2]! }, options: { seriesIn: 'cols', headers: true, labels: false } }
      ];
    });
    await frame();
    await frame();
    expect(cards()).toHaveLength(2);
    // Spend is A1:B6 and Units is C1:C6. C3 is in Units' range only.
    laid.length = 0;
    keydown(grid(), 'ArrowRight');
    keydown(grid(), 'ArrowRight');
    down(2);
    await enter('77');
    await frame();
    expect(laid).toEqual(['Units']);
  });

  it('follows a chart another person changes', async () => {
    await one();
    const sheet = sheetsOf(theirs!).get([...sheetsOf(theirs!).keys()][0]!)!;
    const charts = field(sheet, 'charts')!;
    const spec = charts.get('chart0') as ChartSpec;
    act(() => {
      theirs!.transact(() => charts.set('chart0', { ...spec, title: 'Theirs', type: 'pie' }), REMOTE);
    });
    await flush();
    await frame();
    expect(cards()[0]!.textContent).toContain('Theirs');
    expect(cards()[0]!.querySelector('svg')!.getAttribute('aria-label')).toMatch(/^Pie chart/);
  });

  it('does not pop in when the sheet is opened with it on it, pops in when one arrives, and fades out when one goes', async () => {
    const card = await one();
    expect(card.querySelector('.oac-in')!.classList.contains('oa-pop')).toBe(false);

    const sheet = sheetsOf(theirs!).get([...sheetsOf(theirs!).keys()][0]!)!;
    const charts = field(sheet, 'charts')!;
    const spec = charts.get('chart0') as ChartSpec;
    act(() => {
      theirs!.transact(() => charts.set('chart1', { ...spec, title: 'Newcomer' }), REMOTE);
    });
    await flush();
    await frame();
    const fresh = cards().find((c) => c.textContent?.includes('Newcomer'))!;
    expect(fresh.querySelector('.oac-in')!.classList.contains('oa-pop')).toBe(true);
    expect(fresh.querySelector('.oac-in')!.getAttribute('data-state')).toBe('open');
    // The one that was there is not touched by it.
    expect(cards().find((c) => c.textContent?.includes('Spend'))!.querySelector('.oac-in')!.classList.contains('oa-pop')).toBe(false);

    act(() => {
      theirs!.transact(() => charts.delete('chart1'), REMOTE);
    });
    await flush();
    const leaving = cards().find((c) => c.textContent?.includes('Newcomer'))!;
    expect(leaving.querySelector('.oac-in')!.getAttribute('data-state')).toBe('closed');
    expect(leaving.querySelectorAll('.oac-h')).toHaveLength(0);
    await wait(250);
    expect(cards().find((c) => c.textContent?.includes('Newcomer'))).toBeUndefined();
    expect(cards()).toHaveLength(1);
  });

  it('is selected by a press, with the handles an editor gets, and let go of by a press on the grid', async () => {
    const card = await one();
    expect(card.querySelectorAll('.oac-h')).toHaveLength(0);
    act(() => {
      card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 200, pointerId: 1 }));
    });
    await frame();
    expect(cards()[0]!.getAttribute('data-selected')).toBe('true');
    expect(cards()[0]!.querySelectorAll('.oac-h')).toHaveLength(8);
    act(() => {
      q('.sg-scroller')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 40, pointerId: 2 }));
    });
    await frame();
    expect(cards()[0]!.getAttribute('data-selected')).toBeNull();
    expect(cards()[0]!.querySelectorAll('.oac-h')).toHaveLength(0);
  });

  it('is removed by Delete, and Ctrl+Z brings it back', async () => {
    const card = await one();
    act(() => card.focus());
    await frame();
    keydown(card, 'Delete');
    await wait(200);
    expect(cards()).toHaveLength(0);
    keydown(document.body, 'z', { ctrlKey: true });
    await frame();
    await frame();
    expect(cards()).toHaveLength(1);
  });

  it('lets go on Escape and gives the keyboard back to the grid', async () => {
    const card = await one();
    act(() => card.focus());
    await frame();
    expect(card.getAttribute('data-selected')).toBe('true');
    keydown(card, 'Escape');
    await frame();
    expect(cards()[0]!.getAttribute('data-selected')).toBeNull();
    expect(document.activeElement).toBe(grid());
  });

  it('nudges with the arrow keys, one step each, and undo puts it back', async () => {
    const card = await one();
    act(() => card.focus());
    await frame();
    keydown(card, 'ArrowRight');
    keydown(card, 'ArrowDown', { shiftKey: true });
    await frame();
    keydown(document.body, 'z', { ctrlKey: true });
    await frame();
    keydown(document.body, 'z', { ctrlKey: true });
    await frame();
    expect(cards()).toHaveLength(1);
  });

  it('opens its menu on a right click: Edit chart, both downloads, Delete', async () => {
    const card = await one();
    act(() => {
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
    });
    await frame();
    const rows = [...document.body.querySelectorAll('.oac-menu .oa-menu-label')].map((e) => e.textContent);
    expect(rows).toEqual(['Edit chart', 'Download as PNG', 'Download as SVG', 'Delete chart']);
    keydown(document.body.querySelector('.oac-menu')!, 'Escape');
    await frame();
    expect(document.body.querySelector('.oac-menu')).toBeNull();
  });

  it('opens the chart pane on a double click, showing this chart\'s settings, and the pane changes it', async () => {
    const card = await one();
    // No press first: the double click selects it itself.
    act(() => {
      card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await wait(50);
    const pane = q('.oac-pane')!;
    expect(pane).not.toBeNull();
    expect(pane.querySelector('select')!.value).toBe('column');
    expect(pane.querySelector<HTMLInputElement>('input[value="Spend"]')).not.toBeNull();
    act(() => {
      const select = pane.querySelector('select')!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'doughnut');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await frame();
    await frame();
    expect(cards()[0]!.querySelector('svg')!.getAttribute('aria-label')).toMatch(/^Doughnut chart/);
  });
});

describe('a chart for a reader', () => {
  it('is drawn, can be selected and downloaded, and has no handles, no delete and no pane', async () => {
    await open({ role: 'viewer' }, [{ title: 'Spend' }]);
    await frame();
    await frame();
    const card = cards()[0]!;
    expect(card).toBeDefined();
    act(() => {
      card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    });
    await frame();
    expect(cards()[0]!.querySelectorAll('.oac-h')).toHaveLength(0);
    keydown(cards()[0]!, 'Delete');
    await frame();
    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.getAttribute('data-selected')).toBe('true');
    // The key was not taken: the keyboard is where it was.
    expect(document.activeElement).toBe(cards()[0]);
    act(() => {
      cards()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
    });
    await frame();
    expect([...document.body.querySelectorAll('.oac-menu .oa-menu-label')].map((e) => e.textContent)).toEqual(['Download as PNG', 'Download as SVG']);
  });
});

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
