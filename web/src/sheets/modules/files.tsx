/**
 * Files: File > Export as Excel, CSV or tab-separated, and the same three in the Ctrl+K box.
 *
 * The rows are the whole module. The export worker and ExcelJS are not imported here: a click
 * loads them (`formats/browser/sheetsDownload`), so the editor opens without carrying a workbook
 * writer, and a person who never downloads never fetches one. The workbook is handed over as the
 * model saves it, so a download of a version being previewed is that version.
 *
 * A CSV or TSV holds one sheet, the one on the screen; the toast says so when the workbook has more.
 * Gated on `can.download`, the switch a link owner turns off for viewers.
 */

import { ph } from '../../core/icons';
import downloadSimpleRaw from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import fileCsvRaw from '@phosphor-icons/core/assets/regular/file-csv.svg?raw';
import fileTextRaw from '@phosphor-icons/core/assets/regular/file-text.svg?raw';
import fileXlsRaw from '@phosphor-icons/core/assets/regular/file-xls.svg?raw';
import type { Command, FileItem } from '../../core/shell/types';
import type { SheetExportFormat } from '../../formats/sheets';
import type { SheetsContext, SheetsModule } from './types';

const downloadIcon = ph(downloadSimpleRaw);

const FORMATS: { format: SheetExportFormat; label: string; title: string; icon: ReturnType<typeof ph>; keywords: string[] }[] = [
  { format: 'xlsx', label: 'Export as Excel (.xlsx)', title: 'Export as Excel', icon: ph(fileXlsRaw), keywords: ['xlsx', 'excel', 'export', 'save', 'download'] },
  { format: 'csv', label: 'Export as CSV (.csv)', title: 'Export as CSV', icon: ph(fileCsvRaw), keywords: ['csv', 'comma', 'export', 'save', 'download'] },
  { format: 'tsv', label: 'Export as tab-separated (.tsv)', title: 'Export as tab-separated', icon: ph(fileTextRaw), keywords: ['tsv', 'tab', 'export', 'save', 'download'] }
];

async function download(c: SheetsContext, format: SheetExportFormat): Promise<void> {
  // Loaded now, not before: the writer is the heaviest thing a workbook can ask for.
  const { downloadSheet } = await import('../../formats/browser/sheetsDownload');
  await downloadSheet(
    { file: () => c.model.export(), title: c.meta.title, activeSheetId: c.sheetId, notify: c.notify },
    format
  );
}

const allowed = (c: SheetsContext): boolean => c.can.download;

export const filesModule: SheetsModule = {
  id: 'files',
  ribbon: [],

  commands: FORMATS.map(
    (f): Command<SheetsContext> => ({
      id: `file.download-${f.format}`,
      title: f.title,
      section: 'File',
      icon: downloadIcon,
      keywords: f.keywords,
      visible: allowed,
      run: (c) => void download(c, f.format)
    })
  ),

  // The Export section's slot is 600 to 690 (types.ts); Docs' four rows start at 610 too.
  fileItems: FORMATS.map(
    (f, i): FileItem<SheetsContext> => ({
      id: `file.download-${f.format}`,
      label: f.label,
      icon: f.icon,
      section: 'Export',
      order: 610 + i * 10,
      visible: allowed,
      run: (c) => void download(c, f.format)
    })
  )
};
