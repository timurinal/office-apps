/**
 * ExcelJS, loaded on first use.
 *
 * It is a quarter of a megabyte gzipped and only a spreadsheet needs it, so nothing imports it
 * but this, and this is called after everything that can refuse a file has had its say. A
 * dynamic import is also a chunk of its own, which is what keeps it out of the first load of
 * the editor and of Home.
 */

import type ExcelJS from 'exceljs';

export type ExcelJSModule = typeof ExcelJS;

let loading: Promise<ExcelJSModule> | null = null;

export function loadExcel(): Promise<ExcelJSModule> {
  loading ??= import('exceljs').then((m) => ((m as unknown as { default?: ExcelJSModule }).default ?? (m as unknown as ExcelJSModule)));
  return loading;
}
