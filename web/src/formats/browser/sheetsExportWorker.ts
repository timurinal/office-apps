/**
 * The spreadsheet export worker: a workbook in, a file out. Writing an xlsx opens the workbook in
 * the engine, calculates it, and hands every cell to ExcelJS, so it is loaded only when somebody downloads.
 */

import { decodeCellList } from '@shared/cells';
import { exportSheet } from '../exportSheets';
import type { SheetsExportReply, SheetsExportRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SheetsExportRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (e) => {
  const { id, format, state, cells, title, now, sheetId, bom } = e.data;
  try {
    // The list was made by this page a moment ago; a list that does not read is a bug, not a file.
    const list = decodeCellList(cells, Number.MAX_SAFE_INTEGER);
    if (!list) throw new Error('The cell list does not read');
    const out = await exportSheet(format, { state, cells: list }, { title, now, sheetId, bom });
    const reply: SheetsExportReply = { id, ok: true, bytes: out.bytes, mime: out.mime, extension: out.extension, warnings: out.warnings };
    scope.postMessage(reply, [out.bytes.buffer as ArrayBuffer]);
  } catch (err) {
    console.error('[export]', err);
    const reply: SheetsExportReply = { id, ok: false, message: 'Could not make that file.' };
    scope.postMessage(reply);
  }
};
