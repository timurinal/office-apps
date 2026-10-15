/**
 * Delimited text, read the way RFC 4180 writes it and the way Excel writes it.
 *
 * A field is quoted when it begins with a quote; inside, a doubled quote is a quote and
 * the delimiter and line breaks are text. Outside, a quote is a character like any other, and a
 * quoted field followed by more text keeps the text, because that is what a file made by hand has.
 * A line ends with CRLF, LF or CR. A file's last line may or may not end with one, and when it
 * does not, no empty row follows it.
 *
 * The reader stops at the limits it is given: it is a stranger's text and the number of rows and
 * columns it claims is whatever the stranger likes.
 */

import { FormatError } from '../errors';

export interface CsvLimits {
  rows: number;
  cols: number;
  /** Fields that are not empty. */
  cells: number;
}

/** The delimiters tried, in the order that wins a tie. */
const CANDIDATES = [',', ';', '\t', '|'] as const;

export function parseCsv(text: string, delimiter: string, limits: CsvLimits): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cells = 0;
  const n = text.length;
  let i = 0;

  const push = (field: string) => {
    if (field !== '') {
      if (++cells > limits.cells) throw new FormatError('sheet_too_large', `${cells} cells`);
    }
    if (row.length >= limits.cols) throw new FormatError('sheet_too_large', `${row.length + 1} columns`);
    row.push(field);
  };
  const endRow = () => {
    if (rows.length >= limits.rows) throw new FormatError('sheet_too_large', `${rows.length + 1} rows`);
    rows.push(row);
    row = [];
  };

  while (i < n) {
    // One field.
    let field = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) {
          // Never closed: the rest of the file is this field.
          field += text.slice(i);
          i = n;
          break;
        }
        field += text.slice(i, q);
        if (text[q + 1] === '"') {
          field += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      // Text after the closing quote belongs to the field.
      const start = i;
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
      field += text.slice(start, i);
    } else {
      const start = i;
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
      field = text.slice(start, i);
    }
    push(field);
    if (i >= n) break;
    const c = text[i];
    if (c === delimiter) {
      i++;
      // A delimiter at the very end opens one more, empty, field.
      if (i >= n) push('');
    } else {
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      endRow();
    }
  }
  if (row.length) endRow();
  return rows;
}

/** The delimiter a file uses, from its first lines. A comma when nothing else is clearly right. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  const limits: CsvLimits = { rows: 30, cols: 4096, cells: 1_000_000 };
  let best: string = ',';
  let bestScore = 0;
  for (const d of CANDIDATES) {
    let rows: string[][];
    try {
      rows = parseCsv(sample, d, limits);
    } catch {
      continue;
    }
    // The last line of a cut sample is probably cut.
    if (rows.length > 2 && sample.length === 64 * 1024) rows.pop();
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let width = 0;
    let agree = 0;
    for (const [w, count] of counts) {
      if (count > agree || (count === agree && w > width)) {
        width = w;
        agree = count;
      }
    }
    // Rows that agree on more than one column; more columns break a tie, because a wrong delimiter gives one.
    const score = width > 1 ? agree * 1000 + width : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}
