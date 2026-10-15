/**
 * File > Download for a spreadsheet, from the open page.
 *
 *     downloadXlsx({ file: () => model.export(), title, activeSheetId, notify });
 *
 * The page hands over the workbook as the model saves it, and the export worker (loaded now, not before)
 * calculates it and builds the file. The result is saved through a link with a `download` attribute:
 * nothing is uploaded and nothing waits on the server. A csv or tsv holds one sheet, the one on the
 * screen, and says so when the workbook has others.
 */

import { errorText } from '../../api';
import type { Toast } from '../../core/ui';
import type { SheetFile } from '../../sheets/model/source';
import { SHEET_EXPORT_FORMATS, type SheetExportFormat } from '../sheets';
import { fileNameOf, save } from './saveFile';
import { buildSheetFile } from './sheetsExportClient';

export interface SheetDownloadHost {
  /** The workbook as it is now: the model's `export()`. */
  file: () => SheetFile;
  title: string;
  /** The sheet on the screen, for a csv or tsv. The first that is shown when null. */
  activeSheetId: string | null;
  notify: (toast: Toast) => void;
}

export interface SheetDownloadOptions {
  /** A byte order mark at the head of a csv, which Excel needs to read accented letters; other tools show it as a stray character. */
  bom?: boolean;
}

export async function downloadSheet(host: SheetDownloadHost, format: SheetExportFormat, opts: SheetDownloadOptions = {}): Promise<void> {
  try {
    const { state, cells } = host.file();
    const file = await buildSheetFile({ format, state, cells, title: host.title, sheetId: host.activeSheetId, bom: opts.bom ?? false });
    const name = fileNameOf(host.title, SHEET_EXPORT_FORMATS[format].extension);
    save(file.bytes, file.mime, name);
    const first = file.warnings[0];
    host.notify({ text: first ? `Saved ${name}. ${first.message}` : `Saved ${name}.` });
  } catch (err) {
    host.notify({ text: errorText(err, 'Could not make that file.'), tone: 'danger' });
  }
}

export const downloadXlsx = (host: SheetDownloadHost): Promise<void> => downloadSheet(host, 'xlsx');
export const downloadCsv = (host: SheetDownloadHost, opts?: SheetDownloadOptions): Promise<void> => downloadSheet(host, 'csv', opts);
export const downloadTsv = (host: SheetDownloadHost): Promise<void> => downloadSheet(host, 'tsv');
