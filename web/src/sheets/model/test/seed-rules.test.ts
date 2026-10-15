/** What a seed can say beyond cells: conditional formats, validations and a filter, bound to the workbook's ids. */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { dumpWorkbook } from '../../../formats/xlsx/testing';
import { SheetModel } from '../model';
import { buildSheetSeed } from '../seed';
import { localSheetSource } from '../source';
import { sheetsOf, sheetIdsInOrder, part } from '../structure';

describe('buildSheetSeed: rules', () => {
  const seed = buildSheetSeed((b) => {
    const a = b.addSheet('Data', { rows: 20, cols: 6 });
    const lists = b.addSheet('Lists', { rows: 10, cols: 2 });
    a.cell(0, 0, { value: 1 }).cell(1, 0, { value: 2 });
    lists.cell(0, 0, { value: 'x' });
    a.cf({ ranges: [{ r1: 0, c1: 0, r2: 9, c2: 0 }], when: { kind: 'cell', op: 'gt', a: 1 }, style: { fill: '#ff0000' }, priority: 5 });
    a.cf({ ranges: [{ r1: 0, c1: 1, r2: 9, c2: 1 }], when: { kind: 'formula', formula: 'MOD(B1,2)=0' }, style: { bold: true } });
    a.cf({ ranges: [{ r1: 0, c1: 2, r2: 9, c2: 2 }], when: { kind: 'formula', formula: '=(((' }, style: {} });
    a.cf({ ranges: [{ r1: 500, c1: 0, r2: 600, c2: 0 }], when: { kind: 'blank' }, style: {} });
    a.validation({ ranges: [{ r1: 0, c1: 3, r2: 4, c2: 3 }], check: { kind: 'listRange', sheet: lists, range: { r1: 0, c1: 0, r2: 1, c2: 0 } }, strict: true });
    a.validation({ ranges: [{ r1: 0, c1: 4, r2: 4, c2: 4 }], check: { kind: 'formula', formula: 'E1>0' } });
    a.validation({ ranges: [{ r1: 0, c1: 5, r2: 4, c2: 5 }], check: { kind: 'listRange', sheet: lists, range: { r1: 0, c1: 0, r2: 99, c2: 0 } } });
    a.filter({ r1: 0, c1: 0, r2: 5, c2: 2 });
  });

  it('binds the formulas in a rule to the workbook and gives each range its ids', () => {
    const d = dumpWorkbook(seed).sheets[0]!;
    expect(d.cf.map((r) => [r.ranges, r.when])).toEqual([
      [['B1:B10'], { kind: 'formula', f: '=MOD(B1,2)=0' }],
      [['A1:A10'], { kind: 'cell', op: 'gt', a: 1 }]
    ]);
    expect(d.validations).toEqual([
      { ranges: ['D1:D5'], check: { kind: 'listRange', sheet: 'Lists', range: 'A1:A2' }, strict: true },
      { ranges: ['E1:E5'], check: { kind: 'formula', f: '=E1>0' } }
    ]);
    expect(d.filter).toBe('A1:C6');
  });

  it('leaves out a rule whose formula does not read, one with no range on the sheet, and one whose list is not on its sheet, and counts the first', () => {
    expect(seed.skipped).toEqual({ rules: 1 });
  });

  it('is a workbook the model opens, and the rules work', async () => {
    const m = new SheetModel(localSheetSource(seed));
    await Promise.resolve();
    await Promise.resolve();
    const id = m.sheets()[0]!.id;
    const v = m.view(id);
    expect(v.cell(1, 0)?.conditional?.fill).toBe('#ff0000');
    expect(v.cell(0, 0)?.conditional).toBeUndefined();
    expect(v.listChoices(0, 3)).toEqual(['x']);
    expect(v.filter()?.cols).toEqual([0, 1, 2]);
  });

  it('writes a rule\'s ids as a sheet\'s own, so deleting a row moves them as it moves a merge', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.state);
    const data = sheetsOf(doc).get(sheetIdsInOrder(doc)[0]!)!;
    expect(part(data, 'cf').size).toBe(2);
    expect(part(data, 'validation').size).toBe(2);
  });
});
