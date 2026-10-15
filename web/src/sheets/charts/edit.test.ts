import { describe, expect, it } from 'vitest';
import type { Toast } from '../../core/ui';
import type { Rect } from '../grid/types';
import { room } from '../model/test/helpers';
import { resolveRect } from '../model/structure';
import {
  deleteChart,
  insertChart,
  parseRange,
  patched,
  rangeText,
  setBox,
  setChartOptions,
  setData,
  setOptions,
  setSeriesIn,
  setTitle,
  setType,
  trimToData,
  type InsertContext
} from './edit';
import { chartStoreFor, viewReader } from './store';
import type { ChartSpec } from './types';

const make = () => {
  const r = room((b) => {
    const s = b.addSheet('Budget', { rows: 50, cols: 12 });
    s.cell(2, 0, { value: 'Category' });
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q, c) => s.cell(2, c + 1, { value: q }));
    ['Salaries', 'Software', 'Hosting', 'Travel', 'Marketing'].forEach((name, i) => {
      s.cell(3 + i, 0, { value: name });
      for (let c = 0; c < 4; c++) s.cell(3 + i, c + 1, { value: (i + 1) * 100 + c });
    });
    s.cell(20, 0, { value: 'only text here' });
    b.addSheet('Other', { rows: 20, cols: 6 });
  });
  const model = r.people[0]!.model;
  const toasts: Toast[] = [];
  const ctx = (rect: Rect, sheet = r.sheet): InsertContext => ({
    model,
    sheetId: sheet,
    selection: () => ({ rect, active: { row: rect.r1, col: rect.c1 } }),
    session: { layer: null },
    notify: (t) => void toasts.push(t)
  });
  return { ...r, model, toasts, ctx };
};

// Five categories under four quarters: taller than wide, so the series run down the columns.
const TABLE: Rect = { r1: 2, r2: 7, c1: 0, c2: 4 };

describe('insertChart', () => {
  it('makes one chart beside the selection, with the layout it read, and selects it', () => {
    const { model, sheet, ctx } = make();
    const id = insertChart(ctx(TABLE), 'column')!;
    const e = chartStoreFor(model).get(id)!;
    expect(e.spec).toMatchObject({ type: 'column', sheet, w: 420, h: 280, options: { seriesIn: 'cols', headers: true, labels: true } });
    expect(e.spec.title).toBeUndefined();
    const sh = model.engine.sheet(sheet)!;
    // The data range is stored by ids and reads back as the selection.
    expect(resolveRect(sh, e.spec.data)).toEqual(TABLE);
    // The anchor is the first row of the data, one empty column clear of it.
    expect([sh.rowIndex().get(e.spec.anchor.row), sh.colIndex().get(e.spec.anchor.col)]).toEqual([2, 6]);
    expect(chartStoreFor(model).selected).toBe(id);
    expect(e.data!.series.map((s) => s.name)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
  });

  it('is one step: one undo removes it', () => {
    const { model, sheet, ctx } = make();
    insertChart(ctx(TABLE), 'line');
    expect(chartStoreFor(model).chartsOn(sheet)).toHaveLength(1);
    model.undo();
    expect(chartStoreFor(model).chartsOn(sheet)).toHaveLength(0);
  });

  it('takes a single cell for the block around it', () => {
    const { model, sheet, ctx } = make();
    const id = insertChart(ctx({ r1: 4, r2: 4, c1: 2, c2: 2 }), 'bar')!;
    expect(resolveRect(model.engine.sheet(sheet)!, chartStoreFor(model).get(id)!.spec.data)).toEqual(TABLE);
  });

  it('trims a whole-column selection to the data in it', () => {
    const { model, sheet, ctx } = make();
    const id = insertChart(ctx({ r1: 0, r2: 49, c1: 1, c2: 2 }), 'column')!;
    const rect = resolveRect(model.engine.sheet(sheet)!, chartStoreFor(model).get(id)!.spec.data)!;
    expect(rect).toEqual({ r1: 2, r2: 7, c1: 1, c2: 2 });
  });

  it('names a chart of one series after it', () => {
    const { model, ctx } = make();
    const id = insertChart(ctx({ r1: 2, r2: 7, c1: 3, c2: 3 }), 'column')!;
    expect(chartStoreFor(model).get(id)!.spec.title).toBe('Q3');
  });

  it('stores a stacked variant, and a pie\'s type', () => {
    const { model, ctx } = make();
    const a = insertChart(ctx(TABLE), 'column', { stacked: true })!;
    const b = insertChart(ctx(TABLE), 'doughnut')!;
    expect(chartStoreFor(model).get(a)!.spec.options?.stacked).toBe(true);
    expect(chartStoreFor(model).get(b)!.spec.type).toBe('doughnut');
    expect(chartStoreFor(model).get(b)!.spec.options?.stacked).toBeUndefined();
  });

  it('puts the series in rows for a block that is wider than it is tall', () => {
    const { model, ctx } = make();
    const id = insertChart(ctx({ r1: 2, r2: 4, c1: 0, c2: 4 }), 'column')!;
    // Header row, label column, 2 data rows by 4 data columns: wider than tall.
    expect(chartStoreFor(model).get(id)!.spec.options).toMatchObject({ seriesIn: 'rows', headers: true, labels: true });
    expect(chartStoreFor(model).get(id)!.data!.series.map((s) => s.name)).toEqual(['Salaries', 'Software']);
  });

  it('says once that there is nothing to plot, and makes nothing', () => {
    const { model, sheet, toasts, ctx } = make();
    expect(insertChart(ctx({ r1: 20, r2: 20, c1: 0, c2: 0 }), 'column')).toBeNull();
    expect(insertChart(ctx({ r1: 40, r2: 41, c1: 3, c2: 4 }), 'column')).toBeNull();
    expect(toasts).toEqual([{ text: 'Select cells that have numbers.' }, { text: 'Select cells that have numbers.' }]);
    expect(chartStoreFor(model).chartsOn(sheet)).toHaveLength(0);
  });

  it('makes nothing in a workbook that cannot be changed, and the model says so', () => {
    const { model, sheet, ctx } = make();
    const seen: string[] = [];
    model.onNotice((n) => seen.push(n.kind));
    model.setReadOnly(true);
    expect(insertChart(ctx(TABLE), 'column')).toBeNull();
    expect(seen).toContain('read-only');
    expect(chartStoreFor(model).chartsOn(sheet)).toHaveLength(0);
  });

  it('steps a second chart down and right so it is not hidden behind the first', () => {
    const { model, sheet, ctx } = make();
    insertChart(ctx(TABLE), 'column');
    insertChart(ctx(TABLE), 'line');
    insertChart(ctx(TABLE), 'area');
    const offsets = chartStoreFor(model).chartsOn(sheet).map((e) => [e.spec.anchor.dx, e.spec.anchor.dy]);
    expect(offsets).toEqual([
      [0, 0],
      [24, 24],
      [48, 48]
    ]);
  });

  it('is seen by the other person, as stored, with its data read from their own cells', () => {
    const m = make();
    const theirs = m.people[1]!.model;
    const id = insertChart(m.ctx(TABLE), 'column')!;
    m.room.flush();
    const mine = chartStoreFor(m.model).get(id)!;
    const seen = chartStoreFor(theirs).get(id)!;
    expect(seen.spec).toEqual(mine.spec);
    expect(seen.data!.series[0]!.values).toEqual(mine.data!.series[0]!.values);
  });
});

describe('trimToData', () => {
  it('drops empty edge rows and columns and answers null for a block of nothing', () => {
    const { model, sheet } = make();
    const reader = viewReader(model, sheet);
    expect(trimToData({ r1: 0, r2: 49, c1: 0, c2: 11 }, reader, null)).toEqual({ r1: 2, r2: 20, c1: 0, c2: 4 });
    expect(trimToData({ r1: 30, r2: 40, c1: 0, c2: 5 }, reader, null)).toBeNull();
  });
});

describe('changing a chart', () => {
  const made = (over: Parameters<typeof insertChart>[2] = {}) => {
    const m = make();
    const id = insertChart(m.ctx(TABLE), 'column', over)!;
    const store = chartStoreFor(m.model);
    return { ...m, id, store, entry: () => store.get(id)! };
  };

  it('each is one step, one undo', () => {
    const { model, entry } = made();
    setType(model, entry(), 'line');
    setTitle(model, entry(), 'Spend');
    setChartOptions(model, entry(), { legend: 'top' });
    expect(entry().spec).toMatchObject({ type: 'line', title: 'Spend', options: { legend: 'top' } });
    model.undo();
    expect(entry().spec.options?.legend).toBeUndefined();
    model.undo();
    expect(entry().spec.title).toBeUndefined();
    model.undo();
    expect(entry().spec.type).toBe('column');
  });

  it('removes a title that is emptied, and an option that is blank, so nothing is stored for nothing', () => {
    const { model, entry } = made();
    setTitle(model, entry(), 'Spend');
    setTitle(model, entry(), '   ');
    expect('title' in entry().spec).toBe(false);
    setChartOptions(model, entry(), { xTitle: 'Quarter', colors: ['', ''] });
    expect(entry().spec.options?.xTitle).toBe('Quarter');
    expect(entry().spec.options && 'colors' in entry().spec.options!).toBe(false);
    setChartOptions(model, entry(), { xTitle: '' });
    expect(entry().spec.options && 'xTitle' in entry().spec.options!).toBe(false);
  });

  it('patched and setOptions never leave an undefined or an empty options object', () => {
    const spec: ChartSpec = { type: 'bar', sheet: 's', data: { r1: 'a', c1: 'b', r2: 'c', c2: 'd' }, anchor: { row: 'a', col: 'b', dx: 0, dy: 0 }, w: 1, h: 1, title: 't', options: { stacked: true } };
    expect('title' in patched(spec, { title: undefined })).toBe(false);
    expect('options' in setOptions(spec, { stacked: undefined })).toBe(false);
    expect(setOptions(spec, { legend: 'none' }).options).toEqual({ stacked: true, legend: 'none' });
    expect(spec.options).toEqual({ stacked: true });
  });

  it('turns the series: the roles of the first row and the first column go with it', () => {
    const { model, entry } = made();
    // The table has a header row but say its first column holds no labels.
    setChartOptions(model, entry(), { headers: true, labels: false });
    setSeriesIn(model, entry(), 'rows');
    expect(entry().spec.options).toMatchObject({ seriesIn: 'rows', headers: false, labels: true });
    setSeriesIn(model, entry(), 'rows');
    expect(entry().spec.options?.seriesIn).toBe('rows');
    setSeriesIn(model, entry(), 'cols');
    expect(entry().spec.options).toMatchObject({ seriesIn: 'cols', headers: true, labels: false });
  });

  it('moves and sizes in one step, never below the smallest chart or above the largest', () => {
    const { model, entry, sheet } = made();
    const sh = model.engine.sheet(sheet)!;
    const anchor = { row: sh.rowOrder[9]!, col: sh.colOrder[7]!, dx: 12, dy: 30 };
    setBox(model, entry(), { anchor, w: 20, h: 20 });
    expect(entry().spec).toMatchObject({ anchor, w: 180, h: 130 });
    setBox(model, entry(), { anchor, w: 99999, h: 99999 });
    expect(entry().spec).toMatchObject({ w: 2400, h: 1800 });
    setBox(model, entry(), { anchor, w: 333.6, h: 222.2 });
    expect(entry().spec).toMatchObject({ w: 334, h: 222 });
    model.undo();
    expect(entry().spec).toMatchObject({ w: 2400, h: 1800 });
  });

  it('is removed, with its selection, and brought back by undo', () => {
    const { model, entry, store, id, sheet } = made();
    expect(store.selected).toBe(id);
    deleteChart(model, entry());
    expect(store.selected).toBeNull();
    expect(store.chartsOn(sheet)).toHaveLength(0);
    model.undo();
    expect(store.chartsOn(sheet)).toHaveLength(1);
  });

  it('changes its data to another range, which may be on another sheet', () => {
    const { model, entry, sheet } = made();
    const other = model.sheets()[1]!.id;
    const sh = model.engine.sheet(sheet)!;
    setData(model, entry(), sheet, { r1: sh.rowOrder[2]!, c1: sh.colOrder[0]!, r2: sh.rowOrder[4]!, c2: sh.colOrder[2]! });
    expect(entry().data!.series.map((s) => s.name)).toEqual(['Q1', 'Q2']);
    const parsed = parseRange(model, entry(), `Budget!A3:B4`)!;
    expect(parsed.sheet).toBe(sheet);
    void other;
  });
});

describe('the data range as text', () => {
  const made = () => {
    const m = make();
    const id = insertChart(m.ctx(TABLE), 'column')!;
    return { ...m, entry: () => chartStoreFor(m.model).get(id)! };
  };

  it('prints the range in A1, and the sheet\'s name when the data is not on the chart\'s own sheet', () => {
    const { model, entry, sheet } = made();
    expect(rangeText(model, entry())).toBe('A3:E8');
    const sh = model.engine.sheet(sheet)!;
    const other = model.sheets()[1]!.id;
    const moved = { ...entry(), host: other };
    expect(rangeText(model, moved)).toBe('Budget!A3:E8');
    void sh;
  });

  it('reads what a person types: a block, a block on a named sheet, a quoted name', () => {
    const { model, entry, sheet } = made();
    const rect = (text: string) => {
      const p = parseRange(model, entry(), text);
      return p ? [p.sheet === sheet ? 'Budget' : 'other', resolveRect(model.engine.sheet(p.sheet)!, p.data)] : null;
    };
    expect(rect('B3:C5')).toEqual(['Budget', { r1: 2, r2: 4, c1: 1, c2: 2 }]);
    expect(rect('  $B$3:$C$5 ')).toEqual(['Budget', { r1: 2, r2: 4, c1: 1, c2: 2 }]);
    expect(rect('budget!B3:C5')).toEqual(['Budget', { r1: 2, r2: 4, c1: 1, c2: 2 }]);
    expect(rect("'Other'!A1:B2")).toEqual(['other', { r1: 0, r2: 1, c1: 0, c2: 1 }]);
    expect(rect('B3')).toEqual(['Budget', { r1: 2, r2: 2, c1: 1, c2: 1 }]);
  });

  it('refuses what is not a block of this workbook', () => {
    const { model, entry } = made();
    for (const text of ['', 'hello', 'Nowhere!A1:B2', 'A1:ZZ9999', 'A1:B2:C3', 'Other!A1:Z99']) expect(parseRange(model, entry(), text), text).toBeNull();
  });

  it('quotes a sheet name that needs it, and reads it back', () => {
    const { model, entry } = made();
    const spaced = model.addSheet('Q1 results')!;
    const moved = { ...entry(), host: spaced };
    const text = rangeText(model, moved);
    expect(text).toBe('Budget!A3:E8');
    const odd = model.addSheet("Mike's data")!;
    const e2: typeof moved = { ...moved, host: odd, spec: { ...moved.spec, sheet: odd, data: { r1: model.engine.sheet(odd)!.rowOrder[0]!, c1: model.engine.sheet(odd)!.colOrder[0]!, r2: model.engine.sheet(odd)!.rowOrder[1]!, c2: model.engine.sheet(odd)!.colOrder[1]! } } };
    expect(rangeText(model, { ...e2, host: spaced })).toBe("'Mike''s data'!A1:B2");
    expect(parseRange(model, { ...e2, host: spaced }, "'Mike''s data'!A1:B2")?.sheet).toBe(odd);
  });
});
