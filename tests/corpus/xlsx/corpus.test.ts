/**
 * The xlsx fidelity corpus. The bar for "does Sheets open and save an Excel workbook properly" is a set of
 * files, in three families, each asked the same questions:
 *
 *   generated/  made by `generate/make_openpyxl.py`, one family of features each, with `<name>.expect.json`
 *               saying what is true of the file independently of this repository (values worked out in Python).
 *   real/       workbooks written by Excel and LibreOffice that others published, with their source, licence and
 *               SHA-256 in `real/manifest.json`; the cached values in them are those programs' answers.
 *   hostile/    files that must be refused.
 *
 * Every importable file is read, written back out, read again, and the two models compared position by position
 * (`dumpWorkbook`). A formula is calculated by our engine and its answer compared with the one the file holds.
 * `python.test.ts` has openpyxl, a reader that is not ours, open every export.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { CellError, lettersToCol } from '../../../web/src/sheets/engine';
import { isFormatError } from '../../../web/src/formats/errors';
import { openBook, type Book } from '../../../web/src/formats/xlsx/book';
import { openXlsx } from '../../../web/src/formats/xlsx/package';
import { readXlsx } from '../../../web/src/formats/xlsx/read';
import { dumpWorkbook, type SheetDump, type WorkbookDump } from '../../../web/src/formats/xlsx/testing';
import { writeXlsx } from '../../../web/src/formats/xlsx/write';

const DIR = dirname(fileURLToPath(import.meta.url));
const bytes = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

interface Expect {
  values: Record<string, number | string | boolean | { error: string }>;
  formulas: string[];
  [key: string]: unknown;
}
const expectOf = (name: string): Expect => JSON.parse(readFileSync(join(DIR, `${name}.expect.json`), 'utf8')) as Expect;

const GENERATED = readdirSync(DIR)
  .filter((f) => f.endsWith('.xlsx'))
  .sort();
const REAL = (JSON.parse(readFileSync(join(DIR, 'real', 'manifest.json'), 'utf8')) as { files: { file: string; sha256: string; kind: string; producer: string; upstream: string; bytes: number }[] }).files;

/** `Sheet!B3` to the value the engine holds there. */
function valueAt(book: Book, ref: string): number | string | boolean | { error: string } | null {
  const bang = ref.lastIndexOf('!');
  const sheet = book.sheets.find((s) => s.name === ref.slice(0, bang));
  const m = /^([A-Z]+)(\d+)$/.exec(ref.slice(bang + 1));
  if (!sheet || !m) throw new Error(`No such cell as ${ref}`);
  const row = sheet.rows[Number(m[2]) - 1];
  const col = sheet.cols[lettersToCol(m[1]!)];
  if (!row || !col) return null;
  const v = book.engine.getValue(sheet.id, row, col);
  return v instanceof CellError ? { error: v.code } : v;
}

/** JSON with the keys in order, so two objects that are equal read as equal strings. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const ERROR_TEXT = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)$/;

function same(got: unknown, want: unknown): boolean {
  // A program that writes an error into a formula's cache as text means the error.
  if (typeof want === 'string' && ERROR_TEXT.test(want) && typeof got === 'object' && got !== null) return (got as { error: string }).error === want;
  if (typeof want === 'number' && typeof got === 'number') return Math.abs(got - want) <= 1e-8 * Math.max(1, Math.abs(want));
  if (typeof want === 'object' && want !== null) return typeof got === 'object' && got !== null && (got as { error: string }).error === (want as { error: string }).error;
  return got === want;
}

async function importOf(file: string) {
  const out = await readXlsx(bytes(file));
  return { ...out, book: openBook(out.seed), dump: dumpWorkbook(out.seed) };
}

const generated = (name: string) => importOf(join(DIR, name));
const sheetOf = (d: WorkbookDump, name: string): SheetDump => d.sheets.find((s) => s.name === name)!;

describe('the corpus is what its manifest says', () => {
  it('has every real file, with the hash that was recorded', () => {
    expect(REAL.length).toBeGreaterThanOrEqual(30);
    for (const f of REAL) {
      const data = readFileSync(join(DIR, 'real', f.file));
      expect(createHash('sha256').update(data).digest('hex'), f.file).toBe(f.sha256);
      expect(data.length, f.file).toBe(f.bytes);
    }
  });

  it('has a generated workbook and its expectations for every family of features', () => {
    expect(GENERATED.length).toBe(12);
    for (const f of GENERATED) expect(() => expectOf(f.replace(/\.xlsx$/, '')), f).not.toThrow();
  });
});

describe('generated: what the engine calculates is what the file says', () => {
  for (const file of GENERATED) {
    const name = file.replace(/\.xlsx$/, '');
    it(`${name}: every value and formula`, async () => {
      const { book, dump } = await generated(file);
      const want = expectOf(name);
      const wrong: string[] = [];
      for (const [ref, value] of Object.entries(want.values)) {
        const got = valueAt(book, ref);
        if (!same(got, value)) wrong.push(`${ref}: want ${JSON.stringify(value)}, got ${JSON.stringify(got)}`);
      }
      expect(wrong, wrong.join('\n')).toEqual([]);
      // A cell the expectations call a formula is one: unless the engine has not the function and the file's value was kept.
      const kept = new Set((want.kept_as_values as string[] | undefined) ?? []);
      for (const ref of want.formulas) {
        const [sheet, cell] = [ref.slice(0, ref.lastIndexOf('!')), ref.slice(ref.lastIndexOf('!') + 1)];
        const hasFormula = sheetOf(dump, sheet).cells[cell]?.f !== undefined;
        expect(hasFormula, `${ref} is ${kept.has(ref) ? 'kept as a value' : 'a formula'}`).toBe(!kept.has(ref));
      }
    });
  }
});

describe('generated: each family of features', () => {
  it('01 values: numbers, text of every kind, booleans, dates, errors', async () => {
    const { dump, warnings } = await generated('01-values.xlsx');
    const s = sheetOf(dump, 'Values');
    expect(s.cells.B14).toEqual({ v: '=not a formula' });
    expect(s.cells.B7).toEqual({ v: '007' });
    expect(s.cells.F1).toEqual({ v: '123' });
    expect(s.cells.D1!.style).toEqual({ numFmt: 'yyyy-mm-dd' });
    expect(s.cells.D3!.style).toEqual({ numFmt: 'h:mm AM/PM' });
    expect(s.cells.E3).toEqual({ e: '#REF!' });
    expect(warnings).toEqual([]);
  });

  it('02 formulas: a function the engine lacks keeps the file\'s value and says so; the rest stay formulas', async () => {
    const { dump, warnings } = await generated('02-formulas.xlsx');
    const c = sheetOf(dump, 'Calc').cells;
    expect(c.M1).toEqual({ v: 42 });
    expect(c.D1!.f).toBe('=SUM(A1:A5)');
    expect(c.E7!.f).toBe('=IFS(A1>100,"a",A1>5,"b",TRUE,"c")');
    expect(c.J3!.f).toBe("='Q1 ''24'!A1*'Q1 ''24'!B1");
    expect(c.K5!.f).toBe('=K4+A5');
    expect(warnings.map((w) => w.message)).toEqual(['Formulas that use LAMBDA, INDIRECT were kept as values.']);
  });

  it('03 formats: each format is the one the file names', async () => {
    const { dump, warnings } = await generated('03-formats.xlsx');
    const want = expectOf('03-formats').styles as Record<string, Record<string, unknown>>;
    const s = sheetOf(dump, 'Formats');
    const near = (a: unknown, b: unknown) => {
      if (typeof b === 'string' && b.startsWith('near:')) {
        const x = [1, 3, 5].map((i) => parseInt(String(a).slice(i, i + 2), 16));
        const y = [1, 3, 5].map((i) => parseInt(b.slice(6 + i - 1, 6 + i + 1), 16));
        return x.every((v, i) => Math.abs(v - y[i]!) <= 3);
      }
      return stable(a) === stable(b);
    };
    for (const [ref, style] of Object.entries(want)) {
      const got = (s.cells[ref.slice(ref.indexOf('!') + 1)]?.style ?? {}) as Record<string, unknown>;
      expect(Object.keys(got).sort(), ref).toEqual(Object.keys(style).sort());
      for (const [k, v] of Object.entries(style)) expect(near(got[k], v), `${ref}.${k}: ${JSON.stringify(got[k])} against ${JSON.stringify(v)}`).toBe(true);
    }
    const cols = expectOf('03-formats').column_styles as Record<string, Record<string, unknown>>;
    expect(s.colStyles[7]).toEqual(cols['Formats!H']);
    const rows = Object.entries(expectOf('03-formats').row_styles as Record<string, Record<string, unknown>>);
    const [rowRef, rowStyle] = rows[0]!;
    expect(s.rowStyles[Number(rowRef.slice(rowRef.indexOf('!') + 1)) - 1]).toEqual(rowStyle);
    expect(warnings.map((w) => w.message)).toEqual(['Gradient fills were left out.']);
  });

  it('04 layout: sizes, hidden lines, frozen panes, merges, tab colours, sheet order', async () => {
    const { dump } = await generated('04-layout.xlsx');
    const want = expectOf('04-layout').layout as Record<string, Record<string, unknown>>;
    expect(dump.sheets.map((s) => s.name)).toEqual(expectOf('04-layout').order);
    const sizes = sheetOf(dump, 'Sizes');
    expect(sizes.widths).toEqual({ 0: 140, 2: 63, 5: 280 });
    expect(sizes.hiddenCols).toEqual(want.Sizes!.hiddenCols);
    expect(sizes.heights).toEqual({ 1: 80, 5: 48 });
    expect(sizes.hiddenRows).toEqual(want.Sizes!.hiddenRows);
    expect(sizes.merges).toEqual([...(want.Sizes!.merges as string[])].sort());
    expect(sizes.tab).toBe('#22c55e');
    expect(sheetOf(dump, 'Rows frozen').frozen).toEqual([2, 0]);
    expect(sheetOf(dump, 'Columns frozen').frozen).toEqual([0, 2]);
    expect(sheetOf(dump, 'Both frozen').frozen).toEqual([1, 1]);
    expect(sheetOf(dump, 'Hidden sheet').hidden).toBe(true);
    // The file's theme colour is the colour its theme gives it (Office 2007's Accent 1 is 4F81BD).
    expect(sheetOf(dump, 'Rows frozen').tab).toBe('#4f81bd');
    // Row 5 was 15 points, Excel's own default, and says nothing. The borders of a merged area are its cells' own.
    expect(sizes.cells.A8!.style).toMatchObject({ borderTop: { line: 'medium' }, borderLeft: { line: 'medium' }, borderBottom: { line: 'medium' } });
    expect(sizes.cells.C8!.style).toMatchObject({ borderRight: { line: 'medium' } });
  });

  it('05 names: workbook names, constants, formulas, and a sheet\'s own', async () => {
    const { dump } = await generated('05-names.xlsx');
    const want = expectOf('05-names').names as { name: string; scope: string | null; text: string }[];
    expect(dump.names).toEqual([...want].sort((a, b) => (a.name + (a.scope ?? '')).localeCompare(b.name + (b.scope ?? ''))));
  });

  it('06 validation: lists, ranges, numbers, dates, formulas, whole columns', async () => {
    const { dump } = await generated('06-validation.xlsx');
    const want = expectOf('06-validation').validations as unknown[];
    const got = sheetOf(dump, 'Rules').validations;
    expect(got).toEqual([...want].sort((a, b) => ((a as { ranges: string[] }).ranges[0]! < (b as { ranges: string[] }).ranges[0]! ? -1 : 1)));
  });

  it('07 conditional formats: the kinds with an equivalent, in priority order, and a count of the rest', async () => {
    const { dump, warnings } = await generated('07-conditional.xlsx');
    const want = (expectOf('07-conditional').cf as Record<string, { ranges: string[]; when: unknown; style?: unknown }[]>).Rules!;
    const got = sheetOf(dump, 'Rules').cf;
    expect(got.length).toBe(want.length);
    const key = (r: { ranges: string[]; when: unknown }) => stable([r.ranges, r.when]);
    expect(got.map(key).sort()).toEqual(want.map(key).sort());
    for (const w of want.filter((x) => x.style)) expect(got.find((g) => key(g) === key(w))!.style, key(w)).toEqual(w.style);
    expect(warnings.map((w) => w.message)).toEqual(['1 conditional format drawn as icons was left out.']);
  });

  it('08 large: 20,000 rows and 40,000 formulas, and a running total that comes out right', async () => {
    const started = performance.now();
    const { dump, book } = await generated('08-large.xlsx');
    expect(performance.now() - started, 'import time').toBeLessThan(15_000);
    const s = sheetOf(dump, 'Ledger');
    expect(s.cells.E20000!.f).toBe('=E19999+D20000');
    expect(s.cells.F1!.style).toEqual({ numFmt: 'dd/mm/yyyy' });
    expect(Object.keys(s.cells).length).toBeGreaterThan(110_000);
    expect(valueAt(book, 'Ledger!H1')).toBeCloseTo(expectOf('08-large.xlsx'.replace('.xlsx', '')).values['Ledger!H1'] as number, 6);
  });

  it('09 unicode: sheet names with spaces, accents, quotes and kanji, referred to from formulas; very long text', async () => {
    const { dump, book } = await generated('09-unicode-names.xlsx');
    expect(dump.sheets.map((s) => s.name)).toEqual(expectOf('09-unicode-names').order);
    expect(sheetOf(dump, 'Données été').cells.B1!.f).toBe("='Año 2024'!A1+日本語!A1+'A&B (copy)'!A1+'x y'!A1");
    expect(valueAt(book, 'Données été!C2')).toHaveLength(32767);
  });

  it('10 filter and table: the filter\'s range and the rows it hid, and a table kept as cells', async () => {
    const { dump, warnings } = await generated('10-filter-table.xlsx');
    expect(sheetOf(dump, 'Filtered').filter).toBe('A1:C6');
    expect(sheetOf(dump, 'Filtered').hiddenRows).toEqual([2, 4, 5]);
    expect(sheetOf(dump, 'Table').cells.B3).toEqual({ v: 'blue' });
    expect(warnings.map((w) => w.message)).toEqual(
      expect.arrayContaining(['A filter\'s criteria were left out. The rows it hides stay hidden.', '1 table was kept as plain cells.'])
    );
  });

  it('11 the 1904 date system: the same dates', async () => {
    const { book, warnings } = await generated('11-date1904.xlsx');
    const want = expectOf('11-date1904').values;
    for (const [ref, v] of Object.entries(want)) expect(same(valueAt(book, ref), v), ref).toBe(true);
    expect(warnings.map((w) => w.message)).toEqual(['Dates were converted from the 1904 date system.']);
  });

  it('12 what a file carries: a chart, links and a note are counted, and the cells they sit on are kept', async () => {
    const { dump, warnings } = await generated('12-chart-links-notes.xlsx');
    expect(sheetOf(dump, 'Carried').cells.C2).toEqual({ v: 'script' });
    expect(JSON.stringify(dump)).not.toMatch(/javascript:|example\.com|mailto:/);
    expect(warnings.map((w) => w.message)).toEqual(
      expect.arrayContaining(['1 chart was left out.', 'Links in 4 cells were left out.', 'Comments and notes were left out.'])
    );
  });
});

describe('real: what the engine calculates is what Excel and LibreOffice cached', () => {
  /** The cached results in the file, by cell, read by ExcelJS from the package as the reader sanitises it. */
  async function cached(file: string) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(openXlsx(bytes(file)).excelBytes));
    const out = new Map<string, unknown>();
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.type !== 6) return;
          let v = (cell as unknown as { result?: unknown }).result;
          if (v instanceof Date) v = v.getTime() / 86_400_000 + 25_569;
          if (v && typeof v === 'object' && 'error' in v) v = { error: (v as { error: string }).error };
          if (typeof v === 'number' && Number.isNaN(v)) return;
          if (v !== undefined) out.set(`${ws.name}!${cell.address}`, v);
        })
      )
    );
    return out;
  }

  /** Cells whose answer is the clock's or the dice's. */
  const VOLATILE = /\b(?:NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY)\(/;

  async function agreement(file: string) {
    const { book } = await importOf(file);
    const want = await cached(file);
    let formulas = 0;
    let agree = 0;
    const wrong: string[] = [];
    for (const s of book.sheets) {
      for (const c of book.cells.get(s.id) ?? []) {
        if (c.content.f === undefined) continue;
        const text = book.engine.displayFormula(s.id, c.row, c.col) ?? '';
        if (VOLATILE.test(text)) continue;
        const key = `${s.name}!${colName(c.c)}${c.r + 1}`;
        if (!want.has(key)) continue;
        formulas++;
        const v = book.engine.getValue(s.id, c.row, c.col);
        const got = v instanceof CellError ? { error: v.code } : v;
        const w = want.get(key);
        if (same(got, w) || (w === '' && got === null)) agree++;
        else if (wrong.length < 5) wrong.push(`${key} ${text}: want ${JSON.stringify(w)}, got ${JSON.stringify(got)}`);
      }
    }
    return { formulas, agree, wrong };
  }

  for (const f of REAL.filter((x) => x.kind === 'calc')) {
    it(`${f.file} (${f.producer}): every formula comes to the cached answer`, async () => {
      const { formulas, agree, wrong } = await agreement(join(DIR, 'real', f.file));
      expect(formulas).toBeGreaterThan(5);
      expect(wrong, wrong.join('\n')).toEqual([]);
      expect(agree).toBe(formulas);
    });
  }

  // How many of these the engine gets right today. The numbers only go up: a drop is a regression, a rise is good news to write here.
  const KNOWN: Record<string, number> = { 'XLOOKUP.xlsx': 371, 'HVLOOKUP.xlsx': 101, 'DAYS_DAYS360.xlsx': 124, 'SUMIF_AVERAGE_IF.xlsx': 36 };
  for (const f of REAL.filter((x) => x.kind === 'gaps')) {
    it(`${f.file}: at least ${KNOWN[f.file]} of its formulas agree`, async () => {
      const { agree } = await agreement(join(DIR, 'real', f.file));
      expect(agree).toBeGreaterThanOrEqual(KNOWN[f.file]!);
    });
  }
});

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

describe('real: features as the programs that make them write them', () => {
  it('freeze.xlsx and split.xlsx: a frozen pane is frozen, a split is not', async () => {
    const frozen = (await importOf(join(DIR, 'real', 'freeze.xlsx'))).dump.sheets[0]!;
    expect(frozen.frozen[0] + frozen.frozen[1]).toBeGreaterThan(0);
    const split = (await importOf(join(DIR, 'real', 'split.xlsx'))).dump.sheets[0]!;
    expect(split.frozen).toEqual([0, 0]);
  });

  it('custom_theme_colors.xlsx: a theme colour is the file\'s theme\'s', async () => {
    const { dump } = await importOf(join(DIR, 'real', 'custom_theme_colors.xlsx'));
    const colours = new Set<string>();
    for (const c of Object.values(dump.sheets[0]!.cells)) for (const k of ['fill', 'color'] as const) if (typeof c.style?.[k] === 'string') colours.add(c.style[k] as string);
    // Accent 1 of this theme is 18A303, which no Office theme has.
    expect([...colours].some((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect([...colours]).not.toContain('#4472c4');
  });

  it('cf_tests.xlsx: conditional formats of every kind Excel has', async () => {
    const { dump, warnings } = await importOf(join(DIR, 'real', 'cf_tests.xlsx'));
    const kinds = new Set(dump.sheets.flatMap((s) => s.cf.map((r) => (r.when as { kind: string }).kind)));
    for (const k of ['cell', 'text', 'formula', 'scale', 'top', 'average', 'duplicate', 'unique', 'bar']) expect(kinds.has(k), k).toBe(true);
    expect(warnings.map((w) => w.code)).toContain('cf-icons');
  });

  it('libreoffice_888_example.xlsx: a workbook LibreOffice saved, with its chart counted', async () => {
    const { warnings, dump } = await importOf(join(DIR, 'real', 'libreoffice_888_example.xlsx'));
    expect(dump.sheets.length).toBeGreaterThan(0);
    expect(warnings.map((w) => w.message).join(' ')).toMatch(/chart/);
  });

  it('missing_r_on_row.xlsx: rows and cells that do not say where they are', async () => {
    const { dump } = await importOf(join(DIR, 'real', 'missing_r_on_row.xlsx'));
    expect(Object.keys(dump.sheets[0]!.cells).length).toBeGreaterThan(0);
  });

  it('example.xlsx: comments, tables, a pivot table and ten sheets, kept as cells', async () => {
    const { dump, warnings } = await importOf(join(DIR, 'real', 'example.xlsx'));
    expect(dump.sheets.length).toBe(10);
    expect(warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['notes', 'tables']));
  });

  it('invoice.xlsx: names, a hidden sheet, formats; the whole document', async () => {
    const { dump } = await importOf(join(DIR, 'real', 'invoice.xlsx'));
    expect(dump.names.map((n) => n.name)).toEqual(expect.arrayContaining(['CompanyName', 'IBAN', 'VatRate']));
    expect(dump.sheets.filter((s) => s.hidden).map((s) => s.name)).toEqual(['METADATA']);
  });
});

describe('the round trip: import, export, import again, and the two workbooks are one', () => {
  const VOLATILE = /\b(?:NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY)\(/;
  /** A workbook without the cells whose value is the clock's. */
  function steady(d: WorkbookDump): WorkbookDump {
    return {
      ...d,
      sheets: d.sheets.map((s) => ({
        ...s,
        cells: Object.fromEntries(Object.entries(s.cells).filter(([, c]) => !(c.f && VOLATILE.test(c.f)))),
        // A rule written as a formula about today is the same rule.
        cf: s.cf.map((r) => r)
      }))
    };
  }

  const all = [...GENERATED.map((f) => join(DIR, f)), ...REAL.map((f) => join(DIR, 'real', f.file))];
  for (const file of all) {
    const label = file.slice(DIR.length + 1);
    it(label, async () => {
      const first = await readXlsx(bytes(file));
      const written = await writeXlsx(first.seed, { title: label });
      const again = await readXlsx(written.bytes);
      expect(steady(dumpWorkbook(again.seed))).toEqual(steady(dumpWorkbook(first.seed)));
      // Nothing is said to have been left out of a file that came from here.
      expect(again.warnings.filter((w) => !['unread', 'functions'].includes(w.code))).toEqual([]);
    }, 60_000);
  }
});

describe('hostile files are refused', () => {
  const refusal = async (file: string) => {
    try {
      await readXlsx(bytes(file));
    } catch (e) {
      if (isFormatError(e)) return { code: e.code, message: e.message };
      throw e;
    }
    return null;
  };

  it('zip-bomb.xlsx: 72 KiB that declare 72 MiB', async () => {
    const data = bytes(join(DIR, 'hostile', 'zip-bomb.xlsx'));
    expect(data.length).toBeLessThan(100_000);
    expect(await refusal(join(DIR, 'hostile', 'zip-bomb.xlsx'))).toEqual({ code: 'zip_limit', message: 'That file is too large to open.' });
  });

  it('entity-declaration.xlsx: a DOCTYPE with the billion laughs and a file on the reader\'s disk', async () => {
    expect(await refusal(join(DIR, 'hostile', 'entity-declaration.xlsx'))).toEqual({ code: 'xml_unsafe', message: 'That file could not be opened.' });
  });
});
