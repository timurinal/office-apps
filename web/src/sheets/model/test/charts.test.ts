/**
 * What the model gives charts: a stored shape that survives the room and the undo stack, ranges and
 * an anchor that follow inserts and deletes, and `onDataChanged`, which tells a chart whose cells
 * changed without telling it about somebody else's cursor.
 */

import { describe, expect, it } from 'vitest';
import type { SheetModel } from '../model';
import type { ChartSpec } from '../features';
import { type IdRect, field, part, sheetsOf } from '../structure';
import { room, type } from './helpers';

const two = () => {
  const r = room((b) => {
    const s = b.addSheet('Data', { rows: 30, cols: 8 });
    for (let i = 0; i < 6; i++) s.cell(i, 0, { value: `row ${i}` }).cell(i, 1, { value: i + 1 }).cell(i, 2, { value: (i + 1) * 10 });
  });
  return { ...r, a: r.people[0]!.model, b: r.people[1]!.model };
};

const ids = (m: SheetModel, sheet: string) => {
  const sh = m.engine.sheet(sheet)!;
  // Copies: the engine's own arrays change under a delete.
  return { rows: [...sh.rowOrder], cols: [...sh.colOrder] };
};

const specOn = (m: SheetModel, sheet: string, over: Partial<ChartSpec> = {}): ChartSpec => {
  const { rows, cols } = ids(m, sheet);
  return {
    type: 'column',
    sheet,
    data: { r1: rows[0]!, c1: cols[0]!, r2: rows[5]!, c2: cols[2]! },
    anchor: { row: rows[8]!, col: cols[4]!, dx: 6, dy: 12 },
    w: 420,
    h: 280,
    title: 'Spend',
    options: { seriesIn: 'cols', headers: false, labels: true, legend: 'bottom', stacked: true, xTitle: 'Row', yTitle: 'Amount', yMin: 0, yMax: 100, colors: ['#112233', ''] },
    ...over
  };
};

const chartsOf = (m: SheetModel, sheet: string) => field(sheetsOf(m.doc).get(sheet)!, 'charts')!;

describe('the stored chart', () => {
  it('is one entry in the sheet\'s charts map, whole, and the other person has it as it was written', () => {
    const { a, b, room: r, sheet } = two();
    const spec = specOn(a, sheet);
    const id = a.setRule(sheet, 'charts', null, spec)!;
    r.flush();
    expect(chartsOf(a, sheet).get(id)).toEqual(spec);
    expect(chartsOf(b, sheet).get(id)).toEqual(spec);
  });

  it('is replaced as a whole by a later write with its id, and removed by null', () => {
    const { a, b, room: r, sheet } = two();
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.setRule(sheet, 'charts', id, specOn(a, sheet, { type: 'line', title: 'Trend' }));
    r.flush();
    expect(chartsOf(b, sheet).size).toBe(1);
    expect((chartsOf(b, sheet).get(id) as ChartSpec).type).toBe('line');
    a.setRule(sheet, 'charts', id, null);
    r.flush();
    expect(chartsOf(b, sheet).size).toBe(0);
  });

  it('is one undo, and undo and redo bring it and its place back', () => {
    const { a, sheet } = two();
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.setRule(sheet, 'charts', id, specOn(a, sheet, { w: 500 }));
    expect((chartsOf(a, sheet).get(id) as ChartSpec).w).toBe(500);
    a.undo();
    expect((chartsOf(a, sheet).get(id) as ChartSpec).w).toBe(420);
    a.undo();
    expect(chartsOf(a, sheet).size).toBe(0);
    a.redo();
    expect(chartsOf(a, sheet).size).toBe(1);
  });

  it('keeps both charts when two people add one at once', () => {
    const { a, b, room: r, sheet } = two();
    a.setRule(sheet, 'charts', null, specOn(a, sheet, { title: 'A' }));
    b.setRule(sheet, 'charts', null, specOn(b, sheet, { title: 'B' }));
    r.flush();
    expect(chartsOf(a, sheet).size).toBe(2);
    expect([...chartsOf(b, sheet).values()].map((c) => (c as ChartSpec).title).sort()).toEqual(['A', 'B']);
  });
});

describe('a chart\'s data range follows the rows and columns', () => {
  const rect = (m: SheetModel, sheet: string, id: string): IdRect => (chartsOf(m, sheet).get(id) as ChartSpec).data;

  it('widens when a row is inserted inside it, and does not when one is inserted above it', () => {
    const { a, sheet } = two();
    const spec = specOn(a, sheet);
    const id = a.setRule(sheet, 'charts', null, spec)!;
    a.insertRows(sheet, 3, 2);
    expect(rect(a, sheet, id)).toEqual(spec.data);
    expect(a.engine.sheet(sheet)!.rowIndex().get(spec.data.r2)).toBe(7);
    a.insertRows(sheet, 0, 1);
    expect(rect(a, sheet, id)).toEqual(spec.data);
    expect(a.engine.sheet(sheet)!.rowIndex().get(spec.data.r1)).toBe(1);
  });

  it('moves its corners off a deleted row, in the same step as the delete', () => {
    const { a, sheet } = two();
    const { rows } = ids(a, sheet);
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.deleteRows(sheet, 0, 1);
    expect(rect(a, sheet, id).r1).toBe(rows[1]);
    a.deleteRows(sheet, 4, 1);
    expect(rect(a, sheet, id).r2).toBe(rows[4]);
    // One undo undoes the delete and the move of its corner together.
    a.undo();
    expect(rect(a, sheet, id).r2).toBe(rows[5]);
  });

  it('is removed with the chart when every row of it is deleted, and undo brings both back', () => {
    const { a, sheet } = two();
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.deleteRows(sheet, 0, 6);
    expect(chartsOf(a, sheet).has(id)).toBe(false);
    a.undo();
    expect(chartsOf(a, sheet).has(id)).toBe(true);
  });

  it('follows a chart on another sheet that charts this one\'s data', () => {
    const { a, sheet } = two();
    const other = a.addSheet('Charts')!;
    const spec = specOn(a, sheet);
    const id = a.setRule(other, 'charts', null, spec)!;
    a.deleteCols(sheet, 0, 1);
    const data = (chartsOf(a, other).get(id) as ChartSpec).data;
    expect(data.c1).toBe(ids(a, sheet).cols[0]);
    expect(a.engine.sheet(sheet)!.colIndex().get(spec.data.c1)).toBeUndefined();
  });
});

describe('a chart\'s anchor follows its cell', () => {
  const anchor = (m: SheetModel, sheet: string, id: string) => (chartsOf(m, sheet).get(id) as ChartSpec).anchor;

  it('does not change when rows are inserted: the ids are the same', () => {
    const { a, sheet } = two();
    const spec = specOn(a, sheet);
    const id = a.setRule(sheet, 'charts', null, spec)!;
    a.insertRows(sheet, 0, 5);
    expect(anchor(a, sheet, id)).toEqual(spec.anchor);
  });

  it('moves to the row that took the deleted one\'s place, keeping its offset', () => {
    const { a, sheet } = two();
    const { rows, cols } = ids(a, sheet);
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.deleteRows(sheet, 8, 1);
    expect(anchor(a, sheet, id)).toEqual({ row: rows[9], col: cols[4], dx: 6, dy: 12 });
    // And by columns.
    a.deleteCols(sheet, 4, 2);
    expect(anchor(a, sheet, id).col).toBe(cols[6]);
    expect(a.engine.sheet(sheet)!.rowIndex().get(anchor(a, sheet, id).row)).toBe(8);
  });

  it('moves to the line after a block that was deleted, not the first line of the block', () => {
    const { a, sheet } = two();
    const { rows } = ids(a, sheet);
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.deleteRows(sheet, 6, 4);
    expect(anchor(a, sheet, id).row).toBe(rows[10]);
  });

  it('is not written at all by a delete elsewhere', () => {
    const { a, sheet } = two();
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    const before = chartsOf(a, sheet).get(id);
    a.deleteRows(sheet, 20, 3);
    a.deleteCols(sheet, 6, 1);
    expect(chartsOf(a, sheet).get(id)).toBe(before);
  });

  it('stays a dangling id when the delete reaches the end of the sheet: the renderer falls back to the data', () => {
    const { a, sheet } = two();
    const { rows } = ids(a, sheet);
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.deleteRows(sheet, 8, 22);
    expect(anchor(a, sheet, id).row).toBe(rows[8]);
    expect(a.engine.sheet(sheet)!.rowIndex().get(rows[8]!)).toBeUndefined();
  });

  it('is undone with the delete', () => {
    const { a, sheet } = two();
    const spec = specOn(a, sheet);
    const id = a.setRule(sheet, 'charts', null, spec)!;
    a.deleteRows(sheet, 8, 1);
    a.undo();
    expect(anchor(a, sheet, id)).toEqual(spec.anchor);
  });

  it('is moved the same way for the other person', () => {
    const { a, b, room: r, sheet } = two();
    const id = a.setRule(sheet, 'charts', null, specOn(a, sheet))!;
    a.deleteRows(sheet, 8, 1);
    r.flush();
    expect(anchor(b, sheet, id)).toEqual(anchor(a, sheet, id));
  });
});

describe('onDataChanged', () => {
  const watch = (m: SheetModel) => {
    const calls: (string[] | null)[] = [];
    const off = m.onDataChanged((s) => calls.push(s ? [...s] : null));
    return { calls, off };
  };

  it('names the sheet whose cell changed, once for a step', () => {
    const { a, sheet } = two();
    const w = watch(a);
    type(a, sheet, 'B1', '99');
    expect(w.calls).toEqual([[sheet]]);
  });

  it('names the sheet for a formula\'s result and for a remote edit', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'D1', '=B1*2');
    r.flush();
    const w = watch(b);
    type(a, sheet, 'B1', '7');
    r.flush();
    expect(w.calls.flat()).toContain(sheet);
    expect(b.view(sheet).cell(0, 3)?.value).toBe(14);
  });

  it('is told of a format, an insert, a hidden row and a rule on the sheet', () => {
    const { a, sheet } = two();
    const w = watch(a);
    a.setStyle(sheet, { r1: 0, c1: 1, r2: 0, c2: 1 }, { numFmt: '0.00' });
    a.insertRows(sheet, 2, 1);
    a.hide(sheet, 'row', 0, 0, true);
    a.setRule(sheet, 'charts', null, specOn(a, sheet));
    expect(w.calls.length).toBeGreaterThanOrEqual(4);
    expect(w.calls.flat().every((s) => s === null || s === sheet)).toBe(true);
  });

  it('is told of a format that is already in use, which is a cell and no new format', () => {
    const { a, sheet } = two();
    a.setStyle(sheet, { r1: 0, c1: 1, r2: 0, c2: 1 }, { numFmt: '0.00' });
    const w = watch(a);
    a.setStyle(sheet, { r1: 1, c1: 1, r2: 1, c2: 1 }, { numFmt: '0.00' });
    expect(w.calls).toEqual([[sheet]]);
  });

  it('is told of a sheet whose formula\'s result changed because a cell on another sheet did', () => {
    const { a, sheet } = two();
    const other = a.addSheet('Elsewhere')!;
    a.input(other, { row: 0, col: 0 }, `=Data!B1*2`);
    const w = watch(a);
    type(a, sheet, 'B1', '50');
    expect(a.view(other).cell(0, 0)?.value).toBe(100);
    expect(new Set(w.calls.flat())).toEqual(new Set([sheet, other]));
  });

  it('is told of every sheet when the change is not one sheet\'s', () => {
    const { a, sheet } = two();
    const w = watch(a);
    a.renameSheet(sheet, 'Renamed');
    expect(w.calls).toContainEqual(null);
  });

  it('is not told of a bump that changed no cell: a cursor, a role, a connection', () => {
    const { a, sheet } = two();
    const w = watch(a);
    type(a, sheet, 'B1', '1');
    w.calls.length = 0;
    a.setReadOnly(true);
    a.setReadOnly(false);
    a.select(sheet, { r1: 0, c1: 0, r2: 0, c2: 0 }, { row: 0, col: 0 });
    expect(w.calls).toEqual([]);
  });

  it('stops when asked, and is not told after the model is destroyed', () => {
    const { a, sheet } = two();
    const w = watch(a);
    w.off();
    type(a, sheet, 'B1', '5');
    expect(w.calls).toEqual([]);
    const v = watch(a);
    a.destroy();
    expect(v.calls).toEqual([]);
  });
});

describe('the parts a chart is stored in', () => {
  it('exist on every sheet from birth, so a chart never creates a map of its own', () => {
    const { a, sheet } = two();
    expect(part(sheetsOf(a.doc).get(sheet)!, 'charts')).toBeDefined();
    const added = a.addSheet('Second')!;
    expect(part(sheetsOf(a.doc).get(added)!, 'charts')).toBeDefined();
  });
});
