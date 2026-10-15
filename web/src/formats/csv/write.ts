/**
 * A sheet's values as delimited text.
 *
 * What is written is the value, not what the cell shows: a number at full precision without a
 * thousands separator or a currency sign, a date as ISO 8601 (which every spreadsheet reads in every
 * locale), TRUE and FALSE, an error as its name, text as it is. A formula is its result.
 *
 * RFC 4180: fields with a delimiter, a quote or a line break in them are quoted, quotes doubled, and
 * lines end with CRLF. A byte order mark is offered because Excel opens a csv without one in the system's
 * code page and shows every accented letter wrong.
 *
 * Text that begins with `=`, `+`, `-` or `@` is a formula to a spreadsheet that opens the file, and
 * a sheet other people edit can hold anything. It is written with a leading apostrophe, which Excel
 * and Sheets both show as the text it is.
 */

import { type Scalar, CellError, isDateFormat, numberToText, serialToDate, serialToTime } from '../../sheets/engine';
import { FormatError } from '../errors';
import { part } from '../../sheets/model/structure';
import type { Book, BookSheet } from '../xlsx/book';

export interface CsvWriteOptions {
  delimiter: ',' | '\t';
  /** A UTF-8 byte order mark first, so Excel reads the file as UTF-8. */
  bom?: boolean;
}

/** Fields in one file: a few million is a file nobody opens, and a sparse sheet can ask for far more. */
const MAX_FIELDS = 5_000_000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A serial as ISO text: a date, a time of day, or both, by what the serial holds. */
function isoOf(serial: number): string {
  const whole = Math.floor(serial);
  const hasTime = serial !== whole;
  const time = serialToTime(serial);
  const t = `${pad(time.h)}:${pad(time.min)}:${pad(time.s)}`;
  if (serial >= 0 && serial < 1) return t;
  const d = serialToDate(serial);
  const date = `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`;
  return hasTime ? `${date} ${t}` : date;
}

const DANGEROUS = /^[=+@\t\r]|^-(?!\d[\d.,]*$)/;

/** One cell as its field's text. */
export function fieldText(v: Scalar, numFmt: string | undefined): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof CellError) return v.code;
  if (typeof v === 'number') return numFmt && isDateFormat(numFmt) && Number.isFinite(v) && v >= 0 ? isoOf(v) : numberToText(v);
  return DANGEROUS.test(v) ? `'${v}` : v;
}

/** A sheet as rows of fields, from the first row to the last that has anything in it, and as wide as its widest. */
export function sheetRows(book: Book, sheet: BookSheet): string[][] {
  const colStyleIds = part(sheet.map, 'colStyles');
  const rowStyleIds = part(sheet.map, 'rowStyles');
  const cells = book.cells.get(sheet.id) ?? [];
  let rows = 0;
  let cols = 0;
  for (const c of cells) {
    if (c.content.v === undefined && c.content.e === undefined && c.content.f === undefined) continue;
    if (c.r + 1 > rows) rows = c.r + 1;
    if (c.c + 1 > cols) cols = c.c + 1;
  }
  // A cell far out in a sheet that is otherwise empty would be millions of delimiters.
  if (rows * cols > MAX_FIELDS) throw new FormatError('sheet_too_large', `${rows} rows by ${cols} columns`);
  const out: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(''));
  for (const c of cells) {
    if (c.r >= rows || c.c >= cols) continue;
    const v = book.engine.getValue(sheet.id, c.row, c.col);
    const st = book.styles.effective(colStyleIds.get(c.col), rowStyleIds.get(c.row), c.content.s);
    out[c.r]![c.c] = fieldText(v, st.numFmt);
  }
  return out;
}

function quoted(field: string, delimiter: string): string {
  return field.includes(delimiter) || /["\r\n]/.test(field) || field.startsWith(' ') || field.endsWith(' ') ? `"${field.replace(/"/g, '""')}"` : field;
}

export function writeCsv(rows: readonly (readonly string[])[], opts: CsvWriteOptions): Uint8Array {
  const lines: string[] = [];
  // Trailing empty fields are kept: every row is as wide as the others, which a reader may count on.
  for (const r of rows) lines.push(r.map((f) => quoted(f, opts.delimiter)).join(opts.delimiter));
  const text = lines.length ? lines.join('\r\n') + '\r\n' : '';
  const body = new TextEncoder().encode(text);
  if (!opts.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}
