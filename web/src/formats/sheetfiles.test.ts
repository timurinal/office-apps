import { describe, expect, it } from 'vitest';
import { decodeCellList, encodeCellList } from '@shared/cells';
import * as Y from 'yjs';
import { fromBase64 } from '../crypto/primitives';
import { buildSheetSeed } from '../sheets/model/seed';
import { sheetIdsInOrder, sheetsOf } from '../sheets/model/structure';
import { isFormatError } from './errors';
import { exportSheet } from './exportSheets';
import { importSheet, sheetTitleOf } from './importSheets';
import { SHEET_EXPORT_FORMATS, sheetFormatOf } from './sheets';
import { dumpWorkbook } from './xlsx/testing';

const text = (s: string) => new TextEncoder().encode(s);

describe('what a file name says', () => {
  it('knows the three formats by extension, in any case, and nothing else', () => {
    expect(sheetFormatOf('Budget.xlsx')).toBe('xlsx');
    expect(sheetFormatOf('Budget.CSV')).toBe('csv');
    expect(sheetFormatOf('v2.final.tsv')).toBe('tsv');
    for (const other of ['old.xls', 'macro.xlsm', 'notes.txt', 'xlsx', '']) expect(sheetFormatOf(other), other).toBeNull();
  });

  it('titles a file by its name', () => {
    expect(sheetTitleOf('C:\\Users\\ada\\Q1  report.xlsx')).toBe('Q1 report');
    expect(sheetTitleOf('.xlsx')).toBe('Untitled');
    expect(sheetTitleOf('x'.repeat(300) + '.csv')).toHaveLength(200);
  });

  it('labels each format for a menu', () => {
    expect(Object.values(SHEET_EXPORT_FORMATS).map((f) => f.label)).toEqual(['Workbook (.xlsx)', 'Comma-separated values (.csv)', 'Tab-separated values (.tsv)']);
  });
});

describe('importSheet', () => {
  it('hands back what POST /documents takes, for a workbook and for text', async () => {
    const out = await importSheet('Plan.csv', text('a,b\n1,2\n'));
    expect(out).toMatchObject({ title: 'Plan', format: 'csv', warnings: [] });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(out.stateBase64));
    expect(sheetsOf(doc).get(sheetIdsInOrder(doc)[0]!)!.get('name')).toBe('Plan');
    expect(decodeCellList(fromBase64(out.cellsBase64))).toHaveLength(4);
  });

  it('refuses what it cannot open, in words', async () => {
    const code = async (name: string, bytes: Uint8Array) => {
      try {
        await importSheet(name, bytes);
      } catch (e) {
        return isFormatError(e) ? e.code : 'other';
      }
      return null;
    };
    expect(await code('notes.txt', text('hello'))).toBe('unsupported');
    expect(await code('empty.csv', new Uint8Array(0))).toBe('empty');
    expect(await code('broken.xlsx', text('this is not a zip file, though it has a name that says so'))).toBe('not_xlsx');
    expect(await code('big.csv', new Uint8Array(65 * 1024 * 1024))).toBe('too_large');
  });

  it('reads a date the way it is told', async () => {
    const day = async (dateOrder?: 'dmy' | 'mdy') => {
      const out = await importSheet('d.csv', text('3/4/2024'), dateOrder ? { dateOrder } : {});
      return dumpWorkbook({ state: fromBase64(out.stateBase64), cells: decodeCellList(fromBase64(out.cellsBase64))! }).sheets[0]!.cells.A1!.v;
    };
    expect(await day()).toBe(45385);
    expect(await day('mdy')).toBe(45355);
  });
});

describe('exportSheet', () => {
  const seed = buildSheetSeed((b) => {
    const a = b.addSheet('Budget');
    b.addSheet('Notes').cell(0, 0, { value: 'other sheet' });
    a.cell(0, 0, { value: 'name' }).cell(0, 1, { value: 'Café' }).cell(1, 0, { value: 7 });
    b.addSheet('Secret').hide();
  });
  const file = () => ({ state: seed.state, cells: decodeCellList(encodeCellList(seed.cells))! });

  it('writes an xlsx, with its type', async () => {
    const out = await exportSheet('xlsx', file(), { title: 'Budget', now: 0 });
    expect(out.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(out.extension).toBe('xlsx');
    expect([out.bytes[0], out.bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it('writes the first sheet that is shown as csv, says that it is the only one, and marks UTF-8 on request', async () => {
    const out = await exportSheet('csv', file(), { title: 'Budget' });
    expect(new TextDecoder().decode(out.bytes)).toBe('name,Café\r\n7,\r\n');
    expect(out.warnings.map((w) => w.message)).toEqual(['Only “Budget” is in it.']);
    expect([...out.bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const marked = await exportSheet('csv', file(), { title: 'Budget', bom: true });
    expect([...marked.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('writes the sheet it is asked for, as tab separated text', async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.state);
    const ids = sheetIdsInOrder(doc);
    const out = await exportSheet('tsv', file(), { title: 'Budget', sheetId: ids[1]! });
    expect(new TextDecoder().decode(out.bytes)).toBe('other sheet\r\n');
    expect(out.mime).toBe('text/tab-separated-values;charset=utf-8');
  });

  it('says nothing about a workbook of one sheet', async () => {
    const one = buildSheetSeed((b) => b.addSheet('Only').cell(0, 0, { value: 1 }));
    const out = await exportSheet('csv', { state: one.state, cells: one.cells }, { title: 'One' });
    expect(out.warnings).toEqual([]);
  });
});
