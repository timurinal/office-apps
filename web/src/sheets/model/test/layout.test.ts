import { describe, expect, it } from 'vitest';
import { SheetModel } from '../model';
import { estimateMeasure } from '../measure';
import { buildSheetSeed } from '../seed';
import { localSheetSource } from '../source';

/** A workbook on a local source, with its snapshot in. */
async function open() {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Data');
    for (let r = 0; r < 6; r++) s.cell(r, 0, { value: r });
  });
  const model = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
  await Promise.resolve();
  await Promise.resolve();
  const sheet = model.sheets()[0]!.id;
  return { model, sheet, view: model.view(sheet) };
}

describe('layoutVersion', () => {
  it('does not move for a cell, or for a change that is not the sheet\'s (a cursor, a mode)', async () => {
    const { model, sheet, view } = await open();
    const at = view.layoutVersion;
    const v = view.version;
    model.input(sheet, { row: 1, col: 1 }, 'x');
    model.input(sheet, { row: 2, col: 0 }, '=A1+1');
    // Anything that bumps the model without touching a size: the room's other people do it all the time.
    model.setReadOnly(true);
    model.setReadOnly(false);
    expect(view.version).toBeGreaterThan(v);
    expect(view.layoutVersion).toBe(at);
  });

  it('moves for a size, a hidden line, the frozen panes and a merge', async () => {
    const { model, sheet, view } = await open();
    const seen = new Set([view.layoutVersion]);
    const next = (what: string) => {
      const n = view.layoutVersion;
      expect(seen.has(n), `${what} to move it`).toBe(false);
      seen.add(n);
    };
    model.resize(sheet, 'col', 0, 0, 200);
    next('a column width');
    model.resize(sheet, 'row', 1, 1, 60);
    next('a row height');
    model.hide(sheet, 'row', 3, 3, true);
    next('a hidden row');
    model.freeze(sheet, 1, 1);
    next('the frozen panes');
    model.merge(sheet, { r1: 0, r2: 1, c1: 2, c2: 3 });
    next('a merge');
    expect(view.rowHeight(1)).toBe(60);
    expect(view.rowHeight(3)).toBe(0);
    expect(view.colWidth(0)).toBe(200);
  });

  it('follows every change while a filter is on, because a value can hide a row', async () => {
    const { model, sheet, view } = await open();
    model.setFilter(sheet, { r1: 0, r2: 5, c1: 0, c2: 0 });
    model.setFilterCriterion(sheet, 0, { kind: 'values', hidden: ['3'] });
    const at = view.layoutVersion;
    model.input(sheet, { row: 4, col: 0 }, '9');
    expect(view.layoutVersion).not.toBe(at);
  });

  it('answers a row\'s height without asking the document again, for a hundred thousand rows', async () => {
    const { view } = await open();
    view.rowHeight(0);
    let asks = 0;
    const map = (view as unknown as { map: () => unknown }).map.bind(view);
    (view as unknown as { map: () => unknown }).map = () => (asks++, map());
    for (let r = 0; r < 100_000; r++) view.rowHeight(r);
    // One version, one question: not one for each row.
    expect(asks).toBeLessThanOrEqual(1);
  });
});
