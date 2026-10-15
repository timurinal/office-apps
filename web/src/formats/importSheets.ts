/**
 * A spreadsheet file to a new workbook: the entry point the page calls, as `import.ts` is for
 * documents.
 *
 *     const out = await importSheet('Budget.xlsx', bytes);
 *     await documents.create({ kind: 'sheets', title: out.title, state: out.stateBase64, cells: out.cellsBase64 });
 *
 * Everything is worked out here, off the main thread when the page calls it from its worker: the
 * file is read, the workbook is built with its formulas bound to row and column ids, the
 * room's caps are checked, and the result is the two base64 strings the create call takes.
 * Nothing is sent until the whole file has been accepted.
 */

import { sheetSeedRequest } from '../sheets/model/seed';
import type { DateOrder } from '../sheets/engine';
import { FormatError } from './errors';
import { MAX_FILE_BYTES } from './limits';
import { type SheetFormat, sheetFormatOf } from './sheets';
import type { Warning } from './types';
import { readCsv } from './csv/read';
import { readXlsx, type SheetImport } from './xlsx/read';

export interface SheetImportOutcome {
  title: string;
  format: SheetFormat;
  /** `POST /documents`' `state`: the structure as a Yjs update, base64. */
  stateBase64: string;
  /** `POST /documents`' `cells`: the cell list, base64. */
  cellsBase64: string;
  warnings: Warning[];
}

export interface SheetImportOptions {
  /** How a short date reads where the file does not say. */
  dateOrder?: DateOrder;
}

/** The file's name as a title: no extension, no path, no stray whitespace. */
export function sheetTitleOf(fileName: string, fromFile: string | null = null): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || fromFile?.trim() || 'Untitled').slice(0, 200);
}

export async function readSheetFile(fileName: string, bytes: Uint8Array, opts: SheetImportOptions = {}): Promise<{ format: SheetFormat; result: SheetImport }> {
  const format = sheetFormatOf(fileName);
  if (!format) throw new FormatError('unsupported');
  if (bytes.length === 0) throw new FormatError('empty');
  if (bytes.length > MAX_FILE_BYTES) throw new FormatError('too_large', `${bytes.length} bytes`);
  const title = sheetTitleOf(fileName);
  const dateOrder = opts.dateOrder;
  switch (format) {
    case 'xlsx':
      return { format, result: await readXlsx(bytes, dateOrder ? { dateOrder } : {}) };
    case 'csv':
    case 'tsv':
      return { format, result: readCsv(bytes, { ...(dateOrder ? { dateOrder } : {}), ...(format === 'tsv' ? { delimiter: '\t' } : {}), sheetName: title }) };
  }
}

export async function importSheet(fileName: string, bytes: Uint8Array, opts: SheetImportOptions = {}): Promise<SheetImportOutcome> {
  const { format, result } = await readSheetFile(fileName, bytes, opts);
  const { state, cells } = sheetSeedRequest(result.seed);
  return { title: sheetTitleOf(fileName, result.title), format, stateBase64: state, cellsBase64: cells, warnings: result.warnings };
}
