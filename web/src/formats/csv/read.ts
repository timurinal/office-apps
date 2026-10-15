/**
 * A csv or tsv file into a workbook seed: one sheet, its cells typed the way typing them would.
 *
 * Every field goes through the engine's `parseValue`, so `12%`, `£4.50`, `3/4/2024` and `TRUE`
 * are what they would be typed into a cell, and a date shows back as the date it was. Two
 * things are kept as text that `parseValue` would turn into numbers, because turning them
 * loses what the file said: a number with a leading zero (`007`, a postcode, an id) and a run of
 * sixteen or more digits (a card, an account), which a double cannot hold.
 *
 * A field is never a formula, whatever it begins with. A file that is opened as a spreadsheet and
 * runs what it contains is an attack, not a feature, and `parseValue` does not make formulas.
 */

import { type DateOrder, parseValue } from '../../sheets/engine';
import { CELL_LIMITS } from '@shared/cells';
import { NEW_SHEET_COLS, NEW_SHEET_ROWS } from '../../sheets/model/structure';
import { type SeedCell, SheetSeedTooLarge, buildSheetSeed } from '../../sheets/model/seed';
import { FormatError } from '../errors';
import { MAX_TEXT_BYTES } from '../limits';
import { MAX_COLS, MAX_ROWS } from '../../sheets/engine';
import type { SheetImport } from '../xlsx/read';
import { detectDelimiter, parseCsv } from './parse';

export interface CsvReadOptions {
  /** Which character separates fields; found from the text when absent (a `.tsv` is told). */
  delimiter?: string;
  /** How `3/4/2024` reads; day first unless told. */
  dateOrder?: DateOrder;
  /** The sheet's name; "Sheet1" when absent. */
  sheetName?: string;
}

/** The text of a file: UTF-8 or UTF-16 by its byte order mark, UTF-8 where it is valid and Windows-1252 where it is not. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length > MAX_TEXT_BYTES) throw new FormatError('too_large', `${bytes.length} bytes of text`);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    // Excel on Windows saves a csv in the system's code page. In Western Europe that is this one.
    return new TextDecoder('windows-1252').decode(body);
  }
}

/** A sheet name Excel would take: 31 characters, none of `\ / ? * [ ] :`. */
export function sheetNameOf(name: string | undefined): string {
  return (name ?? '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31) || 'Sheet1';
}

const LEADING_ZERO = /^[+-]?0\d+(?:\.\d*)?$/;
const LONG_DIGITS = /^[+-]?\d{16,}$/;
const DECIMAL_COMMA = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d+$/;
const DECIMAL_POINT = /^[+-]?\d+\.\d+$/;

/** Whether the numbers in these rows write their decimals with a comma: some do, and none with a point. */
function usesDecimalComma(rows: readonly string[][]): boolean {
  let comma = false;
  for (const r of rows.slice(0, 200)) {
    for (const f of r) {
      const t = f.trim();
      if (DECIMAL_POINT.test(t)) return false;
      if (DECIMAL_COMMA.test(t)) comma = true;
    }
  }
  return comma;
}

function seedCell(field: string, order: DateOrder, decimalComma: boolean, formats: Map<string, { numFmt: string }>): SeedCell | null {
  if (field === '') return null;
  const t = field.trim();
  // An apostrophe is how a cell is typed to stay text; in a file it is just an apostrophe.
  if (field.startsWith("'") || LEADING_ZERO.test(t) || LONG_DIGITS.test(t)) return { value: field.slice(0, CELL_LIMITS.textChars) };
  const text = decimalComma && DECIMAL_COMMA.test(t) ? t.replace(/\./g, '').replace(',', '.') : field;
  const { content, format } = parseValue(text, order);
  if (!content) return null;
  const cell: SeedCell = content.e !== undefined ? { error: content.e } : content.v !== undefined ? { value: typeof content.v === 'string' ? content.v.slice(0, CELL_LIMITS.textChars) : content.v } : {};
  if (format) {
    let style = formats.get(format);
    if (!style) formats.set(format, (style = { numFmt: format }));
    cell.style = style;
  }
  return cell;
}

export function readCsv(bytes: Uint8Array, opts: CsvReadOptions = {}): SheetImport {
  if (bytes.length === 0) throw new FormatError('empty');
  let text = decodeText(bytes);
  let delimiter = opts.delimiter;
  // Excel's own hint, a first line of `sep=;`.
  const hint = /^sep=(.)\r?\n/i.exec(text);
  if (hint) {
    delimiter ??= hint[1]!;
    text = text.slice(hint[0].length);
  }
  delimiter ??= detectDelimiter(text);
  const rows = parseCsv(text, delimiter, { rows: MAX_ROWS, cols: MAX_COLS, cells: CELL_LIMITS.cellsPerDocument });
  if (rows.length === 0) throw new FormatError('empty');
  const order = opts.dateOrder ?? 'dmy';
  const decimalComma = delimiter === ';' && usesDecimalComma(rows);
  const formats = new Map<string, { numFmt: string }>();

  let seed;
  try {
    seed = buildSheetSeed((b) => {
      let usedRows = 0;
      let usedCols = 0;
      const sheet = b.addSheet(sheetNameOf(opts.sheetName));
      rows.forEach((fields, r) => {
        fields.forEach((field, c) => {
          const cell = seedCell(field, order, decimalComma, formats);
          if (!cell) return;
          sheet.cell(r, c, cell);
          if (r + 1 > usedRows) usedRows = r + 1;
          if (c + 1 > usedCols) usedCols = c + 1;
        });
      });
      sheet.rows = Math.max(sheet.rows, usedRows >= NEW_SHEET_ROWS ? usedRows + 100 : NEW_SHEET_ROWS);
      sheet.cols = Math.max(sheet.cols, usedCols >= NEW_SHEET_COLS ? usedCols + 2 : NEW_SHEET_COLS);
    });
  } catch (e) {
    if (e instanceof SheetSeedTooLarge) throw new FormatError('sheet_too_large', `${e.what}: ${e.size} of ${e.limit}`);
    throw e;
  }
  return { seed, title: null, warnings: [] };
}
