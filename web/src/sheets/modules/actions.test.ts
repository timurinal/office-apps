// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GridSession } from '../grid';
import { SheetModel, applyIntent, buildSheetSeed, localSheetSource, type SheetSeedBuilder } from '../model';
import { estimateMeasure } from '../model/measure';
import type { Toast } from '../../core/ui';
import type { Rect } from '../grid/types';
import {
  autoSum,
  clearContents,
  deleteByKey,
  deleteCols,
  deleteRows,
  deleteSheet,
  freeze,
  frozenAs,
  insertByKey,
  insertCols,
  insertRows,
  insertSheet,
  type ActionContext
} from './actions';

/** A workbook on a local source, a session on its first sheet, and what the page would hand a command. */
async function setup(build?: (b: SheetSeedBuilder) => void) {
  const seed = buildSheetSeed(build);
  const model = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
  // The source's snapshot arrives on a microtask.
  await Promise.resolve();
  await Promise.resolve();
  let sheetId = model.sheets()[0]!.id;
  const session = new GridSession();
  const toasts: Toast[] = [];
  const ctx = {
    model,
    get sheetId() {
      return sheetId;
    },
    get data() {
      return model.view(sheetId);
    },
    session,
    selection: () => ({ rect: session.rect(), active: session.sel.active }),
    notify: (t: Toast) => toasts.push(t),
    get sheets() {
      return model.sheets();
    },
    showSheet: (id: string) => {
      sheetId = id;
    }
  };
  session.bind({
    get data() {
      return ctx.data;
    },
    onIntent: (i) => void applyIntent(model, sheetId, i),
    readOnly: () => false,
    layout: () => null,
    focusGrid: () => undefined
  });
  const text = (row: number, col: number) => ctx.data.cell(row, col)?.text ?? '';
  const edit = (row: number, col: number) => ctx.data.editText(row, col);
  const select = (r: Rect) => session.selectRect(r);
  return { model, ctx: ctx as ActionContext & typeof ctx, session, toasts, text, edit, select };
}

const rect = (r1: number, c1: number, r2 = r1, c2 = c1): Rect => ({ r1, r2, c1, c2 });

const numbers = (b: SheetSeedBuilder) => {
  const s = b.addSheet('Sheet1');
  s.cell(0, 0, { value: 10 }).cell(1, 0, { value: 20 }).cell(2, 0, { value: 30 });
  s.cell(0, 1, { value: 1 }).cell(1, 1, { value: 2 }).cell(2, 1, { value: 3 });
};

describe('inserting and deleting rows and columns', () => {
  it('inserts as many rows as are selected, above or below', async () => {
    const t = await setup(numbers);
    t.select(rect(1, 0, 2, 0));
    insertRows(t.ctx, 'above');
    // Two blank rows where row 2 was; its 20 is two rows lower.
    expect(t.ctx.data.rowCount()).toBe(1002);
    expect([t.text(1, 0), t.text(2, 0), t.text(3, 0)]).toEqual(['', '', '20']);

    t.select(rect(0, 0));
    insertRows(t.ctx, 'below');
    expect([t.text(0, 0), t.text(1, 0), t.text(2, 0)]).toEqual(['10', '', '']);
  });

  it('inserts columns left and right, as many as are selected', async () => {
    const t = await setup(numbers);
    t.select(rect(0, 0, 0, 1));
    insertCols(t.ctx, 'left');
    expect(t.ctx.data.colCount()).toBe(28);
    expect([t.text(0, 0), t.text(0, 1), t.text(0, 2), t.text(0, 3)]).toEqual(['', '', '10', '1']);
    t.select(rect(0, 2));
    insertCols(t.ctx, 'right');
    expect([t.text(0, 2), t.text(0, 3), t.text(0, 4)]).toEqual(['10', '', '1']);
  });

  it('deletes the selected rows and columns, each as one step', async () => {
    const t = await setup(numbers);
    t.select(rect(0, 0, 1, 0));
    deleteRows(t.ctx);
    expect(t.text(0, 0)).toBe('30');
    expect(t.ctx.data.rowCount()).toBe(998);
    t.model.undo();
    expect([t.text(0, 0), t.text(1, 0), t.text(2, 0)]).toEqual(['10', '20', '30']);

    t.select(rect(0, 0, 0, 0));
    deleteCols(t.ctx);
    expect(t.text(0, 0)).toBe('1');
  });

  it('keeps a formula right through an insert above its range', async () => {
    const t = await setup((b) => {
      numbers(b);
      b.sheets[0]!.cell(3, 0, { formula: 'SUM(A1:A3)' });
    });
    expect(t.text(3, 0)).toBe('60');
    t.select(rect(0, 0));
    insertRows(t.ctx, 'above');
    expect(t.text(4, 0)).toBe('60');
    expect(t.edit(4, 0)).toBe('=SUM(A2:A4)');
  });
});

describe('the keys for insert and delete', () => {
  it('act on whole rows and whole columns, and on nothing else, so the browser keeps its zoom', async () => {
    const t = await setup(numbers);
    t.select(rect(1, 1));
    expect(insertByKey(t.ctx)).toBe(false);
    expect(deleteByKey(t.ctx)).toBe(false);
    expect(t.ctx.data.rowCount()).toBe(1000);

    // A whole row: every column of row 2.
    t.select(rect(1, 0, 1, t.ctx.data.colCount() - 1));
    expect(insertByKey(t.ctx)).toBe(true);
    expect(t.ctx.data.rowCount()).toBe(1001);
    expect(deleteByKey(t.ctx)).toBe(true);
    expect(t.ctx.data.rowCount()).toBe(1000);

    // A whole column: every row of column B.
    t.select(rect(0, 1, t.ctx.data.rowCount() - 1, 1));
    expect(insertByKey(t.ctx)).toBe(true);
    expect(t.ctx.data.colCount()).toBe(27);
    expect(deleteByKey(t.ctx)).toBe(true);
    expect(t.ctx.data.colCount()).toBe(26);
  });
});

describe('sheets', () => {
  it('inserts a sheet after the active one and shows it', async () => {
    const t = await setup((b) => {
      b.addSheet('One');
      b.addSheet('Two');
    });
    const first = t.model.sheets()[0]!.id;
    insertSheet(t.ctx);
    const names = t.model.sheets().map((s) => s.name);
    expect(names).toHaveLength(3);
    expect(names[0]).toBe('One');
    expect(names[2]).toBe('Two');
    expect(t.ctx.sheetId).not.toBe(first);
    expect(t.model.sheets()[1]!.id).toBe(t.ctx.sheetId);
  });

  it('deletes a sheet, offers the Undo, and shows its neighbour', async () => {
    const t = await setup((b) => {
      b.addSheet('One');
      b.addSheet('Two').cell(0, 0, { value: 'kept' });
      b.addSheet('Three');
    });
    const [one, two] = t.model.sheets();
    t.ctx.showSheet(one!.id);
    deleteSheet(t.ctx);
    expect(t.model.sheets().map((s) => s.name)).toEqual(['Two', 'Three']);
    // The sheet that took its place is the one after it.
    expect(t.ctx.sheetId).toBe(two!.id);
    expect(t.toasts[0]!.text).toBe('Deleted “One”.');

    t.toasts[0]!.action!.run();
    expect(t.model.sheets().map((s) => s.name)).toEqual(['One', 'Two', 'Three']);
  });

  it('keeps the last visible sheet, and says nothing of its own', async () => {
    const t = await setup((b) => b.addSheet('Only'));
    deleteSheet(t.ctx);
    expect(t.model.sheets()).toHaveLength(1);
    expect(t.toasts).toHaveLength(0);
  });
});

describe('clearing', () => {
  it('empties the selection and keeps it one undo away', async () => {
    const t = await setup(numbers);
    t.select(rect(0, 0, 2, 1));
    clearContents(t.ctx);
    expect([t.text(0, 0), t.text(2, 1)]).toEqual(['', '']);
    t.model.undo();
    expect([t.text(0, 0), t.text(2, 1)]).toEqual(['10', '3']);
  });
});

describe('AutoSum', () => {
  it('adds up the numbers directly above a cell', async () => {
    const t = await setup(numbers);
    t.select(rect(3, 0));
    autoSum(t.ctx, 'SUM');
    expect(t.edit(3, 0)).toBe('=SUM(A1:A3)');
    expect(t.text(3, 0)).toBe('60');
  });

  it('stops at the first cell that is not a number', async () => {
    const t = await setup((b) => {
      const s = b.addSheet('Sheet1');
      s.cell(0, 0, { value: 100 }).cell(1, 0, { value: 'Q1' }).cell(2, 0, { value: 5 }).cell(3, 0, { value: 6 });
    });
    t.select(rect(4, 0));
    autoSum(t.ctx, 'AVERAGE');
    expect(t.edit(4, 0)).toBe('=AVERAGE(A3:A4)');
    expect(t.text(4, 0)).toBe('5.5');
  });

  it('looks to the left when there is nothing above', async () => {
    const t = await setup(numbers);
    t.select(rect(0, 2));
    autoSum(t.ctx, 'MAX');
    expect(t.edit(0, 2)).toBe('=MAX(A1:B1)');
    expect(t.text(0, 2)).toBe('10');
  });

  it('prefers the column above to the row beside, as Excel does', async () => {
    const t = await setup((b) => {
      numbers(b);
      b.sheets[0]!.cell(3, 0, { value: 100 });
    });
    t.select(rect(3, 1));
    autoSum(t.ctx, 'SUM');
    expect(t.edit(3, 1)).toBe('=SUM(B1:B3)');
  });

  it('opens an edit of the function when there is nothing to add', async () => {
    const t = await setup(numbers);
    t.select(rect(8, 5));
    autoSum(t.ctx, 'SUM');
    expect(t.session.edit?.text).toBe('=SUM(');
    expect(t.text(8, 5)).toBe('');
  });

  it('totals a column of selected cells below it, and a row to its right', async () => {
    const t = await setup(numbers);
    t.select(rect(0, 0, 2, 0));
    autoSum(t.ctx, 'SUM');
    expect(t.edit(3, 0)).toBe('=SUM(A1:A3)');

    t.select(rect(0, 0, 0, 1));
    autoSum(t.ctx, 'COUNT');
    expect(t.edit(0, 2)).toBe('=COUNT(A1:B1)');
    expect(t.text(0, 2)).toBe('2');
  });

  it('totals each column of a block under it, as one step', async () => {
    const t = await setup(numbers);
    t.select(rect(0, 0, 2, 1));
    autoSum(t.ctx, 'SUM');
    expect([t.text(3, 0), t.text(3, 1)]).toEqual(['60', '6']);
    expect([t.edit(3, 0), t.edit(3, 1)]).toEqual(['=SUM(A1:A3)', '=SUM(B1:B3)']);
    t.model.undo();
    expect([t.text(3, 0), t.text(3, 1)]).toEqual(['', '']);
  });
});

describe('freezing', () => {
  it('freezes the top row, the first column, or what is above and left of the selection', async () => {
    const t = await setup(numbers);
    expect(frozenAs(t.ctx)).toBe('none');
    freeze(t.ctx, 'row');
    expect(t.ctx.data.frozen()).toEqual({ rows: 1, cols: 0 });
    expect(frozenAs(t.ctx)).toBe('row');
    freeze(t.ctx, 'column');
    expect(t.ctx.data.frozen()).toEqual({ rows: 0, cols: 1 });
    expect(frozenAs(t.ctx)).toBe('column');

    t.select(rect(3, 2));
    freeze(t.ctx, 'selection');
    expect(t.ctx.data.frozen()).toEqual({ rows: 3, cols: 2 });
    expect(frozenAs(t.ctx)).toBe('selection');

    freeze(t.ctx, 'none');
    expect(t.ctx.data.frozen()).toEqual({ rows: 0, cols: 0 });
  });

  it('says so when there is nothing above or left of the selection', async () => {
    const t = await setup(numbers);
    t.select(rect(0, 0));
    freeze(t.ctx, 'selection');
    expect(t.ctx.data.frozen()).toEqual({ rows: 0, cols: 0 });
    expect(t.toasts).toHaveLength(1);
  });
});
