/** Building a spreadsheet file from the page: the export worker, or this thread where there is none. */

import { type CellOp, encodeCellList, decodeCellList } from '@shared/cells';
import type { SheetExportFormat } from '../sheets';
import type { Warning } from '../types';
import type { SheetsExportReply, SheetsExportRequest } from './protocol';

export interface BuiltSheetFile {
  bytes: Uint8Array;
  mime: string;
  extension: string;
  warnings: Warning[];
}

export interface BuildSheetInput {
  format: SheetExportFormat;
  state: Uint8Array;
  cells: readonly CellOp[];
  title: string;
  /** The sheet a csv or tsv holds. */
  sheetId: string | null;
  bom?: boolean;
}

let next = 0;

/** A workbook that cannot be written in this long is one the worker is stuck on, and the worker is what can be stopped. */
const TIMEOUT_MS = 120_000;

function inWorker(input: BuildSheetInput): Promise<BuiltSheetFile> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sheetsExportWorker.ts', import.meta.url), { type: 'module' });
    const id = ++next;
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('Could not make that file.'));
    }, TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<SheetsExportReply>) => {
      if (e.data.id !== id) return;
      done();
      if (e.data.ok) resolve({ bytes: e.data.bytes, mime: e.data.mime, extension: e.data.extension, warnings: e.data.warnings });
      else reject(new Error(e.data.message));
    };
    worker.onerror = () => {
      done();
      reject(new Error('Could not make that file.'));
    };
    const cells = encodeCellList(input.cells);
    const request: SheetsExportRequest = { id, format: input.format, state: input.state, cells, title: input.title, now: Date.now(), sheetId: input.sheetId, bom: !!input.bom };
    worker.postMessage(request, [cells.buffer as ArrayBuffer]);
  });
}

async function onThisThread(input: BuildSheetInput): Promise<BuiltSheetFile> {
  const { exportSheet } = await import('../exportSheets');
  // Through the cell list and back, as the worker does, so the two paths are one.
  const list = decodeCellList(encodeCellList(input.cells), Number.MAX_SAFE_INTEGER);
  if (!list) throw new Error('Could not make that file.');
  return exportSheet(input.format, { state: input.state, cells: list }, { title: input.title, now: Date.now(), sheetId: input.sheetId, bom: !!input.bom });
}

export function buildSheetFile(input: BuildSheetInput): Promise<BuiltSheetFile> {
  return typeof Worker !== 'undefined' && !import.meta.env.DEV ? inWorker(input) : onThisThread(input);
}
