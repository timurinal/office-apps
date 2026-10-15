import { describe, expect, it, vi } from 'vitest';
import type { SheetModel } from '../model';
import { room, type } from '../model/test/helpers';
import { chartStoreFor, readChart, sameData, viewReader } from './store';
import type { ChartSpec } from './types';

/** A sheet with a header row, labels down the side and two numeric columns, the second formatted as money. */
const make = () => {
  const r = room((b) => {
    const s = b.addSheet('Data', { rows: 40, cols: 8 });
    s.cell(0, 0, { value: 'Category' }).cell(0, 1, { value: 'Units' }).cell(0, 2, { value: 'Spend' });
    for (let i = 1; i <= 6; i++) s.cell(i, 0, { value: `Item ${i}` }).cell(i, 1, { value: i * 3 }).cell(i, 2, { value: i * 1000, style: { numFmt: '£#,##0' } });
    s.cell(20, 0, { value: 'elsewhere' });
    b.addSheet('Other', { rows: 10, cols: 4 });
  });
  return { ...r, a: r.people[0]!.model, b: r.people[1]!.model };
};

const spec = (m: SheetModel, sheet: string, over: Partial<ChartSpec> = {}, host = sheet): ChartSpec => {
  const sh = m.engine.sheet(sheet)!;
  const on = m.engine.sheet(host)!;
  return {
    type: 'column',
    sheet,
    data: { r1: sh.rowOrder[0]!, c1: sh.colOrder[0]!, r2: sh.rowOrder[6]!, c2: sh.colOrder[2]! },
    anchor: { row: on.rowOrder[10]!, col: on.colOrder[4]!, dx: 0, dy: 0 },
    w: 420,
    h: 280,
    options: { seriesIn: 'cols', headers: true, labels: true },
    ...over
  };
};

/** The store, listened to, so it keeps itself up to date and says each time it does. */
const watch = (m: SheetModel) => {
  const store = chartStoreFor(m);
  let emitted = 0;
  const off = store.subscribe(() => emitted++);
  return { store, emitted: () => emitted, off };
};

describe('reading a chart', () => {
  it('reads the series from the cells as they show: names, values, number formats and labels', () => {
    const { a, sheet } = make();
    const data = readChart(a, spec(a, sheet))!;
    expect(data.labels).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5', 'Item 6']);
    expect(data.series.map((s) => s.name)).toEqual(['Units', 'Spend']);
    expect(data.series[1]!.values).toEqual([1000, 2000, 3000, 4000, 5000, 6000]);
    expect(data.series[1]!.fmt).toBe('£#,##0');
    expect(data.series[0]!.fmt).toBeUndefined();
  });

  it('is null where the range has been deleted away', () => {
    const { a, sheet } = make();
    const s = spec(a, sheet);
    a.deleteRows(sheet, 0, 7);
    expect(readChart(a, s)).toBeNull();
  });

  it('skips hidden rows and columns, as Excel does', () => {
    const { a, sheet } = make();
    a.hide(sheet, 'row', 2, 3, true);
    a.hide(sheet, 'col', 1, 1, true);
    const data = readChart(a, spec(a, sheet))!;
    expect(data.labels).toEqual(['Item 1', 'Item 4', 'Item 5', 'Item 6']);
    expect(data.series.map((s) => s.name)).toEqual(['Spend']);
  });

  it('reads formulas\' values, and errors as gaps', () => {
    const { a, sheet } = make();
    type(a, sheet, 'B3', '=B2*10');
    type(a, sheet, 'B4', '=1/0');
    const data = readChart(a, spec(a, sheet))!;
    expect(data.series[0]!.values.slice(0, 3)).toEqual([3, 30, null]);
  });

  it('reads through the reader the way the grid reads: a number is a number and its text is what it shows', () => {
    const { a, sheet } = make();
    const reader = viewReader(a, sheet);
    expect(reader.cell(1, 2)).toEqual({ v: 1000, text: '£1,000', fmt: '£#,##0' });
    expect(reader.cell(1, 0)).toEqual({ v: 'Item 1', text: 'Item 1' });
    expect(reader.cell(30, 5)).toBeNull();
  });
});

describe('sameData', () => {
  it('compares what a chart draws, not the objects', () => {
    const { a, sheet } = make();
    const x = readChart(a, spec(a, sheet))!;
    const y = readChart(a, spec(a, sheet))!;
    expect(x).not.toBe(y);
    expect(sameData(x, y)).toBe(true);
    expect(sameData(x, null)).toBe(false);
    expect(sameData(null, null)).toBe(true);
    y.series[1]!.values[2] = 3001;
    expect(sameData(x, y)).toBe(false);
  });
});

describe('the store', () => {
  it('has the charts of every sheet, by the sheet they sit on, and nothing before there is one', () => {
    const { a, sheet } = make();
    const other = a.sheets()[1]!.id;
    const store = chartStoreFor(a);
    expect(store.chartsOn(sheet)).toEqual([]);
    a.setRule(sheet, 'charts', null, spec(a, sheet));
    a.setRule(other, 'charts', null, spec(a, sheet, { type: 'line' }, other));
    expect(store.chartsOn(sheet).map((e) => e.spec.type)).toEqual(['column']);
    expect(store.chartsOn(other).map((e) => e.spec.type)).toEqual(['line']);
    // The chart on Other draws the data on Data.
    expect(store.chartsOn(other)[0]!.data!.series).toHaveLength(2);
  });

  it('says so when a chart is made, changed or removed, and gives the same list when nothing changed', () => {
    const { a, sheet } = make();
    const w = watch(a);
    const id = a.setRule(sheet, 'charts', null, spec(a, sheet))!;
    expect(w.emitted()).toBe(1);
    const list = w.store.chartsOn(sheet);
    expect(w.store.chartsOn(sheet)).toBe(list);
    a.setRule(sheet, 'charts', id, spec(a, sheet, { title: 'Spend' }));
    expect(w.emitted()).toBe(2);
    expect(w.store.chartsOn(sheet)[0]!.spec.title).toBe('Spend');
    a.setRule(sheet, 'charts', id, null);
    expect(w.emitted()).toBe(3);
    expect(w.store.chartsOn(sheet)).toEqual([]);
    w.off();
  });

  it('draws again when a cell in the range changes, and says nothing for a cell outside every range', () => {
    const { a, sheet } = make();
    const w = watch(a);
    a.setRule(sheet, 'charts', null, spec(a, sheet));
    const before = w.emitted();
    const entry = w.store.chartsOn(sheet)[0]!;
    type(a, sheet, 'C3', '9999');
    expect(w.emitted()).toBe(before + 1);
    const now = w.store.chartsOn(sheet)[0]!;
    expect(now).not.toBe(entry);
    expect(now.spec).toBe(entry.spec);
    expect(now.data!.series[1]!.values[1]).toBe(9999);

    // A cell on the sheet but outside the range: the chart read it again and found nothing new.
    type(a, sheet, 'F20', 'hello');
    type(a, sheet, 'A21', 'far below');
    expect(w.emitted()).toBe(before + 1);
    expect(w.store.chartsOn(sheet)[0]).toBe(now);
    w.off();
  });

  it('draws only the charts whose own range changed', () => {
    const { a, sheet } = make();
    const w = watch(a);
    const sh = a.engine.sheet(sheet)!;
    a.setRule(sheet, 'charts', null, spec(a, sheet, { title: 'first' }));
    a.setRule(sheet, 'charts', null, spec(a, sheet, { title: 'second', data: { r1: sh.rowOrder[0]!, c1: sh.colOrder[0]!, r2: sh.rowOrder[2]!, c2: sh.colOrder[1]! } }));
    const [one, two] = w.store.chartsOn(sheet);
    // Row 6 is in the first chart's range and not the second's.
    type(a, sheet, 'C6', '1');
    const [one2, two2] = w.store.chartsOn(sheet);
    expect(one2).not.toBe(one);
    expect(two2).toBe(two);
    w.off();
  });

  it('does not read a chart\'s cells at all when the sheet that changed is not the one it draws', () => {
    const { a, sheet } = make();
    const w = watch(a);
    a.setRule(sheet, 'charts', null, spec(a, sheet));
    const other = a.sheets()[1]!.id;
    const read = vi.spyOn(a.view(sheet), 'cell');
    type(a, other, 'A1', 'elsewhere');
    expect(read).not.toHaveBeenCalled();
    type(a, sheet, 'C3', '5');
    expect(read).toHaveBeenCalled();
    w.off();
  });

  it('follows a row inserted in the range, one moved and one hidden', () => {
    const { a, sheet } = make();
    const w = watch(a);
    a.setRule(sheet, 'charts', null, spec(a, sheet));
    expect(w.store.chartsOn(sheet)[0]!.data!.labels).toHaveLength(6);
    a.insertRows(sheet, 3, 1);
    expect(w.store.chartsOn(sheet)[0]!.data!.labels).toHaveLength(7);
    a.hide(sheet, 'row', 1, 1, true);
    expect(w.store.chartsOn(sheet)[0]!.data!.labels).toHaveLength(6);
    a.move(sheet, 'row', 1, 4, 1);
    const labels = w.store.chartsOn(sheet)[0]!.data!.labels;
    expect(labels).toHaveLength(6);
    w.off();
  });

  it('follows a format that changes what a cell shows', () => {
    const { a, sheet } = make();
    const w = watch(a);
    a.setRule(sheet, 'charts', null, spec(a, sheet));
    expect(w.store.chartsOn(sheet)[0]!.data!.series[0]!.fmt).toBeUndefined();
    a.setStyle(sheet, { r1: 1, c1: 1, r2: 6, c2: 1 }, { numFmt: '0.0' });
    expect(w.store.chartsOn(sheet)[0]!.data!.series[0]!.fmt).toBe('0.0');
    w.off();
  });

  it('has a chart another person makes or changes', () => {
    const { a, b, room: r, sheet } = make();
    const w = watch(a);
    b.setRule(sheet, 'charts', null, spec(b, sheet, { title: 'Theirs' }));
    r.flush();
    expect(w.store.chartsOn(sheet).map((e) => e.spec.title)).toEqual(['Theirs']);
    type(b, sheet, 'B2', '77');
    r.flush();
    expect(w.store.chartsOn(sheet)[0]!.data!.series[0]!.values.slice(0, 2)).toEqual([77, 6]);
    w.off();
  });

  it('selects a chart, lets go of it, and forgets it when it is removed', () => {
    const { a, sheet } = make();
    const w = watch(a);
    const id = a.setRule(sheet, 'charts', null, spec(a, sheet))!;
    const n = w.emitted();
    w.store.select(id);
    expect(w.store.selected).toBe(id);
    expect(w.emitted()).toBe(n + 1);
    w.store.select(id);
    expect(w.emitted()).toBe(n + 1);
    a.setRule(sheet, 'charts', id, null);
    expect(w.store.selected).toBeNull();
    w.off();
  });

  it('detaches from the model when the last listener goes, and reads afresh for the next', () => {
    const { a, sheet } = make();
    const w = watch(a);
    w.off();
    a.setRule(sheet, 'charts', null, spec(a, sheet));
    const again = watch(a);
    expect(again.store.chartsOn(sheet)).toHaveLength(1);
    again.off();
  });

  it('is one per model', () => {
    const { a, b } = make();
    expect(chartStoreFor(a)).toBe(chartStoreFor(a));
    expect(chartStoreFor(a)).not.toBe(chartStoreFor(b));
  });
});
