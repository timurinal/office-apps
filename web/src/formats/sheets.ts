/**
 * The spreadsheet formats and what a name says about a file: the parts of `importSheets.ts` and
 * `exportSheets.ts` that the page can know without loading a single converter, as `formats.ts`
 * is for documents.
 */

export type SheetFormat = 'xlsx' | 'csv' | 'tsv';

/** Formats a sheet is saved as. */
export type SheetExportFormat = SheetFormat;

export const SHEET_EXPORT_FORMATS: Record<SheetExportFormat, { label: string; extension: string; mime: string }> = {
  xlsx: { label: 'Workbook (.xlsx)', extension: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { label: 'Comma-separated values (.csv)', extension: 'csv', mime: 'text/csv;charset=utf-8' },
  tsv: { label: 'Tab-separated values (.tsv)', extension: 'tsv', mime: 'text/tab-separated-values;charset=utf-8' }
};

const BY_EXTENSION: Record<string, SheetFormat> = { xlsx: 'xlsx', csv: 'csv', tsv: 'tsv' };

/** What a file is, by its extension, if a spreadsheet can be made of it. */
export function sheetFormatOf(fileName: string): SheetFormat | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : (BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null);
}
