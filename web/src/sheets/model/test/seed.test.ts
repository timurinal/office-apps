/** The seed builder, and a workbook on a local file: saved, opened again, the same. */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CELL_LIMITS, decodeCellList } from '@shared/cells';
import { fromBase64 } from '../../../crypto/primitives';
import { SheetModel } from '../model';
import { SheetSeedTooLarge, buildSheetSeed, sheetSeedRequest } from '../seed';
import { type SheetFile, localSheetSource } from '../source';
import { sheetIdsInOrder, sheetsOf } from '../structure';
import { edit, grid, text, type } from './helpers';

const open = async (file: SheetFile) => {
  const m = new SheetModel(localSheetSource(file));
  await Promise.resolve();
  await Promise.resolve();
  return m;
};

describe('buildSheetSeed', () => {
  it('without a build is one blank sheet of 1,000 by 26', () => {
    const seed = buildSheetSeed();
    expect(seed.cells).toEqual([]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.state);
    const ids = sheetIdsInOrder(doc);
    expect(ids).toHaveLength(1);
    const s = sheetsOf(doc).get(ids[0]!)!;
    expect(s.get('name')).toBe('Sheet1');
    expect((s.get('rowOrder') as Y.Array<string>).length).toBe(1000);
    expect((s.get('colOrder') as Y.Array<string>).length).toBe(26);
    expect(seed.state.length).toBeLessThan(16 * 1024);
  });

  it('binds formulas after every sheet and name exists, grows for what they reach, and keeps what it cannot read', async () => {
    const seed = buildSheetSeed((b) => {
      const one = b.addSheet('Summary', { rows: 10, cols: 4 });
      const two = b.addSheet('Data', { rows: 10, cols: 4 });
      b.name('Rate', 'Data!$A$1');
      one.cell(0, 0, { formula: 'Data!A1*2' });
      one.cell(1, 0, { formula: '=Rate+B30' });
      one.cell(2, 0, { formula: '=[1]Sheet1!A1', value: 'cached' });
      one.cell(3, 0, { value: '0042' }).cell(4, 0, { error: '#N/A' }).cell(5, 0, { value: true });
      one.cell(0, 1, { value: 3.5, style: { numFmt: '0.00', bold: true } });
      one.rowHeight(0, 40).colWidth(1, 160).hideRow(7).colStyle(3, { italic: true }).freeze(1, 0).merge({ r1: 8, c1: 0, r2: 9, c2: 1 });
      two.cell(0, 0, { value: 21 }).tab('#22c55e');
    });
    expect(seed.unread).toEqual({ formulas: 1, names: 0 });

    const m = await open(seed);
    const [s1, s2] = m.sheets();
    expect(m.sheets().map((s) => s.name)).toEqual(['Summary', 'Data']);
    expect(s2!.color).toBe('#22c55e');
    expect(m.view(s1!.id).rowCount()).toBe(30);
    expect(grid(m, s1!.id, 6, 2)).toEqual([
      ['42', '3.50'],
      ['21', ''],
      ['cached', ''],
      ['0042', ''],
      ['#N/A', ''],
      ['TRUE', '']
    ]);
    expect(edit(m, s1!.id, 'A2')).toBe('=Rate+B30');
    const v = m.view(s1!.id);
    expect([v.rowHeight(0), v.colWidth(1), v.rowHeight(7)]).toEqual([40, 160, 0]);
    expect(v.cell(0, 1)?.style).toEqual({ numFmt: '0.00', bold: true });
    expect(v.cell(20, 3)?.style.italic).toBe(true);
    expect(v.frozen()).toEqual({ rows: 1, cols: 0 });
    expect(v.merges()).toEqual([{ r1: 8, c1: 0, r2: 9, c2: 1 }]);
  });

  it('is what POST /documents takes', () => {
    const seed = buildSheetSeed((b) => b.addSheet('Sheet1').cell(0, 0, { value: 'x' }));
    const req = sheetSeedRequest(seed);
    expect(fromBase64(req.state)).toEqual(seed.state);
    expect(decodeCellList(fromBase64(req.cells))).toEqual(seed.cells);
  });

  it('refuses a workbook past the room\'s caps, before anything is sent', () => {
    const big = 'x'.repeat(CELL_LIMITS.textChars);
    expect(() =>
      buildSheetSeed((b) => {
        const s = b.addSheet('Sheet1');
        for (let i = 0; i < 400; i++) s.cell(i, 0, { value: big });
      })
    ).toThrow(SheetSeedTooLarge);
    expect(() => buildSheetSeed((b) => b.addSheet('Sheet1').cell(2_000_000, 0, { value: 1 }))).toThrow(RangeError);
  });
});

describe('a local file', () => {
  it('saves and opens again the same, its steps acknowledged at once', async () => {
    const m = await open(buildSheetSeed());
    const sheet = m.sheets()[0]!.id;
    expect(m.status()).toMatchObject({ connection: 'connected', loaded: true, save: 'saved' });
    type(m, sheet, 'A1', '5');
    type(m, sheet, 'A2', '=A1*2');
    m.insertRows(sheet, 0, 1);
    m.setStyle(sheet, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bold: true });
    m.deleteRows(sheet, 5, 1);
    m.addSheet('Notes');
    expect(m.status().save).toBe('saving');
    await Promise.resolve();
    expect(m.status().save).toBe('saved');

    const file = m.export();
    const again = await open(file);
    expect(again.sheets().map((s) => s.name)).toEqual(['Sheet1', 'Notes']);
    expect(grid(again, sheet, 4, 1)).toEqual([[''], ['5'], ['10'], ['']]);
    expect(edit(again, sheet, 'A3')).toBe('=A2*2');
    expect(again.view(sheet).cell(1, 0)?.style.bold).toBe(true);
    expect(again.view(sheet).rowCount()).toBe(1000);
    expect(again.status().cells).toBe(m.status().cells);
    expect(text(again, sheet, 'A2')).toBe('5');
  });

  it('has no presence and no server features but rename', async () => {
    const m = await open(buildSheetSeed());
    expect(m.awareness).toBeNull();
    expect(m.features).toMatchObject({ comments: false, sharing: false, history: false, rename: true });
    expect(m.view(m.sheets()[0]!.id).peers()).toEqual([]);
  });
});
