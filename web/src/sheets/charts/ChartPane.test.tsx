// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { room } from '../model/test/helpers';
import type { SheetModel } from '../model';
import type { SheetsContext } from '../modules/types';
import { SERIES_COLORS } from './palette';
import { ChartPane } from './ChartPane';
import { chartStoreFor } from './store';
import type { ChartSpec } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let model: SheetModel;
let sheet: string;
let id: string;

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => {
  const sh = model.engine.sheet(sheet)!;
  return {
    type: 'column',
    sheet,
    data: { r1: sh.rowOrder[0]!, c1: sh.colOrder[0]!, r2: sh.rowOrder[4]!, c2: sh.colOrder[2]! },
    anchor: { row: sh.rowOrder[6]!, col: sh.colOrder[4]!, dx: 0, dy: 0 },
    w: 420,
    h: 280,
    title: 'Spend',
    options: { seriesIn: 'cols', headers: true, labels: true },
    ...over
  };
};

const stored = (): ChartSpec => chartStoreFor(model).get(id)!.spec;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function mount(over: { edit?: boolean; type?: ChartSpec['type']; select?: boolean } = {}) {
  const r = room((b) => {
    const s = b.addSheet('Data', { rows: 20, cols: 6 });
    s.cell(0, 0, { value: 'Item' }).cell(0, 1, { value: 'Spend' }).cell(0, 2, { value: 'Units' });
    ['Rent', 'Pay', 'Tools', 'Food'].forEach((n, i) => s.cell(i + 1, 0, { value: n }).cell(i + 1, 1, { value: (i + 1) * 10 }).cell(i + 1, 2, { value: i + 1 }));
    b.addSheet('Other', { rows: 5, cols: 3 });
  });
  model = r.people[0]!.model;
  sheet = r.sheet;
  id = model.setRule(sheet, 'charts', null, spec(over.type ? { type: over.type } : {}))!;
  if (over.select !== false) chartStoreFor(model).select(id);
  const ctx = { model, sheetId: sheet, can: { edit: over.edit ?? true } } as unknown as SheetsContext;
  act(() => root.render(<ChartPane ctx={ctx} />));
  await flush();
}

const q = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const field = (label: string): HTMLInputElement | null => [...host.querySelectorAll<HTMLInputElement>('input')].find((i) => host.querySelector(`label[for="${i.id}"]`)?.textContent === label) ?? null;
const select = (label: string) => [...host.querySelectorAll('select')].find((s) => host.querySelector(`label[for="${s.id}"]`)?.textContent === label)!;
const toggle = (label: string) => host.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${label}"]`);

const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
const blur = (el: HTMLElement) => act(() => void el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
const key = (el: HTMLElement, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
const click = (el: Element) => act(() => (el as HTMLElement).click());

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('with no chart selected', () => {
  it('says what to do', async () => {
    await mount({ select: false });
    expect(host.textContent).toBe('Select a chart.');
  });
});

describe('the pane', () => {
  it('shows the chart\'s settings: type, range, series in, headers, labels, title and the legend it has by default', async () => {
    await mount();
    expect(select('Chart type').value).toBe('column');
    expect(field('Data range')!.value).toBe('A1:C5');
    expect(select('Series in').value).toBe('cols');
    expect(toggle('Headers')!.getAttribute('aria-checked')).toBe('true');
    expect(toggle('Labels')!.getAttribute('aria-checked')).toBe('true');
    expect(field('Title')!.value).toBe('Spend');
    // Two series and nothing chosen: the legend at the bottom.
    expect(select('Legend').value).toBe('bottom');
    expect(host.textContent).toContain('First row is headers');
    expect(host.textContent).toContain('First column is labels');
  });

  it('changes the type at once, as one step, and shows Stacked only where it means something', async () => {
    await mount();
    expect(toggle('Stacked')).not.toBeNull();
    setValue(select('Chart type'), 'line');
    await flush();
    expect(stored().type).toBe('line');
    expect(toggle('Stacked')).toBeNull();
    model.undo();
    expect(stored().type).toBe('column');
  });

  it('hides the axes for a pie and names its colours for slices', async () => {
    await mount({ type: 'pie' });
    expect(q('[aria-label="Axes"]')).toBeNull();
    expect(host.textContent).toContain('Slice colours');
    // The categories are the slices.
    expect(host.textContent).toContain('Rent');
  });

  it('commits a text field when it is left, and not before', async () => {
    await mount();
    const title = field('Title')!;
    setValue(title, 'Spend by quarter');
    expect(stored().title).toBe('Spend');
    blur(title);
    await flush();
    expect(stored().title).toBe('Spend by quarter');
  });

  it('commits on Enter, puts the old text back on Escape, and writes nothing for either that changed nothing', async () => {
    await mount();
    const title = field('Title')!;
    setValue(title, 'Draft');
    key(title, 'Escape');
    await flush();
    expect(field('Title')!.value).toBe('Spend');
    expect(stored().title).toBe('Spend');
    const before = model.canUndo();
    blur(field('Title')!);
    expect(model.canUndo()).toBe(before);
    setValue(field('Title')!, 'Final');
    key(field('Title')!, 'Enter');
    await flush();
    expect(stored().title).toBe('Final');
  });

  it('removes a title that is emptied', async () => {
    await mount();
    setValue(field('Title')!, '');
    blur(field('Title')!);
    await flush();
    expect('title' in stored()).toBe(false);
  });

  it('refuses a range that is not one, in the field, and writes nothing; takes one that is, and the chart reads it', async () => {
    await mount();
    const range = field('Data range')!;
    setValue(range, 'nowhere');
    blur(range);
    await flush();
    expect(host.textContent).toContain('That is not a range in this spreadsheet.');
    expect(stored().data).toEqual(spec().data);
    setValue(field('Data range')!, 'A1:B3');
    blur(field('Data range')!);
    await flush();
    expect(chartStoreFor(model).get(id)!.data!.series.map((s) => s.name)).toEqual(['Spend']);
    expect(host.textContent).not.toContain('That is not a range');
  });

  it('turns the series, and the labels of the two switches turn with it', async () => {
    await mount();
    setValue(select('Series in'), 'rows');
    await flush();
    expect(stored().options).toMatchObject({ seriesIn: 'rows' });
    expect(host.textContent).toContain('First column is headers');
    expect(host.textContent).toContain('First row is labels');
  });

  it('switches headers and labels', async () => {
    await mount();
    click(toggle('Headers')!);
    await flush();
    expect(stored().options?.headers).toBe(false);
    expect(chartStoreFor(model).get(id)!.data!.series[0]!.name).toBe('Series 1');
  });

  it('writes a legend, titles and limits to the chart, and removes what is emptied', async () => {
    await mount();
    setValue(select('Legend'), 'right');
    await flush();
    expect(stored().options?.legend).toBe('right');
    setValue(field('Horizontal axis title')!, 'Item');
    blur(field('Horizontal axis title')!);
    setValue(field('Vertical minimum')!, '5');
    blur(field('Vertical minimum')!);
    setValue(field('Vertical maximum')!, '60.5');
    blur(field('Vertical maximum')!);
    await flush();
    expect(stored().options).toMatchObject({ legend: 'right', xTitle: 'Item', yMin: 5, yMax: 60.5 });
    setValue(field('Vertical minimum')!, '');
    blur(field('Vertical minimum')!);
    await flush();
    expect('yMin' in stored().options!).toBe(false);
  });

  it('refuses a limit that is not a number', async () => {
    await mount();
    setValue(field('Vertical maximum')!, 'lots');
    blur(field('Vertical maximum')!);
    await flush();
    expect(host.textContent).toContain('Enter a number.');
    expect(stored().options && 'yMax' in stored().options!).toBe(false);
  });

  it('shows the horizontal limits for a scatter and not for a column', async () => {
    await mount();
    expect(field('Horizontal minimum')).toBeNull();
    setValue(select('Chart type'), 'scatter');
    await flush();
    expect(field('Horizontal minimum')).not.toBeNull();
  });

  it('colours a series from the palette, padding the ones before it, and resets them', async () => {
    await mount();
    const rows = [...host.querySelectorAll('.oac-color')];
    expect(rows.map((r) => r.querySelector('span')!.textContent)).toEqual(['Spend', 'Units']);
    const second = rows[1]!.querySelectorAll<HTMLButtonElement>('.oac-swatch');
    expect(second[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(second[1]!.getAttribute('aria-pressed')).toBe('true');
    click(second[4]!);
    await flush();
    expect(stored().options?.colors).toEqual(['', SERIES_COLORS[4]]);
    expect([...host.querySelectorAll('.oac-color')][1]!.querySelectorAll('.oac-swatch')[4]!.getAttribute('aria-pressed')).toBe('true');
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Reset colours')!);
    await flush();
    expect(stored().options && 'colors' in stored().options!).toBe(false);
  });

  it('deletes the chart, and the pane goes back to asking for one', async () => {
    await mount();
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Delete chart')!);
    await flush();
    expect(chartStoreFor(model).chartsOn(sheet)).toHaveLength(0);
    expect(host.textContent).toBe('Select a chart.');
  });
});

describe('the pane for a reader', () => {
  it('shows the chart and changes nothing: every control is off and there is no Delete', async () => {
    await mount({ edit: false });
    for (const el of [...host.querySelectorAll<HTMLElement>('input, select, button')] as (HTMLElement & { disabled: boolean })[]) expect(el.disabled, el.outerHTML.slice(0, 60)).toBe(true);
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Delete chart')).toBeUndefined();
  });
});
