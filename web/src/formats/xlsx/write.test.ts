import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { type SheetSeed, buildSheetSeed } from '../../sheets/model/seed';
import { field, part, sheetIdsInOrder, sheetsOf } from '../../sheets/model/structure';
import { readXlsx } from './read';
import { dumpWorkbook, plainStyle } from './testing';
import { sheetNameFor, writeXlsx } from './write';

const NOW = Date.UTC(2026, 9, 15, 12);

async function exportOf(seed: SheetSeed) {
  const out = await writeXlsx(seed, { title: 'Test', now: NOW });
  const zip = unzipSync(out.bytes);
  const text = (name: string) => strFromU8(zip[name]!);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(out.bytes));
  return { ...out, zip, text, wb };
}

/** Exports, reads the file again and says what it made of it. */
async function again(seed: SheetSeed) {
  const out = await writeXlsx(seed, { title: 'Test', now: NOW });
  return { first: dumpWorkbook(seed), second: dumpWorkbook((await readXlsx(out.bytes)).seed), warnings: out.warnings };
}

describe('values and formulas', () => {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Sheet 1');
    s.cell(0, 0, { value: 10 }).cell(1, 0, { value: 20 }).cell(2, 0, { formula: 'SUM(A1:A2)' });
    s.cell(0, 1, { value: 'text' }).cell(1, 1, { value: true }).cell(2, 1, { error: '#N/A' });
    s.cell(0, 2, { value: 45356.5, style: { numFmt: 'dd/mm/yyyy hh:mm' } });
    s.cell(3, 0, { formula: 'IFS(A1>5,"big",TRUE,"small")' });
    s.cell(4, 0, { formula: '1/0' });
    s.cell(5, 0, { formula: '=A9' });
    const t = b.addSheet('Summary');
    t.cell(0, 0, { formula: "'Sheet 1'!A3*2" });
  });

  it('writes a formula as Excel reads it, with the value it came to beside it', async () => {
    const { wb, text } = await exportOf(seed);
    const ws = wb.getWorksheet('Sheet 1')!;
    expect(ws.getCell('A3').value).toEqual({ formula: 'SUM(A1:A2)', result: 30 });
    expect(ws.getCell('A5').value).toEqual({ formula: '1/0', result: { error: '#DIV/0!' } });
    // An empty reference is shown by Excel as 0.
    expect(text('xl/worksheets/sheet1.xml')).toMatch(/<c r="A6"[^>]*><f>A9<\/f><v>0<\/v><\/c>/);
    expect(wb.getWorksheet('Summary')!.getCell('A1').value).toEqual({ formula: "'Sheet 1'!A3*2", result: 60 });
    // A function newer than Excel 2007 carries its prefix, or an older Excel shows #NAME?.
    expect(text('xl/worksheets/sheet1.xml')).toContain('_xlfn.IFS(A1&gt;5,&quot;big&quot;,TRUE,&quot;small&quot;)');
    expect(ws.getCell('A4').value).toMatchObject({ result: 'big' });
  });

  it('writes plain values as they are, and a date as the number it is under its format', async () => {
    const { wb } = await exportOf(seed);
    const ws = wb.getWorksheet('Sheet 1')!;
    expect(ws.getCell('B1').value).toBe('text');
    expect(ws.getCell('B2').value).toBe(true);
    expect(ws.getCell('B3').value).toEqual({ error: '#N/A' });
    expect(ws.getCell('C1').numFmt).toBe('dd/mm/yyyy hh:mm');
    expect((ws.getCell('C1').value as Date).toISOString()).toBe('2024-03-05T12:00:00.000Z');
  });

  it('asks Excel to calculate the workbook again when it opens it', async () => {
    const { text } = await exportOf(seed);
    expect(text('xl/workbook.xml')).toContain('fullCalcOnLoad="1"');
  });

  it('is the same workbook when it is read again', async () => {
    const { first, second, warnings } = await again(seed);
    expect(second).toEqual(first);
    expect(warnings).toEqual([]);
  });
});

describe('formats', () => {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Formats');
    s.cell(0, 0, {
      value: 'styled',
      style: { font: 'Arial', size: 14, bold: true, italic: true, underline: true, strike: true, color: '#c0392b', fill: '#fff2cc', h: 'right', v: 'top', wrap: true, indent: 1, numFmt: '@', borderTop: { line: 'thin' }, borderBottom: { line: 'double', color: '#123456' }, borderLeft: { line: 'dotted' }, borderRight: { line: 'thick' } }
    });
    s.cell(1, 0, { value: 'plain' });
    s.cell(2, 0, { value: 'in a formatted column' });
    s.colStyle(1, { fill: '#e8f5e9', bold: true });
    s.cell(0, 1, { value: 'a', style: { italic: true } });
    s.rowStyle(5, { fill: '#e3f2fd' });
    s.cell(5, 3, { value: 'row', style: { color: '#ff0000' } });
  });

  it('writes each format the way Excel names it, with a whole font', async () => {
    const { wb } = await exportOf(seed);
    const c = wb.getWorksheet('Formats')!.getCell('A1');
    expect(c.font).toMatchObject({ name: 'Arial', size: 14, bold: true, italic: true, underline: true, strike: true, color: { argb: 'FFC0392B' } });
    expect(c.fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } });
    expect(c.alignment).toMatchObject({ horizontal: 'right', vertical: 'top', wrapText: true, indent: 1 });
    expect(c.border).toMatchObject({ top: { style: 'thin' }, bottom: { style: 'double', color: { argb: 'FF123456' } }, left: { style: 'dotted' }, right: { style: 'thick' } });
    expect(c.numFmt).toBe('@');
    // A cell with no format is still written whole: Excel's own default font, and the grid's middle.
    const plain = wb.getWorksheet('Formats')!.getCell('A2');
    expect(plain.font).toMatchObject({ name: 'Calibri', size: 11 });
    expect(plain.alignment).toMatchObject({ vertical: 'middle' });
  });

  it('gives a cell the format of its column and its row under its own, and a blank cell of a column the column\'s', async () => {
    const { wb } = await exportOf(seed);
    const ws = wb.getWorksheet('Formats')!;
    expect(ws.getCell('B1').font).toMatchObject({ italic: true, bold: true });
    expect(ws.getCell('B1').fill).toMatchObject({ fgColor: { argb: 'FFE8F5E9' } });
    expect(ws.getColumn(2).style.fill).toMatchObject({ fgColor: { argb: 'FFE8F5E9' } });
    expect(ws.getCell('D6').fill).toMatchObject({ fgColor: { argb: 'FFE3F2FD' } });
    expect((ws.getRow(6) as unknown as { style: ExcelJS.Style }).style.fill).toMatchObject({ fgColor: { argb: 'FFE3F2FD' } });
  });

  it('is the same workbook when it is read again (the grid\'s middle is the default either way)', async () => {
    const { first, second } = await again(seed);
    expect(second).toEqual(first);
  });
});

describe('layout', () => {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Layout').tab('#22c55e');
    s.cell(0, 0, { value: 'head', style: { borderTop: { line: 'thin' } } }).cell(0, 1, { value: 'gone', style: { borderBottom: { line: 'thin' } } }).cell(2, 0, { value: 'x' });
    s.colWidth(0, 140).colWidth(1, 63).colWidth(2, 0).hideCol(4).rowHeight(1, 60).hideRow(2).rowStyle(7, { fill: '#eeeeee' }).hideRow(9);
    s.freeze(1, 1).merge({ r1: 0, c1: 0, r2: 1, c2: 1 }).merge({ r1: 6, c1: 0, r2: 6, c2: 2 });
    b.addSheet('Hidden').hide();
  });

  it('writes sizes, hidden lines, frozen panes, merges, the tab\'s colour and a hidden sheet', async () => {
    const { wb } = await exportOf(seed);
    const ws = wb.getWorksheet('Layout')!;
    // 7 pixels to a character; a width of exactly 9 is nudged, because ExcelJS would not write it.
    expect(ws.getColumn(1).width).toBeCloseTo(20, 5);
    expect(ws.getColumn(2).width).toBeCloseTo(9, 3);
    expect(ws.getColumn(5).hidden).toBe(true);
    expect(ws.getRow(2).height).toBe(45);
    expect(ws.getRow(3).hidden).toBe(true);
    expect(ws.getRow(10).hidden).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 1, topLeftCell: 'B2' });
    expect(Object.keys((ws as unknown as { _merges: object })._merges).sort()).toEqual(['A1', 'A7']);
    expect(ws.properties.tabColor).toEqual({ argb: 'FF22C55E' });
    expect(wb.getWorksheet('Hidden')!.state).toBe('hidden');
    // The sheet's own default line size is the model's.
    expect(ws.properties.defaultColWidth).toBeCloseTo(16, 5);
  });

  it('leaves the cells of a merge their own borders, which are what outline it', async () => {
    const { wb } = await exportOf(seed);
    const ws = wb.getWorksheet('Layout')!;
    expect(ws.getCell('A1').border).toMatchObject({ top: { style: 'thin' } });
    expect(ws.getCell('B1').border).toMatchObject({ bottom: { style: 'thin' } });
  });

  it('keeps a column of exactly nine characters 63 pixels wide, and writes a styled or hidden column with a width', async () => {
    const { first, second } = await again(seed);
    expect(second.sheets[0]!.widths).toEqual(first.sheets[0]!.widths);
    expect(second.sheets[0]!.widths[1]).toBe(63);
    expect(second.sheets[0]!.hiddenCols).toEqual([2, 4]);
    expect(second.sheets[0]!.hiddenRows).toEqual([2, 9]);
  });

  it('is the same workbook when it is read again', async () => {
    const { first, second } = await again(seed);
    expect(second).toEqual(first);
  });
});

describe('names, validations and conditional formats', () => {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Data', { rows: 20, cols: 6 });
    const lists = b.addSheet('Lists', { rows: 10, cols: 2 });
    for (let i = 0; i < 5; i++) s.cell(i, 0, { value: i * 3 });
    lists.cell(0, 0, { value: 'a' }).cell(1, 0, { value: 'b' });
    b.name('Rate', 'Data!$A$1').name('Mine', 'Data!$A$1:$A$3', s).name('Tax', '0.2');
    s.cell(0, 1, { formula: 'Rate*Tax+SUM(Mine)' });
    s.validation({ ranges: [{ r1: 0, c1: 2, r2: 9, c2: 2 }], check: { kind: 'list', items: ['red', 'green', 'blue'] }, strict: true, message: 'Pick a colour.' });
    s.validation({ ranges: [{ r1: 0, c1: 3, r2: 4, c2: 3 }], check: { kind: 'listRange', sheet: lists, range: { r1: 0, c1: 0, r2: 1, c2: 0 } } });
    s.validation({ ranges: [{ r1: 0, c1: 4, r2: 4, c2: 4 }, { r1: 7, c1: 4, r2: 7, c2: 4 }], check: { kind: 'integer', op: 'between', a: 1, b: 10 }, allowBlank: false });
    s.validation({ ranges: [{ r1: 0, c1: 5, r2: 4, c2: 5 }], check: { kind: 'date', op: 'gt', a: 45000 } });
    s.validation({ ranges: [{ r1: 10, c1: 0, r2: 12, c2: 0 }], check: { kind: 'formula', formula: 'A11>A1' } });
    s.validation({ ranges: [{ r1: 15, c1: 0, r2: 15, c2: 0 }], check: { kind: 'list', items: ['has,comma'] } });
    const style = { bold: true, color: '#9c0006', fill: '#ffc7ce' };
    const range = [{ r1: 0, c1: 0, r2: 4, c2: 0 }];
    s.cf({ ranges: range, when: { kind: 'cell', op: 'gt', a: 5 }, style, priority: 1 });
    s.cf({ ranges: range, when: { kind: 'cell', op: 'between', a: 1, b: 9 }, style, priority: 2 });
    s.cf({ ranges: range, when: { kind: 'text', op: 'contains', text: 'a"b' }, style, priority: 3 });
    s.cf({ ranges: range, when: { kind: 'blank' }, style, priority: 4 });
    s.cf({ ranges: range, when: { kind: 'notError' }, style, priority: 5 });
    s.cf({ ranges: range, when: { kind: 'formula', formula: 'MOD(A1,2)=0' }, style, priority: 6 });
    s.cf({ ranges: range, when: { kind: 'duplicate' }, style, priority: 7 });
    s.cf({ ranges: range, when: { kind: 'top', n: 3, bottom: true }, style, priority: 8 });
    s.cf({ ranges: range, when: { kind: 'average', below: true }, style, priority: 9 });
    s.cf({ ranges: range, when: { kind: 'scale', min: '#ffffff', mid: '#ffeb84', max: '#63be7b' }, style: {}, priority: 10 });
    s.cf({ ranges: range, when: { kind: 'bar', color: '#638ec6' }, style: {}, priority: 11 });
  });

  it('writes the names of the workbook and of a sheet, and a constant, as the file words them', async () => {
    const { text } = await exportOf(seed);
    const wb = text('xl/workbook.xml');
    expect(wb).toContain('<definedName name="Rate">Data!$A$1</definedName>');
    expect(wb).toContain('<definedName name="Mine" localSheetId="0">Data!$A$1:$A$3</definedName>');
    expect(wb).toContain('<definedName name="Tax">0.2</definedName>');
  });

  it('writes each validation, and says which it could not', async () => {
    const { wb, warnings } = await exportOf(seed);
    const model = (wb.getWorksheet('Data') as unknown as { dataValidations: { model: Record<string, Record<string, unknown>> } }).dataValidations.model;
    expect(model.C1).toMatchObject({ type: 'list', formulae: ['"red,green,blue"'], errorStyle: 'stop', error: 'Pick a colour.' });
    expect(model.D1).toMatchObject({ type: 'list', formulae: ['Lists!$A$1:$A$2'] });
    expect(model.E1).toMatchObject({ type: 'whole', operator: 'between', formulae: [1, 10] });
    expect(model.F1).toMatchObject({ type: 'date', operator: 'greaterThan' });
    expect(model.A11).toMatchObject({ type: 'custom', formulae: ['A11>A1'] });
    // A comma in an item cannot be said in Excel's literal list.
    expect(model.A16).toBeUndefined();
    expect(warnings.map((w) => w.message)).toEqual(['1 list validation that Excel cannot hold was left out.']);
  });

  it('is the same workbook when it is read again, rules and names included', async () => {
    const { first, second } = await again(seed);
    // The list with a comma is the one thing that does not come back; the rest must.
    first.sheets[0]!.validations = first.sheets[0]!.validations.filter((v) => !(v.check as { items?: string[] }).items?.some((i) => i.includes(',')));
    expect(second.names).toEqual(first.names);
    expect(second.sheets[0]!.validations).toEqual(first.sheets[0]!.validations);
    expect(second.sheets[0]!.cf).toEqual(first.sheets[0]!.cf.map((r) => ({ ...r })));
    expect(second).toEqual(first);
  });
});

describe('sheet names', () => {
  it('makes a name Excel takes, and one that is its own', () => {
    const taken = new Set<string>();
    const names = ['Budget: 2026', 'budget_ 2026', "'quoted'", 'x'.repeat(40), 'X'.repeat(40), '', 'a/b'].map((n) => {
      const out = sheetNameFor(n, taken);
      taken.add(out.toLowerCase());
      return out;
    });
    expect(names).toEqual(['Budget_ 2026', 'budget_ 2026 (2)', 'quoted', 'x'.repeat(31), `${'X'.repeat(27)} (2)`, 'Sheet', 'a_b']);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31);
  });

  it('renames in the formulas too, and says so', async () => {
    const seed = buildSheetSeed((b) => {
      b.addSheet('A/B').cell(0, 0, { value: 3 });
      b.addSheet('Next').cell(0, 0, { formula: "'A/B'!A1+1" });
    });
    const { wb, warnings } = await exportOf(seed);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['A_B', 'Next']);
    expect(wb.getWorksheet('Next')!.getCell('A1').value).toEqual({ formula: 'A_B!A1+1', result: 4 });
    expect(warnings.map((w) => w.message)).toEqual(['1 sheet name was changed to fit Excel.']);
  });
});

describe('what the model holds that a file does not', () => {
  /** The seed with a change made to its structure. */
  function edit(seed: SheetSeed, change: (doc: Y.Doc, sheetId: string) => void): SheetSeed {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.state);
    const id = sheetIdsInOrder(doc)[0]!;
    change(doc, id);
    return { ...seed, state: Y.encodeStateAsUpdate(doc) };
  }

  it('counts a chart and leaves it out', async () => {
    const seed = edit(buildSheetSeed((b) => b.addSheet('S').cell(0, 0, { value: 1 })), (doc, id) => {
      const s = sheetsOf(doc).get(id)!;
      const r = (field(s, 'rowOrder') as Y.Array<string>).get(0)!;
      const c = (field(s, 'colOrder') as Y.Array<string>).get(0)!;
      part(s, 'charts').set('c1', { type: 'column', sheet: id, data: { r1: r, c1: c, r2: r, c2: c }, anchor: { row: r, col: c, dx: 0, dy: 0 }, w: 300, h: 200 });
    });
    expect((await exportOf(seed)).warnings.map((w) => w.message)).toEqual(['1 chart was left out.']);
  });

  it('hides the rows a filter hides, as the grid does, and writes the filter\'s range', async () => {
    const seed = edit(
      buildSheetSeed((b) => {
        const s = b.addSheet('S');
        s.cell(0, 0, { value: 'name' }).cell(1, 0, { value: 'a' }).cell(2, 0, { value: 'b' }).cell(3, 0, { value: 'a' });
        s.filter({ r1: 0, c1: 0, r2: 3, c2: 0 });
      }),
      (doc, id) => {
        const s = sheetsOf(doc).get(id)!;
        const c = (field(s, 'colOrder') as Y.Array<string>).get(0)!;
        part(s, 'filter').set(`c:${c}`, { kind: 'values', hidden: ['b'] });
      }
    );
    const { wb } = await exportOf(seed);
    const ws = wb.getWorksheet('S')!;
    expect(ws.autoFilter).toBe('A1:A4');
    expect([2, 3, 4].map((r) => ws.getRow(r).hidden)).toEqual([false, true, false]);
  });

  it('writes the cells that are on the sheet and not the ones left on a row that was deleted', async () => {
    const seed = buildSheetSeed((b) => b.addSheet('S').cell(0, 0, { value: 'kept' }).cell(1, 0, { value: 'deleted' }));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, seed.state);
    const id = sheetIdsInOrder(doc)[0]!;
    (field(sheetsOf(doc).get(id)!, 'rowOrder') as Y.Array<string>).delete(1, 1);
    const out = await writeXlsx({ state: Y.encodeStateAsUpdate(doc), cells: seed.cells }, { title: 'T' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(out.bytes));
    expect(wb.getWorksheet('S')!.getCell('A1').value).toBe('kept');
    expect(wb.getWorksheet('S')!.getCell('A2').value).toBeNull();
  });
});

describe('the plain-style helper the comparisons use', () => {
  it('sees the middle and Excel\'s own font as no format', () => {
    expect(plainStyle({ v: 'middle', font: 'Calibri', size: 11, bold: null })).toBeUndefined();
    expect(plainStyle({ v: 'middle', bold: true })).toEqual({ bold: true });
  });
});
