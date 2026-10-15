import { describe, expect, it } from 'vitest';
import type { TableElement } from '../../model/deck';
import type { SlideModel } from '../../model/model';
import { plainText } from '../../model/schema';
import { modelOf, testDeck, txt } from '../../model/testing';
import {
  canMerge,
  canSplit,
  deleteColumns,
  deleteRows,
  expandRange,
  insertColumns,
  insertRows,
  mergeCells,
  nextCell,
  ownerPos,
  rangeOf,
  resizeTable,
  setCellLook,
  splitCell,
  validateTable,
  type TableResult
} from './tableOps';

/** A table of `r` rows and `c` columns whose cell (i, j) says `i.j`. */
function tableDeck(r: number, c: number): SlideModel {
  const cols = Array.from({ length: c }, () => 100);
  const el: TableElement = {
    type: 'table',
    id: 't',
    x: 100,
    y: 100,
    w: 100 * c,
    h: 50 * r,
    cols,
    rows: Array.from({ length: r }, (_, i) => ({ h: 50, cells: Array.from({ length: c }, (_, j) => ({ text: txt(`${i}.${j}`) })) })),
    firstRow: true
  };
  return modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [el] }]));
}

const table = (m: SlideModel): TableElement => m.element('s1', 't') as TableElement;
const texts = (m: SlideModel): string[][] => table(m).rows.map((r) => r.cells.map((c) => plainText(c.text)));
const ok = (r: TableResult): void => expect(r).toMatchObject({ ok: true });
const clean = (m: SlideModel): void => expect(validateTable(table(m))).toEqual([]);

/** What undo must bring back: the table's own values and every cell's text. */
const snapshot = (m: SlideModel): string => JSON.stringify(table(m), (k, v: unknown) => (k === 'id' ? undefined : v));

describe('a table that is valid', () => {
  it('has a cell at every position and no covered cell without an owner', () => {
    const m = tableDeck(3, 3);
    expect(validateTable(table(m))).toEqual([]);
    const broken = { ...table(m), rows: table(m).rows.map((r, i) => (i === 1 ? { ...r, cells: r.cells.map((c, j) => (j === 1 ? { ...c, merged: true } : c)) } : r)) };
    expect(validateTable(broken).join()).toContain('covered by nothing');
    const wide = { ...table(m), rows: table(m).rows.map((r, i) => (i === 0 ? { ...r, cells: r.cells.map((c, j) => (j === 0 ? { ...c, colSpan: 2 } : c)) } : r)) };
    expect(validateTable(wide).join()).toContain('not covered');
    const short = { ...table(m), rows: [{ h: 50, cells: [{ text: txt('x') }] }] };
    expect(validateTable(short).join()).toContain('has 1 cells, not 3');
  });
});

describe('rows', () => {
  it('inserts one in one undo entry, with a cell in every column, and undo takes it away', () => {
    const m = tableDeck(3, 3);
    const before = snapshot(m);
    ok(insertRows(m, 's1', 't', 1));
    expect(table(m).rows).toHaveLength(4);
    expect(texts(m)[1]).toEqual(['', '', '']);
    expect(texts(m)[2]).toEqual(['1.0', '1.1', '1.2']);
    expect(table(m).h).toBe(200);
    clean(m);
    expect(m.undo()).toBe(true);
    expect(snapshot(m)).toBe(before);
    expect(m.canUndo()).toBe(false);
  });

  it('at either end, and several at once', () => {
    const m = tableDeck(2, 2);
    ok(insertRows(m, 's1', 't', 0));
    ok(insertRows(m, 's1', 't', 3, 2));
    expect(texts(m)).toEqual([['', ''], ['0.0', '0.1'], ['1.0', '1.1'], ['', ''], ['', '']]);
    clean(m);
  });

  it('inside a vertical merge grows the merge and covers the new cell', () => {
    const m = tableDeck(3, 3);
    ok(mergeCells(m, 's1', 't', rangeOf({ r: 0, c: 0 }, { r: 1, c: 0 })));
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ rowSpan: 2 });
    ok(insertRows(m, 's1', 't', 1));
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ rowSpan: 3 });
    expect(table(m).rows[1]!.cells[0]).toMatchObject({ merged: true });
    expect(table(m).rows[1]!.cells[1]!.merged).toBeUndefined();
    clean(m);
  });

  it('inside a block merge covers every column of it, and grows it once', () => {
    const m = tableDeck(3, 3);
    ok(mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 1, c2: 1 }));
    ok(insertRows(m, 's1', 't', 1));
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ rowSpan: 3, colSpan: 2 });
    expect(table(m).rows[1]!.cells.map((c) => !!c.merged)).toEqual([true, true, false]);
    clean(m);
  });

  it('deletes, and a merge that loses its first row hands itself to the row below', () => {
    const m = tableDeck(4, 3);
    ok(mergeCells(m, 's1', 't', { r1: 1, c1: 0, r2: 2, c2: 1 }));
    ok(deleteRows(m, 's1', 't', 1));
    expect(table(m).rows).toHaveLength(3);
    // The cell that was below the merge's top row is the merge now, one row and two columns.
    expect(table(m).rows[1]!.cells[0]).toMatchObject({ colSpan: 2 });
    expect(table(m).rows[1]!.cells[0]!.merged).toBeUndefined();
    expect(table(m).rows[1]!.cells[0]!.rowSpan).toBeUndefined();
    expect(table(m).rows[1]!.cells[1]).toMatchObject({ merged: true });
    clean(m);
  });

  it('deleting the last row of a merge shortens it', () => {
    const m = tableDeck(4, 2);
    ok(mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 2, c2: 0 }));
    ok(deleteRows(m, 's1', 't', 2));
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ rowSpan: 2 });
    clean(m);
    ok(deleteRows(m, 's1', 't', 0, 1));
    expect(table(m).rows).toHaveLength(1);
    expect(table(m).rows[0]!.cells[0]!.rowSpan).toBeUndefined();
    clean(m);
  });

  it('refuses to delete every row, and writes nothing', () => {
    const m = tableDeck(2, 2);
    const before = snapshot(m);
    expect(deleteRows(m, 's1', 't', 0, 1)).toEqual({ ok: false, message: 'A table needs at least one row.' });
    expect(snapshot(m)).toBe(before);
    expect(m.canUndo()).toBe(false);
  });

  it('keeps the table as tall as its rows', () => {
    const m = tableDeck(3, 2);
    ok(insertRows(m, 's1', 't', 3));
    expect(table(m).h).toBe(200);
    ok(deleteRows(m, 's1', 't', 0, 1));
    expect(table(m).h).toBe(100);
  });
});

describe('undo', () => {
  it('takes one structural step at a time, though they are made within the typing window', () => {
    const m = tableDeck(2, 2);
    ok(insertRows(m, 's1', 't', 0));
    ok(insertColumns(m, 's1', 't', 0));
    expect(table(m).cols).toHaveLength(3);
    m.undo();
    expect(table(m).cols).toHaveLength(2);
    expect(table(m).rows).toHaveLength(3);
    m.undo();
    expect(table(m).rows).toHaveLength(2);
  });
});

describe('columns', () => {
  it('inserts one in one undo entry, the table keeping its width', () => {
    const m = tableDeck(2, 3);
    const before = snapshot(m);
    ok(insertColumns(m, 's1', 't', 1));
    expect(texts(m)).toEqual([['0.0', '', '0.1', '0.2'], ['1.0', '', '1.1', '1.2']]);
    expect(table(m).cols).toHaveLength(4);
    expect(table(m).cols.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 1);
    expect(table(m).w).toBeCloseTo(300, 1);
    clean(m);
    m.undo();
    expect(snapshot(m)).toBe(before);
  });

  it('inside a horizontal merge grows the merge', () => {
    const m = tableDeck(2, 3);
    ok(mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 0, c2: 1 }));
    ok(insertColumns(m, 's1', 't', 1));
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ colSpan: 3 });
    expect(table(m).rows[0]!.cells[1]).toMatchObject({ merged: true });
    expect(table(m).rows[1]!.cells[1]!.merged).toBeUndefined();
    clean(m);
  });

  it('deletes, and a merge that loses its first column hands itself to the next', () => {
    const m = tableDeck(3, 4);
    ok(mergeCells(m, 's1', 't', { r1: 0, c1: 1, r2: 1, c2: 2 }));
    ok(deleteColumns(m, 's1', 't', 1));
    expect(table(m).cols).toHaveLength(3);
    expect(table(m).rows[0]!.cells[1]).toMatchObject({ rowSpan: 2 });
    expect(table(m).rows[0]!.cells[1]!.merged).toBeUndefined();
    expect(table(m).rows[0]!.cells[1]!.colSpan).toBeUndefined();
    expect(table(m).rows[1]!.cells[1]).toMatchObject({ merged: true });
    expect(table(m).cols.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 1);
    clean(m);
  });

  it('refuses to delete every column', () => {
    const m = tableDeck(2, 2);
    expect(deleteColumns(m, 's1', 't', 0, 1)).toEqual({ ok: false, message: 'A table needs at least one column.' });
  });
});

describe('merging and splitting', () => {
  it('makes the top-left cell the owner and gathers the text in reading order', () => {
    const m = tableDeck(3, 3);
    const res = mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(res).toEqual({ ok: true, range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
    const owner = table(m).rows[0]!.cells[0]!;
    expect(owner).toMatchObject({ rowSpan: 2, colSpan: 2 });
    expect(plainText(owner.text)).toBe('0.0\n0.1\n1.0\n1.1');
    for (const [r, c] of [[0, 1], [1, 0], [1, 1]] as const) {
      expect(table(m).rows[r]!.cells[c]).toMatchObject({ merged: true });
      expect(plainText(table(m).rows[r]!.cells[c]!.text)).toBe('');
    }
    clean(m);
  });

  it('is one undo entry, and undo gives every cell its text back', () => {
    const m = tableDeck(3, 3);
    const before = snapshot(m);
    mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 1, c2: 1 });
    m.undo();
    expect(snapshot(m)).toBe(before);
  });

  it('grows the range to hold every merge it touches whole', () => {
    const m = tableDeck(4, 4);
    mergeCells(m, 's1', 't', { r1: 1, c1: 1, r2: 2, c2: 2 });
    expect(expandRange(table(m), { r1: 0, c1: 0, r2: 1, c2: 1 })).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
    ok(mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 1, c2: 1 }));
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ rowSpan: 3, colSpan: 3 });
    clean(m);
  });

  it('says one cell is not enough, and writes nothing', () => {
    const m = tableDeck(2, 2);
    expect(canMerge(table(m), { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(false);
    expect(mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 0, c2: 0 })).toEqual({ ok: false, message: 'Choose more than one cell to merge.' });
    expect(m.canUndo()).toBe(false);
  });

  it('splits from any cell of the merge, leaving the owner its text', () => {
    const m = tableDeck(3, 3);
    mergeCells(m, 's1', 't', { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(canSplit(table(m), { r: 0, c: 1 })).toBe(true);
    expect(ownerPos(table(m), { r: 0, c: 1 })).toEqual({ r: 0, c: 0 });
    ok(splitCell(m, 's1', 't', { r: 0, c: 1 }));
    expect(table(m).rows[0]!.cells.map((c) => [c.merged, c.rowSpan, c.colSpan])).toEqual([[undefined, undefined, undefined], [undefined, undefined, undefined], [undefined, undefined, undefined]]);
    expect(plainText(table(m).rows[0]!.cells[0]!.text)).toBe('0.0\n0.1');
    clean(m);
    expect(splitCell(m, 's1', 't', { r: 0, c: 0 })).toEqual({ ok: false, message: 'That cell is not merged.' });
  });
});

describe('looks and size', () => {
  it('fills and anchors a range as one step, and null takes them away', () => {
    const m = tableDeck(2, 2);
    ok(setCellLook(m, 's1', 't', { r1: 0, c1: 0, r2: 1, c2: 0 }, { fill: { kind: 'solid', color: '#ff0000' }, anchor: 'middle' }));
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ fill: { kind: 'solid', color: '#ff0000' }, anchor: 'middle' });
    expect(table(m).rows[1]!.cells[0]).toMatchObject({ anchor: 'middle' });
    expect(table(m).rows[0]!.cells[1]!.fill).toBeUndefined();
    m.undo();
    expect(table(m).rows[0]!.cells[0]!.fill).toBeUndefined();
    ok(setCellLook(m, 's1', 't', { r1: 0, c1: 0, r2: 0, c2: 0 }, { anchor: 'top' }));
    ok(setCellLook(m, 's1', 't', { r1: 0, c1: 0, r2: 0, c2: 0 }, { anchor: null }));
    expect(table(m).rows[0]!.cells[0]!.anchor).toBeUndefined();
  });

  it('resizing scales its columns and rows with the frame, in one step', () => {
    const m = tableDeck(2, 2);
    ok(resizeTable(m, 's1', 't', 400, 50));
    expect(table(m)).toMatchObject({ w: 400, h: 50, cols: [200, 200] });
    expect(table(m).rows.map((r) => r.h)).toEqual([25, 25]);
    m.undo();
    expect(table(m)).toMatchObject({ w: 200, h: 100, cols: [100, 100] });
    expect(resizeTable(m, 's1', 't', 0, 10)).toMatchObject({ ok: false });
  });
});

describe('walking the cells', () => {
  it('moves in reading order past covered cells, and stops at either end', () => {
    const m = tableDeck(2, 3);
    mergeCells(m, 's1', 't', { r1: 0, c1: 1, r2: 0, c2: 2 });
    const t = table(m);
    expect(nextCell(t, { r: 0, c: 0 })).toEqual({ r: 0, c: 1 });
    expect(nextCell(t, { r: 0, c: 1 })).toEqual({ r: 1, c: 0 });
    expect(nextCell(t, { r: 1, c: 2 })).toBeNull();
    expect(nextCell(t, { r: 1, c: 0 }, true)).toEqual({ r: 0, c: 1 });
    expect(nextCell(t, { r: 0, c: 0 }, true)).toBeNull();
  });
});

describe('what a reader may not do', () => {
  it('is refused with a message and nothing is written', () => {
    const m = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ type: 'table', id: 't', x: 0, y: 0, w: 100, h: 50, cols: [100], rows: [{ h: 50, cells: [{ text: txt('a') }] }] }] }]), { readOnly: true });
    expect(insertRows(m, 's1', 't', 0)).toMatchObject({ ok: false });
    expect(table(m).rows).toHaveLength(1);
  });

  it('is refused past the cell limit', () => {
    const m = tableDeck(50, 50);
    expect(insertRows(m, 's1', 't', 0)).toMatchObject({ ok: false, message: expect.stringContaining('2,500') });
    expect(insertColumns(m, 's1', 't', 0)).toMatchObject({ ok: false });
  });
});

// ── a few hundred random steps ──────────────────────────────────────────────

/** A deterministic random source. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('any sequence of operations', () => {
  it.each([1, 2, 3, 4, 5, 6])('leaves the table valid and undoes all the way back (seed %i)', (seed) => {
    const rand = lcg(seed);
    const pick = (n: number): number => Math.floor(rand() * n);
    const m = tableDeck(4, 4);
    const start = snapshot(m);
    let steps = 0;
    for (let i = 0; i < 60; i++) {
      const t = table(m);
      const nr = t.rows.length;
      const nc = t.cols.length;
      let res: TableResult;
      switch (pick(6)) {
        case 0:
          res = insertRows(m, 's1', 't', pick(nr + 1));
          break;
        case 1:
          res = deleteRows(m, 's1', 't', pick(nr), pick(nr));
          break;
        case 2:
          res = insertColumns(m, 's1', 't', pick(nc + 1));
          break;
        case 3:
          res = deleteColumns(m, 's1', 't', pick(nc), pick(nc));
          break;
        case 4:
          res = mergeCells(m, 's1', 't', rangeOf({ r: pick(nr), c: pick(nc) }, { r: pick(nr), c: pick(nc) }));
          break;
        default:
          res = splitCell(m, 's1', 't', { r: pick(nr), c: pick(nc) });
      }
      if (res.ok) steps += 1;
      expect(validateTable(table(m)), `after step ${i}`).toEqual([]);
      // The table and every row keep the same number of cells.
      expect(table(m).rows.every((r) => r.cells.length === table(m).cols.length)).toBe(true);
    }
    expect(steps).toBeGreaterThan(10);
    // Each step was one entry: undoing them all is the table we began with.
    while (m.canUndo()) m.undo();
    expect(snapshot(m)).toBe(start);
  });
});
