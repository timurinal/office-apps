import { describe, expect, it } from 'vitest';
import { FormatError } from '../errors';
import { dumpWorkbook } from '../xlsx/testing';
import { openBook } from '../xlsx/book';
import { buildSheetSeed } from '../../sheets/model/seed';
import { detectDelimiter, parseCsv } from './parse';
import { decodeText, readCsv, sheetNameOf } from './read';
import { fieldText, sheetRows, writeCsv } from './write';

const LIMITS = { rows: 1000, cols: 100, cells: 10_000 };
const text = (s: string) => new TextEncoder().encode(s);

describe('parsing', () => {
  it('reads fields, quoted fields, doubled quotes, and line breaks inside quotes', () => {
    expect(parseCsv('a,b,c\r\n"x,y","he said ""hi""","line\nbreak"\n1,2,3', ',', LIMITS)).toEqual([
      ['a', 'b', 'c'],
      ['x,y', 'he said "hi"', 'line\nbreak'],
      ['1', '2', '3']
    ]);
  });

  it('ends a line with CRLF, LF or CR, and a final line needs no end', () => {
    expect(parseCsv('a\rb\nc\r\nd', ',', LIMITS)).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(parseCsv('a,b\n', ',', LIMITS)).toEqual([['a', 'b']]);
    expect(parseCsv('', ',', LIMITS)).toEqual([]);
  });

  it('keeps empty fields, empty lines and ragged rows', () => {
    expect(parseCsv('a,,c\n\nd,e\n,\n', ',', LIMITS)).toEqual([['a', '', 'c'], [''], ['d', 'e'], ['', '']]);
  });

  it('is lenient about a quote where it should not be, and a quote never closed', () => {
    expect(parseCsv('5" pipe,"abc"def,"ghi', ',', LIMITS)).toEqual([['5" pipe', 'abcdef', 'ghi']]);
  });

  it('stops at the limits it is given', () => {
    const refusal = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof FormatError ? e.code : 'other';
      }
      return null;
    };
    expect(refusal(() => parseCsv('a\n'.repeat(11), ',', { rows: 10, cols: 5, cells: 1000 }))).toBe('sheet_too_large');
    expect(refusal(() => parseCsv('a,b,c,d,e,f', ',', { rows: 10, cols: 5, cells: 1000 }))).toBe('sheet_too_large');
    expect(refusal(() => parseCsv('a,b\nc,d\ne', ',', { rows: 10, cols: 5, cells: 4 }))).toBe('sheet_too_large');
    // Empty fields are not cells.
    expect(refusal(() => parseCsv(',,,,\n,,,,', ',', { rows: 10, cols: 5, cells: 1 }))).toBeNull();
  });

  it('finds the delimiter a file uses', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
    expect(detectDelimiter('a;b;c\n1,5;2,5;3\n4;5;6')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    // A comma inside quotes is not a delimiter, and a lone column is a comma.
    expect(detectDelimiter('"a,b";c\n"1,2";3\n"4,5";6')).toBe(';');
    expect(detectDelimiter('just\none\ncolumn')).toBe(',');
  });
});

describe('reading', () => {
  const dump = (src: string | Uint8Array, opts = {}) => dumpWorkbook(readCsv(typeof src === 'string' ? text(src) : src, opts).seed);

  it('types each field the way typing it would', () => {
    const [s] = dump('name,qty,price,when,ok,pct\nPen,3,"£4.50",15/01/2024,TRUE,12%\nCap,"1,200",-2,2024-02-29,false,5.5%\n').sheets;
    expect(s!.cells.A2).toEqual({ v: 'Pen' });
    expect(s!.cells.B2).toEqual({ v: 3 });
    expect(s!.cells.B3).toEqual({ v: 1200, style: { numFmt: '#,##0' } });
    expect(s!.cells.C2).toMatchObject({ v: 4.5 });
    expect(s!.cells.C2!.style!.numFmt).toContain('#,##0.00');
    expect(s!.cells.C3).toEqual({ v: -2 });
    expect(s!.cells.D2).toEqual({ v: 45306, style: { numFmt: 'dd/mm/yyyy' } });
    expect(s!.cells.D3).toEqual({ v: 45351, style: { numFmt: 'yyyy-mm-dd' } });
    expect(s!.cells.E2).toEqual({ v: true });
    expect(s!.cells.E3).toEqual({ v: false });
    expect(s!.cells.F2).toEqual({ v: 0.12, style: { numFmt: '0%' } });
    expect(s!.cells.F3).toEqual({ v: 0.055, style: { numFmt: '0.0%' } });
  });

  it('reads a short date in the order it is told, day first by default', () => {
    expect(dump('3/4/2024').sheets[0]!.cells.A1!.v).toBe(45385); // 3 April
    expect(dump('3/4/2024', { dateOrder: 'mdy' }).sheets[0]!.cells.A1!.v).toBe(45355); // 4 March
  });

  it('keeps as text what turning into a number would damage', () => {
    const c = dump('007,00123,"+0044",1234567890123456789,0.5,0,12345678901234,\'quoted,#N/A\n').sheets[0]!.cells;
    expect(c.A1).toEqual({ v: '007' });
    expect(c.B1).toEqual({ v: '00123' });
    expect(c.C1).toEqual({ v: '+0044' });
    expect(c.D1).toEqual({ v: '1234567890123456789' });
    expect(c.E1).toEqual({ v: 0.5 });
    expect(c.F1).toEqual({ v: 0 });
    expect(c.G1).toEqual({ v: 12345678901234 });
    // An apostrophe is how a cell is typed to stay text; in a file it is an apostrophe.
    expect(c.H1).toEqual({ v: "'quoted" });
    expect(c.I1).toEqual({ e: '#N/A' });
  });

  it('never makes a formula of a field, whatever it starts with', () => {
    const c = dump('=1+2,"=HYPERLINK(""http://evil.example"")",+SUM(A1),@x,-cmd\n').sheets[0]!.cells;
    for (const a1 of ['A1', 'B1', 'C1', 'D1', 'E1']) expect(c[a1]!.f, a1).toBeUndefined();
    expect(c.A1).toEqual({ v: '=1+2' });
    expect(c.B1).toEqual({ v: '=HYPERLINK("http://evil.example")' });
  });

  it('reads a decimal comma in a file that separates with semicolons, and only then', () => {
    const c = dump('Ola;3,14;1.234,56;12\nKari;2,5;7;8\n').sheets[0]!.cells;
    expect(c.B1).toEqual({ v: 3.14 });
    expect(c.C1).toEqual({ v: 1234.56 });
    expect(c.D1).toEqual({ v: 12 });
    const point = dump('a;1.5;2,5\n').sheets[0]!.cells;
    expect(point.C1).toEqual({ v: '2,5' });
    // With a comma for the delimiter, "3,14" is not read as a decimal.
    const comma = dump('a,"3,14",2\n').sheets[0]!.cells;
    expect(comma.B1).toEqual({ v: '3,14' });
  });

  it('honours a tab, a sep= line from Excel, and a named delimiter', () => {
    expect(dump('a\tb\n1\t2', { delimiter: '\t' }).sheets[0]!.cells.B2).toEqual({ v: 2 });
    expect(dump('sep=;\na;b\n1;2').sheets[0]!.cells).toMatchObject({ A1: { v: 'a' }, B2: { v: 2 } });
  });

  it('decodes UTF-8 with or without a mark, UTF-16 with one, and falls back to Windows-1252', () => {
    const utf8 = text('Café,naïve\n');
    expect(decodeText(utf8)).toBe('Café,naïve\n');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe('Café,naïve\n');
    const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...'a,b'].map((c) => c.charCodeAt(0))).buffer)]);
    expect(decodeText(utf16)).toBe('a,b');
    // "Café" in Windows-1252 is not valid UTF-8.
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });

  it('names the sheet after the file, as Excel does, and is a sheet Excel accepts', () => {
    expect(sheetNameOf('Q1 report: final/draft')).toBe('Q1 report final draft');
    expect(sheetNameOf('x'.repeat(50))).toHaveLength(31);
    expect(sheetNameOf('')).toBe('Sheet1');
    expect(dump('a', { sheetName: 'Budget' }).sheets[0]!.name).toBe('Budget');
  });

  it('is a sheet of at least the usual size, and larger when the file is', () => {
    const seed = readCsv(text('a'), {}).seed;
    const book = openBook(seed);
    expect([book.sheets[0]!.rows.length, book.sheets[0]!.cols.length]).toEqual([1000, 26]);
    const tall = readCsv(text(Array.from({ length: 1500 }, (_, i) => String(i)).join('\n')), {}).seed;
    expect(openBook(tall).sheets[0]!.rows.length).toBe(1600);
  });

  it('refuses an empty file, and one past the room\'s caps', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof FormatError ? e.code : 'other';
      }
      return null;
    };
    expect(code(() => readCsv(new Uint8Array(0)))).toBe('empty');
    expect(code(() => readCsv(text('\n\n')))).toBe(null);
    // 17 columns of 32,767 characters, 400 rows: 12 MiB of cells.
    const big = 'x'.repeat(32_000);
    expect(code(() => readCsv(text(Array.from({ length: 450 }, () => big).join('\n'))))).toBe('sheet_too_large');
  });
});

describe('writing', () => {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Data');
    s.cell(0, 0, { value: 'plain' }).cell(0, 1, { value: 'a, b' }).cell(0, 2, { value: 'say "hi"' }).cell(0, 3, { value: 'two\nlines' });
    s.cell(1, 0, { value: 1234.5, style: { numFmt: '£#,##0.00' } }).cell(1, 1, { value: 0.12, style: { numFmt: '0%' } });
    s.cell(1, 2, { value: 45356, style: { numFmt: 'dd/mm/yyyy' } }).cell(1, 3, { value: 45356.75, style: { numFmt: 'dd/mm/yyyy hh:mm' } });
    s.cell(2, 0, { value: 0.5, style: { numFmt: 'h:mm' } }).cell(2, 1, { value: true }).cell(2, 2, { error: '#N/A' }).cell(2, 3, { formula: 'A2*2' });
    s.cell(3, 1, { value: ' padded ' }).cell(3, 3, { value: 'é' });
  });

  it('writes values, not what the cells show, and dates the way every spreadsheet reads them', () => {
    const rows = sheetRows(openBook(seed), openBook(seed).sheets[0]!);
    expect(rows).toEqual([
      ['plain', 'a, b', 'say "hi"', 'two\nlines'],
      ['1234.5', '0.12', '2024-03-05', '2024-03-05 18:00:00'],
      ['12:00:00', 'TRUE', '#N/A', '2469'],
      ['', ' padded ', '', 'é']
    ]);
  });

  it('quotes by RFC 4180, ends lines with CRLF, and marks UTF-8 for Excel on request', () => {
    const rows = sheetRows(openBook(seed), openBook(seed).sheets[0]!);
    const csv = new TextDecoder().decode(writeCsv(rows, { delimiter: ',' }));
    expect(csv).toBe('plain,"a, b","say ""hi""","two\nlines"\r\n1234.5,0.12,2024-03-05,2024-03-05 18:00:00\r\n12:00:00,TRUE,#N/A,2469\r\n," padded ",,é\r\n');
    const tsv = new TextDecoder().decode(writeCsv(rows, { delimiter: '\t' }));
    expect(tsv.split('\r\n')[0]).toBe('plain\ta, b\t"say ""hi"""\t"two\nlines"');
    const withMark = writeCsv(rows, { delimiter: ',', bom: true });
    expect([...withMark.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(writeCsv([], { delimiter: ',' }))).toBe('');
  });

  it('writes text that a spreadsheet would run as a formula with an apostrophe in front', () => {
    for (const bad of ['=1+1', '+1+1', '@SUM(A1)', '-cmd|calc', '\tx', '\rx']) expect(fieldText(bad, undefined), bad).toBe(`'${bad}`);
    // A negative number as text is not a formula, nor is ordinary text.
    for (const fine of ['-5', '-1,200.5', 'a=b', 'x+y', ' =x']) expect(fieldText(fine, undefined), fine).toBe(fine);
    // And a number is a number.
    expect(fieldText(-5, undefined)).toBe('-5');
  });

  it('is a workbook again when it is read back, as far as a text file can say it', () => {
    const rows = sheetRows(openBook(seed), openBook(seed).sheets[0]!);
    const back = dumpWorkbook(readCsv(writeCsv(rows, { delimiter: ',' }), { sheetName: 'Data' }).seed).sheets[0]!;
    expect(back.cells.A1).toEqual({ v: 'plain' });
    expect(back.cells.B1).toEqual({ v: 'a, b' });
    expect(back.cells.C1).toEqual({ v: 'say "hi"' });
    expect(back.cells.D1).toEqual({ v: 'two\nlines' });
    expect(back.cells.A2!.v).toBe(1234.5);
    expect(back.cells.C2).toEqual({ v: 45356, style: { numFmt: 'yyyy-mm-dd' } });
    expect(back.cells.D2!.v).toBeCloseTo(45356.75, 8);
    expect(back.cells.B3).toEqual({ v: true });
    expect(back.cells.C3).toEqual({ e: '#N/A' });
    expect(back.cells.D3).toEqual({ v: 2469 });
    expect(back.cells.B4!.v).toBe(' padded ');
  });
});
