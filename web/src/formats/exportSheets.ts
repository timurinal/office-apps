/**
 * A workbook to a file: xlsx, csv or tsv.
 *
 *     const out = await exportSheet('xlsx', model.export(), { title });
 *
 * The workbook is what the model saves (`SheetFile`: the structure as a Yjs update and the cells
 * beside it), which is also what the room's `readDocument()` answers, so the page and the Worker
 * that exports for the assistant run the same code and a person gets the file the assistant would have made.
 * Nothing here touches the network or the DOM.
 */

import { field } from '../sheets/model/structure';
import { type Book, type BookFile, openBook } from './xlsx/book';
import { writeXlsx } from './xlsx/write';
import { sheetRows, writeCsv } from './csv/write';
import { SHEET_EXPORT_FORMATS, type SheetExportFormat } from './sheets';
import type { Warning } from './types';

export { SHEET_EXPORT_FORMATS, type SheetExportFormat } from './sheets';
export type { BookFile as SheetFileInput } from './xlsx/book';

export interface SheetExportOptions {
  title: string;
  /** Unix milliseconds: the date an xlsx says it was made. */
  now?: number;
  /** The sheet a csv or tsv holds: the one on the screen. The first that is shown when absent or gone. */
  sheetId?: string | null;
  /** A UTF-8 byte order mark at the head of a csv, so Excel reads it right. */
  bom?: boolean;
}

export interface SheetExportOutcome {
  bytes: Uint8Array;
  mime: string;
  extension: string;
  warnings: Warning[];
}

function chosenSheet(book: Book, id: string | null | undefined) {
  return book.sheets.find((s) => s.id === id) ?? book.sheets.find((s) => !field(s.map, 'hidden')) ?? book.sheets[0];
}

export async function exportSheet(format: SheetExportFormat, file: BookFile, opts: SheetExportOptions): Promise<SheetExportOutcome> {
  const meta = SHEET_EXPORT_FORMATS[format];
  if (format === 'xlsx') {
    const { bytes, warnings } = await writeXlsx(file, { title: opts.title, ...(opts.now !== undefined ? { now: opts.now } : {}) });
    return { bytes, mime: meta.mime, extension: meta.extension, warnings };
  }
  const book = openBook(file);
  const sheet = chosenSheet(book, opts.sheetId);
  const rows = sheet ? sheetRows(book, sheet) : [];
  const bytes = writeCsv(rows, { delimiter: format === 'tsv' ? '\t' : ',', ...(opts.bom ? { bom: true } : {}) });
  // A file of text holds one sheet.
  const warnings: Warning[] = book.sheets.length > 1 && sheet ? [{ code: 'one-sheet', message: `Only “${sheet.name}” is in it.`, count: 1 }] : [];
  return { bytes, mime: meta.mime, extension: meta.extension, warnings };
}
