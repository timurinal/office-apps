/** What the page and the import worker say to each other. */

import type { FormatErrorCode } from '../errors';
import type { ImportOutcome } from '../import';

export interface WorkerRequest {
  id: number;
  name: string;
  bytes: Uint8Array;
}

export type ImportReply = Omit<ImportOutcome, 'state'>;

export type WorkerReply =
  | { id: number; ok: true; out: ImportReply }
  | { id: number; ok: false; code: FormatErrorCode; message: string };

export interface ExportRequest {
  id: number;
  format: import('../formats').ExportFormat;
  model: import('../types').DocModel;
  title: string;
  origin: string;
  now: number;
  /** Pictures by the `src` the model uses. */
  images: Record<string, import('../types').ImageData>;
  comments: import('../types').ExportComment[];
}

export type ExportReply =
  | { id: number; ok: true; bytes: Uint8Array; mime: string; extension: string; warnings: import('../types').Warning[] }
  | { id: number; ok: false; message: string };

// ── spreadsheets ────────────────────────────────────────────────────────────

/** What the page and the spreadsheet import worker say to each other. */
export interface SheetsWorkerRequest {
  id: number;
  name: string;
  bytes: Uint8Array;
  /** How a short date reads where the file does not say; day first when absent. */
  dateOrder?: import('../../sheets/engine').DateOrder;
}

export type SheetsWorkerReply =
  | { id: number; ok: true; out: import('../importSheets').SheetImportOutcome }
  | { id: number; ok: false; code: FormatErrorCode; message: string };

/**
 * A workbook to be written. The cells travel as the cell list (`encodeCellList`), one buffer that is
 * moved and not copied, because a workbook of 400,000 cells is that many objects to structured-clone.
 */
export interface SheetsExportRequest {
  id: number;
  format: import('../sheets').SheetExportFormat;
  state: Uint8Array;
  cells: Uint8Array;
  title: string;
  now: number;
  sheetId: string | null;
  bom: boolean;
}

export type SheetsExportReply =
  | { id: number; ok: true; bytes: Uint8Array; mime: string; extension: string; warnings: import('../types').Warning[] }
  | { id: number; ok: false; message: string };
