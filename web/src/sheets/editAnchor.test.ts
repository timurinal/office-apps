import { describe, expect, it } from 'vitest';
import { SheetModel, buildSheetSeed, localSheetSource } from './model';
import { estimateMeasure } from './model/measure';
import { anchorAt, followAnchor } from './editAnchor';

async function open() {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Sheet1');
    for (let r = 0; r < 4; r++) s.cell(r, 0, { value: `row ${r + 1}` });
  });
  const model = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
  await Promise.resolve();
  await Promise.resolve();
  return { model, sheet: model.sheets()[0]!.id };
}

const input = (row: number, col = 0) => ({ type: 'input' as const, at: { row, col }, text: 'typed' });

describe('an edit stays with its cell', () => {
  it('moves with the cell when a row is inserted above it', async () => {
    const { model, sheet } = await open();
    const anchor = anchorAt(model.engine, sheet, { row: 1, col: 0 });
    model.insertRows(sheet, 0, 1);
    expect(followAnchor(model.engine, anchor, sheet, input(1))).toEqual(input(2));
    // And through two inserts, and one below it that changes nothing.
    model.insertRows(sheet, 1, 2);
    model.insertRows(sheet, 20, 1);
    expect(followAnchor(model.engine, anchor, sheet, input(1))).toEqual(input(4));
  });

  it('moves with the cell when a column is inserted left of it', async () => {
    const { model, sheet } = await open();
    const anchor = anchorAt(model.engine, sheet, { row: 0, col: 0 });
    model.insertCols(sheet, 0, 3);
    expect(followAnchor(model.engine, anchor, sheet, input(0, 0))).toEqual(input(0, 3));
  });

  it('follows the cell up when a row above it is deleted', async () => {
    const { model, sheet } = await open();
    const anchor = anchorAt(model.engine, sheet, { row: 3, col: 0 });
    model.deleteRows(sheet, 0, 2);
    expect(followAnchor(model.engine, anchor, sheet, input(3))).toEqual(input(1));
  });

  it('drops the edit when its row was deleted, because the cell it was for is gone', async () => {
    const { model, sheet } = await open();
    const anchor = anchorAt(model.engine, sheet, { row: 2, col: 0 });
    model.deleteRows(sheet, 2, 1);
    expect(followAnchor(model.engine, anchor, sheet, input(2))).toBeNull();
  });

  it('leaves alone what it was not told about: another cell, another sheet, another kind of intent, no anchor', async () => {
    const { model, sheet } = await open();
    const anchor = anchorAt(model.engine, sheet, { row: 1, col: 0 });
    model.insertRows(sheet, 0, 1);
    const elsewhere = input(5);
    expect(followAnchor(model.engine, anchor, sheet, elsewhere)).toBe(elsewhere);
    expect(followAnchor(model.engine, anchor, 'other', input(1))).toEqual(input(1));
    const clear = { type: 'clear' as const, rect: { r1: 1, r2: 1, c1: 0, c2: 0 } };
    expect(followAnchor(model.engine, anchor, sheet, clear)).toBe(clear);
    expect(followAnchor(model.engine, null, sheet, input(1))).toEqual(input(1));
  });

  it('has no anchor for a position that is not on the sheet', async () => {
    const { model, sheet } = await open();
    expect(anchorAt(model.engine, sheet, { row: 99_999, col: 0 })).toBeNull();
    expect(anchorAt(model.engine, 'nope', { row: 0, col: 0 })).toBeNull();
  });
});
