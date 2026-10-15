/** Each kind of step: what it does, that it is one undo, and that the other person sees it. */

import { describe, expect, it } from 'vitest';
import { SheetModel, type ModelNotice } from '../model';
import { applyIntent } from '../adapter';
import { at, edit, grid, room, text, type } from './helpers';

const two = (build?: Parameters<typeof room>[0]) => {
  const r = room(build);
  return { ...r, a: r.people[0]!.model, b: r.people[1]!.model };
};

const notices = (m: SheetModel) => {
  const out: ModelNotice[] = [];
  m.onNotice((n) => out.push(n));
  return out;
};

describe('typing', () => {
  it('reads a number with its format, and keeps a cell format that already says one', () => {
    const { a, sheet } = two();
    type(a, sheet, 'A1', '12%');
    expect(text(a, sheet, 'A1')).toBe('12%');
    expect(a.view(sheet).cell(0, 0)?.value).toBeCloseTo(0.12);
    a.setStyle(sheet, { r1: 1, c1: 0, r2: 1, c2: 0 }, { numFmt: '0.000' });
    type(a, sheet, 'A2', '1.5');
    expect(text(a, sheet, 'A2')).toBe('1.500');
    type(a, sheet, 'A3', "'=not a formula");
    expect(text(a, sheet, 'A3')).toBe('=not a formula');
    expect(edit(a, sheet, 'A3')).toBe("'=not a formula");
  });

  it('refuses a formula that does not read, with where', () => {
    const { a, sheet } = two();
    const seen = notices(a);
    expect(type(a, sheet, 'A1', '=SUM(1,')).toBe(false);
    expect(seen[0]?.kind).toBe('formula');
    expect(a.canUndo()).toBe(false);
  });

  it('grows the sheet for a cell past its edge, and for a reference past it', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'AD1500', 'far');
    expect(a.view(sheet).rowCount()).toBe(1500);
    expect(a.view(sheet).colCount()).toBe(30);
    type(a, sheet, 'A1', '=A3000');
    expect(a.view(sheet).rowCount()).toBe(3000);
    r.flush();
    expect(b.view(sheet).rowCount()).toBe(3000);
    expect(text(b, sheet, 'AD1500')).toBe('far');
    a.undo();
    a.undo();
    r.flush();
    expect(b.view(sheet).rowCount()).toBe(1000);
  });

  it('a strict validation refuses what it does not allow', () => {
    const { a, sheet } = two();
    a.setRule(sheet, 'validation', null, {
      ranges: [{ r1: a.engine.sheet(sheet)!.rowOrder[0]!, c1: a.engine.sheet(sheet)!.colOrder[0]!, r2: a.engine.sheet(sheet)!.rowOrder[9]!, c2: a.engine.sheet(sheet)!.colOrder[0]! }],
      check: { kind: 'list', items: ['Yes', 'No'] },
      strict: true
    });
    const seen = notices(a);
    expect(type(a, sheet, 'A2', 'Maybe')).toBe(false);
    expect(seen[0]?.kind).toBe('validation');
    expect(type(a, sheet, 'A2', 'Yes')).toBe(true);
    expect(a.view(sheet).listChoices(1, 0)).toEqual(['Yes', 'No']);
  });

  it('is refused for a viewer, with a notice', () => {
    const { a, sheet } = two();
    a.setReadOnly(true);
    const seen = notices(a);
    expect(type(a, sheet, 'A1', 'x')).toBe(false);
    expect(seen.map((n) => n.kind)).toEqual(['read-only']);
    expect(a.view(sheet).readOnly()).toBe(true);
  });
});

describe('clear', () => {
  it('takes the contents and leaves the formats', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'B2', '5');
    a.setStyle(sheet, { r1: 1, c1: 1, r2: 1, c2: 1 }, { bold: true });
    a.clear(sheet, { r1: 0, c1: 0, r2: 5, c2: 5 });
    r.flush();
    for (const m of [a, b]) {
      expect(text(m, sheet, 'B2')).toBe('');
      expect(m.view(sheet).cell(1, 1)?.style.bold).toBe(true);
    }
    expect(a.status().cells).toBe(1);
  });
});

describe('fill', () => {
  it('continues a run of numbers, and copies a formula as a formula', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', '1');
    type(a, sheet, 'A2', '3');
    type(a, sheet, 'B1', '=A1*10');
    a.setStyle(sheet, { r1: 0, c1: 1, r2: 0, c2: 1 }, { italic: true });
    a.fill(sheet, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
    a.fill(sheet, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 4, c2: 1 });
    r.flush();
    expect(grid(b, sheet, 5, 2)).toEqual([
      ['1', '10'],
      ['3', '30'],
      ['5', '50'],
      ['7', '70'],
      ['9', '90']
    ]);
    expect(edit(b, sheet, 'B5')).toBe('=A5*10');
    expect(b.view(sheet).cell(4, 1)?.style.italic).toBe(true);
  });

  it('counts a date on by days', () => {
    const { a, sheet } = two();
    type(a, sheet, 'A1', '30/01/2024');
    a.fill(sheet, { r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 });
    expect(text(a, sheet, 'A3')).toBe('01/02/2024');
  });
});

describe('sort', () => {
  it('as Excel: numbers, then text, then blanks; formats and same-row formulas go with the values', () => {
    const { a, b, room: r, sheet } = two((bld) => {
      const s = bld.addSheet('Sheet1');
      s.cell(0, 0, { value: 'Name' }).cell(0, 1, { value: 'Score' });
      const rows: [string, number | string | null][] = [
        ['b', 3],
        ['a', 10],
        ['c', null],
        ['d', 'x'],
        ['e', 1]
      ];
      rows.forEach(([n, v], i) => {
        s.cell(i + 1, 0, { value: n });
        if (v !== null) s.cell(i + 1, 1, { value: v });
        s.cell(i + 1, 2, { formula: `B${i + 2}&"!"` });
      });
      s.cell(2, 1, { value: 10, style: { bold: true } });
    });
    a.sort(sheet, { r1: 0, c1: 0, r2: 5, c2: 2 }, [{ col: 1, descending: false }], { header: true });
    r.flush();
    for (const m of [a, b]) {
      expect(grid(m, sheet, 6, 3)).toEqual([
        ['Name', 'Score', ''],
        ['e', '1', '1!'],
        ['b', '3', '3!'],
        ['a', '10', '10!'],
        ['d', 'x', 'x!'],
        ['c', '', '!']
      ]);
      expect(m.view(sheet).cell(3, 1)?.style.bold).toBe(true);
      expect(m.view(sheet).cell(1, 1)?.style.bold).toBeFalsy();
    }
    a.undo();
    r.flush();
    expect(grid(b, sheet, 3, 2)).toEqual([
      ['Name', 'Score'],
      ['b', '3'],
      ['a', '10']
    ]);
  });

  it('refuses a range with merged cells in it', () => {
    const { a, sheet } = two();
    a.merge(sheet, { r1: 1, c1: 0, r2: 2, c2: 0 });
    const seen = notices(a);
    a.sort(sheet, { r1: 0, c1: 0, r2: 5, c2: 1 }, [{ col: 0, descending: false }]);
    expect(seen[0]?.kind).toBe('refused');
  });
});

describe('rows and columns', () => {
  it('insert, undo and redo bring back the same lines, and a cell typed in one', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', 'top');
    a.insertRows(sheet, 0, 2);
    type(a, sheet, 'A1', 'new');
    const inserted = a.engine.sheet(sheet)!.rowOrder[0];
    r.flush();
    expect(text(b, sheet, 'A3')).toBe('top');
    a.undo();
    a.undo();
    r.flush();
    expect(text(b, sheet, 'A1')).toBe('top');
    expect(b.view(sheet).rowCount()).toBe(1000);
    a.redo();
    a.redo();
    r.flush();
    expect(b.engine.sheet(sheet)!.rowOrder[0]).toBe(inserted);
    expect(text(b, sheet, 'A1')).toBe('new');
    expect(text(b, sheet, 'A3')).toBe('top');
  });

  it('a new edit drops the redo', () => {
    const { a, sheet } = two();
    type(a, sheet, 'A1', '1');
    a.undo();
    expect(a.canRedo()).toBe(true);
    type(a, sheet, 'A2', '2');
    expect(a.canRedo()).toBe(false);
  });

  it('deleting columns moves a range end off them and keeps the rest', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', '1');
    type(a, sheet, 'B1', '2');
    type(a, sheet, 'C1', '3');
    type(a, sheet, 'A2', '=SUM(A1:C1)');
    a.deleteCols(sheet, 2, 1);
    r.flush();
    expect(edit(b, sheet, 'A2')).toBe('=SUM(A1:B1)');
    expect(text(b, sheet, 'A2')).toBe('3');
  });

  it('refuses deleting every row', () => {
    const { a, sheet } = two();
    const seen = notices(a);
    a.deleteRows(sheet, 0, 1000);
    expect(seen[0]?.kind).toBe('refused');
    expect(a.view(sheet).rowCount()).toBe(1000);
  });

  it('moves columns with their cells, formats and formulas', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', 'a');
    type(a, sheet, 'B1', 'b');
    type(a, sheet, 'C1', '=A1&B1');
    a.move(sheet, 'col', 0, 2, 1);
    r.flush();
    expect(grid(b, sheet, 1, 3)).toEqual([['b', 'ab', 'a']]);
    expect(edit(b, sheet, 'B1')).toBe('=C1&A1');
  });

  it('resize, hide and autofit write sizes; the default size is no entry', () => {
    const { a, b, room: r, sheet } = two();
    a.resize(sheet, 'col', 0, 1, 200);
    a.hide(sheet, 'row', 2, 3, true);
    type(a, sheet, 'C1', 'A rather long piece of text for one column');
    a.autofit(sheet, 'col', 2, 2);
    r.flush();
    const v = b.view(sheet);
    expect([v.colWidth(0), v.colWidth(1)]).toEqual([200, 200]);
    expect([v.rowHeight(1), v.rowHeight(2), v.rowHeight(3), v.rowHeight(4)]).toEqual([26, 0, 0, 26]);
    expect(v.colWidth(2)).toBeGreaterThan(200);
    a.resize(sheet, 'col', 0, 0, 112);
    r.flush();
    expect(v.colWidth(0)).toBe(112);
  });

  it('freeze and merge', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', 'kept');
    type(a, sheet, 'B2', 'gone');
    a.freeze(sheet, 2, 1);
    a.merge(sheet, { r1: 0, c1: 0, r2: 1, c2: 1 });
    r.flush();
    expect(b.view(sheet).frozen()).toEqual({ rows: 2, cols: 1 });
    expect(b.view(sheet).merges()).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
    expect(text(b, sheet, 'B2')).toBe('');
    a.insertRows(sheet, 1, 1);
    r.flush();
    expect(b.view(sheet).merges()).toEqual([{ r1: 0, c1: 0, r2: 2, c2: 1 }]);
    a.unmerge(sheet, { r1: 0, c1: 0, r2: 0, c2: 0 });
    r.flush();
    expect(b.view(sheet).merges()).toEqual([]);
  });

  it('a delete that takes a merge corner shrinks the merge', () => {
    const { a, b, room: r, sheet } = two();
    a.merge(sheet, { r1: 2, c1: 0, r2: 5, c2: 1 });
    a.deleteRows(sheet, 4, 3);
    r.flush();
    expect(b.view(sheet).merges()).toEqual([{ r1: 2, c1: 0, r2: 3, c2: 1 }]);
  });
});

describe('formats', () => {
  it('a whole column takes the format as its own, reaching cells typed later', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'B2', 'own');
    a.setStyle(sheet, { r1: 1, c1: 1, r2: 1, c2: 1 }, { italic: true });
    a.setStyle(sheet, { r1: 0, c1: 1, r2: 999, c2: 1 }, { bold: true });
    type(a, sheet, 'B500', 'later');
    r.flush();
    for (const m of [a, b]) {
      expect(m.view(sheet).cell(499, 1)?.style.bold).toBe(true);
      expect(m.view(sheet).cell(1, 1)?.style).toMatchObject({ bold: true, italic: true });
      expect(m.view(sheet).cell(1, 2)?.style.bold).toBeFalsy();
    }
    a.clearFormats(sheet, { r1: 2, c1: 1, r2: 2, c2: 1 });
    r.flush();
    expect(b.view(sheet).cell(2, 1)?.style.bold).toBeFalsy();
    expect(b.view(sheet).cell(3, 1)?.style.bold).toBe(true);
    a.undo();
    a.undo();
    a.undo();
    r.flush();
    expect(b.view(sheet).cell(499, 1)?.style.bold).toBeFalsy();
    expect(b.view(sheet).cell(1, 1)?.style.italic).toBe(true);
  });

  it('a whole row', () => {
    const { a, sheet } = two();
    a.setStyle(sheet, { r1: 3, c1: 0, r2: 3, c2: 25 }, { fill: '#ffeeaa' });
    expect(a.view(sheet).cell(3, 20)?.style.fill).toBe('#ffeeaa');
    a.clearFormats(sheet, { r1: 3, c1: 0, r2: 3, c2: 25 });
    expect(a.view(sheet).cell(3, 20)?.style.fill).toBeUndefined();
  });
});

describe('names', () => {
  it('a name defined by one person is read in the other person\'s formula', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', '4');
    expect(a.setName('Rate', '=Sheet1!$A$1')).toBe(true);
    r.flush();
    type(b, sheet, 'B1', '=Rate*2');
    r.flush();
    expect(text(a, sheet, 'B1')).toBe('8');
    expect(b.view(sheet).completions('Ra')[0]).toMatchObject({ label: 'Rate', kind: 'name' });
    a.removeName('Rate');
    r.flush();
    expect(text(b, sheet, 'B1')).toBe('#NAME?');
  });
});

describe('rules', () => {
  it('a conditional format colours the cells that meet it, and moves with them', () => {
    const { a, b, room: r, sheet } = two();
    const sh = a.engine.sheet(sheet)!;
    type(a, sheet, 'A1', '5');
    type(a, sheet, 'A2', '50');
    a.setRule(sheet, 'cf', null, {
      ranges: [{ r1: sh.rowOrder[0]!, c1: sh.colOrder[0]!, r2: sh.rowOrder[9]!, c2: sh.colOrder[0]! }],
      priority: 1,
      when: { kind: 'cell', op: 'gt', a: 10 },
      style: { fill: '#ff0000' }
    });
    r.flush();
    expect(b.view(sheet).cell(0, 0)?.conditional).toBeUndefined();
    expect(b.view(sheet).cell(1, 0)?.conditional?.fill).toBe('#ff0000');
    type(b, sheet, 'A1', '11');
    expect(b.view(sheet).cell(0, 0)?.conditional?.fill).toBe('#ff0000');
  });

  it('a filter hides the rows it does not show', () => {
    const { a, b, room: r, sheet } = two();
    ['Fruit', 'apple', 'pear', 'apple'].forEach((v, i) => type(a, sheet, `A${i + 1}`, v));
    a.setFilter(sheet, { r1: 0, c1: 0, r2: 3, c2: 0 });
    a.setFilterCriterion(sheet, 0, { kind: 'values', hidden: ['pear'] });
    r.flush();
    expect(b.view(sheet).filter()).toMatchObject({ headerRow: 0, cols: [0], active: [0] });
    expect([1, 2, 3].map((i) => b.view(sheet).rowHeight(i))).toEqual([26, 0, 26]);
  });
});

describe('the grid\'s intents', () => {
  it('go to the steps, and the filter button is the editor\'s', () => {
    const { a, sheet } = two();
    expect(applyIntent(a, sheet, { type: 'input', at: at('C3'), text: '7' })).toBe(true);
    expect(text(a, sheet, 'C3')).toBe('7');
    expect(applyIntent(a, sheet, { type: 'clear', rect: { r1: 2, c1: 2, r2: 2, c2: 2 } })).toBe(true);
    expect(text(a, sheet, 'C3')).toBe('');
    expect(applyIntent(a, sheet, { type: 'filterMenu', col: 0 })).toBe(false);
  });
});

describe('status', () => {
  it('counts cells as the room does and says when a step waits', () => {
    const { a, room: r, sheet } = two();
    type(a, sheet, 'A1', 'x');
    expect(a.status()).toMatchObject({ save: 'saving', pending: 1, cells: 1, loaded: true, connection: 'connected' });
    r.flush();
    expect(a.status()).toMatchObject({ save: 'saved', pending: 0 });
    a.deleteRows(sheet, 0, 1);
    // An orphan still counts.
    expect(a.status().cells).toBe(1);
    expect(a.status().cellBytes).toBeGreaterThan(0);
    expect(a.status().structureBytes).toBeGreaterThan(1000);
  });
});
