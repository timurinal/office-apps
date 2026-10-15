/** Sheets as tabs: add, rename, move, colour, hide, duplicate, remove, and the undo of a remove. */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { SheetModel, ModelNotice } from '../model';
import { sheetsOf } from '../structure';
import { edit, grid, room, text, type } from './helpers';

const two = (build?: Parameters<typeof room>[0]) => {
  const r = room(build);
  return { ...r, a: r.people[0]!.model, b: r.people[1]!.model };
};

const names = (m: SheetModel) => m.sheets().map((s) => s.name);

describe('tabs', () => {
  it('add, rename, move, colour and hide reach the other person', () => {
    const { a, b, room: r } = two();
    const s2 = a.addSheet()!;
    const s3 = a.addSheet('Totals')!;
    a.renameSheet(s2, 'Costs');
    a.moveSheet(s3, 0);
    a.setTabColor(s2, '#3b82f6');
    a.setSheetHidden(s2, true);
    r.flush();
    expect(names(b)).toEqual(['Totals', 'Sheet1', 'Costs']);
    expect(b.sheets()[2]).toMatchObject({ id: s2, color: '#3b82f6', hidden: true });
    expect(b.engine.sheetByName('Costs')?.id).toBe(s2);
  });

  it('refuses a name in use, a name with a bracket, and hiding the last visible sheet', () => {
    const { a, sheet } = two();
    const seen: ModelNotice[] = [];
    a.onNotice((n) => seen.push(n));
    const s2 = a.addSheet('Two')!;
    a.renameSheet(s2, 'sheet1');
    a.renameSheet(s2, 'a[b]');
    a.setSheetHidden(s2, true);
    a.setSheetHidden(sheet, true);
    expect(seen.map((n) => n.kind)).toEqual(['refused', 'refused', 'refused']);
    expect(seen[0]?.message).toBe('There is already a sheet called sheet1.');
    expect(a.sheets().map((s) => s.hidden)).toEqual([false, true]);
  });

  it('two people moving different sheets both keep their move', () => {
    const { a, b, room: r } = two();
    const [s2, , s4] = [a.addSheet()!, a.addSheet()!, a.addSheet()!];
    r.flush();
    a.moveSheet(s4, 0);
    b.moveSheet(s2, 3);
    r.flush();
    expect(a.sheets().map((s) => s.id)).toEqual(b.sheets().map((s) => s.id));
    expect(a.sheets()[0]!.id).toBe(s4);
    expect(a.sheets().at(-1)!.id).toBe(s2);
    expect(a.sheets()).toHaveLength(4);
    expect(new Set(a.sheets().map((s) => s.id)).size).toBe(4);
  });

  it('a formula naming a sheet follows its rename', () => {
    const { a, b, room: r, sheet } = two();
    const s2 = a.addSheet('Data')!;
    type(a, s2, 'A1', '21');
    type(a, sheet, 'A1', '=Data!A1*2');
    a.renameSheet(s2, 'Inputs');
    r.flush();
    expect(edit(b, sheet, 'A1')).toBe('=Inputs!A1*2');
    expect(text(b, sheet, 'A1')).toBe('42');
  });
});

describe('duplicate', () => {
  it('copies contents, formats, sizes and merges under new ids, its formulas on itself', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', '3');
    type(a, sheet, 'A2', '=A1*2');
    a.setStyle(sheet, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
    a.setStyle(sheet, { r1: 5, c1: 3, r2: 5, c2: 3 }, { italic: true });
    a.resize(sheet, 'col', 0, 0, 150);
    a.merge(sheet, { r1: 3, c1: 0, r2: 4, c2: 1 });
    const copy = a.duplicateSheet(sheet)!;
    r.flush();
    expect(names(b)).toEqual(['Sheet1', 'Sheet1 (2)']);
    expect(grid(b, copy, 2, 1)).toEqual([['3'], ['6']]);
    expect(edit(b, copy, 'A2')).toBe('=A1*2');
    expect(b.view(copy).cell(0, 0)?.style.bold).toBe(true);
    expect(b.view(copy).cell(5, 3)?.style.italic).toBe(true);
    expect(b.view(copy).colWidth(0)).toBe(150);
    expect(b.view(copy).merges()).toEqual([{ r1: 3, c1: 0, r2: 4, c2: 1 }]);
    type(b, copy, 'A1', '5');
    r.flush();
    expect(text(a, sheet, 'A2')).toBe('6');
    expect(text(a, copy, 'A2')).toBe('10');
    expect(b.engine.sheet(copy)!.rowOrder[0]).not.toBe(b.engine.sheet(sheet)!.rowOrder[0]);
  });
});

describe('remove', () => {
  it('and its undo bring the whole sheet back: maps inside it, cells, and formulas that named it', () => {
    const { a, b, room: r, sheet } = two();
    const s2 = a.addSheet('Data')!;
    type(a, s2, 'B2', '7');
    a.setStyle(s2, { r1: 1, c1: 1, r2: 1, c2: 1 }, { bold: true });
    a.resize(s2, 'col', 1, 1, 180);
    a.merge(s2, { r1: 4, c1: 0, r2: 5, c2: 2 });
    a.freeze(s2, 1, 0);
    type(a, sheet, 'A1', '=Data!B2+1');
    r.flush();
    const before = JSON.stringify(sheetsOf(r.doc).get(s2)!.toJSON());

    a.removeSheet(s2);
    r.flush();
    for (const m of [a, b]) {
      expect(names(m)).toEqual(['Sheet1']);
      expect(text(m, sheet, 'A1')).toBe('#REF!');
    }
    expect(a.status().cells).toBe(2);

    a.undo();
    r.flush();
    for (const m of [a, b]) {
      expect(names(m)).toEqual(['Sheet1', 'Data']);
      expect(text(m, s2, 'B2')).toBe('7');
      expect(m.view(s2).cell(1, 1)?.style.bold).toBe(true);
      expect(m.view(s2).colWidth(1)).toBe(180);
      expect(m.view(s2).merges()).toEqual([{ r1: 4, c1: 0, r2: 5, c2: 2 }]);
      expect(m.view(s2).frozen()).toEqual({ rows: 1, cols: 0 });
      expect(text(m, sheet, 'A1')).toBe('8');
    }
    expect(JSON.stringify(sheetsOf(r.doc).get(s2)!.toJSON())).toBe(before);
    expect(sheetsOf(r.doc).get(s2)!.get('rowOrder')).toBeInstanceOf(Y.Array);
  });

  it('refuses the last visible sheet', () => {
    const { a, sheet } = two();
    const seen: ModelNotice[] = [];
    a.onNotice((n) => seen.push(n));
    a.removeSheet(sheet);
    expect(seen[0]?.message).toBe('A spreadsheet needs at least one visible sheet.');
  });
});
