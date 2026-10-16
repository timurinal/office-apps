/**
 * Files: File > Download a copy, which lists a workbook, comma-separated values and tab-separated
 * values, each by what it is and its extension (core/formatNames.ts), and the same three in the
 * Ctrl+K box, where the old names of the formats still find them.
 *
 * The rows are the whole module. The export worker and ExcelJS are not imported here: a click
 * loads them (`formats/browser/sheetsDownload`), so the editor opens without carrying a workbook
 * writer, and a person who never downloads never fetches one. The workbook is handed over as the
 * model saves it, so a download of a version being previewed is that version.
 *
 * A CSV or TSV holds one sheet, the one on the screen; the toast says so when the workbook has more.
 * Gated on `can.download`, the switch a link owner turns off for viewers. A file on the computer is
 * saved through Save as instead (local/LocalDocument.tsx), so it has no Download.
 */

import { ph } from '../../core/icons';
import downloadSimpleRaw from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import fileCsvRaw from '@phosphor-icons/core/assets/regular/file-csv.svg?raw';
import fileTextRaw from '@phosphor-icons/core/assets/regular/file-text.svg?raw';
import fileXlsRaw from '@phosphor-icons/core/assets/regular/file-xls.svg?raw';
import { downloadTitle, formatLabel, type FormatExtension } from '../../core/formatNames';
import type { Command } from '../../core/shell/types';
import type { SheetExportFormat } from '../../formats/sheets';
import type { SheetsContext, SheetsModule } from './types';

const downloadIcon = ph(downloadSimpleRaw);

const FORMATS: { format: SheetExportFormat; extension: FormatExtension; icon: ReturnType<typeof ph>; keywords: string[] }[] = [
  { format: 'xlsx', extension: 'xlsx', icon: ph(fileXlsRaw), keywords: ['xlsx', 'excel', 'workbook', 'export', 'save', 'download'] },
  { format: 'csv', extension: 'csv', icon: ph(fileCsvRaw), keywords: ['csv', 'comma', 'export', 'save', 'download'] },
  { format: 'tsv', extension: 'tsv', icon: ph(fileTextRaw), keywords: ['tsv', 'tab', 'export', 'save', 'download'] }
];

async function download(c: SheetsContext, format: SheetExportFormat): Promise<void> {
  // Loaded now, not before: the writer is the heaviest thing a workbook can ask for.
  const { downloadSheet } = await import('../../formats/browser/sheetsDownload');
  await downloadSheet(
    { file: () => c.model.export(), title: c.meta.title, activeSheetId: c.sheetId, notify: c.notify },
    format
  );
}

const allowed = (c: SheetsContext): boolean => c.can.download && c.source.kind !== 'local';

export const filesModule: SheetsModule = {
  id: 'files',
  ribbon: [],

  commands: FORMATS.map(
    (f): Command<SheetsContext> => ({
      id: `file.download-${f.format}`,
      title: downloadTitle(f.extension),
      section: 'File',
      icon: downloadIcon,
      keywords: f.keywords,
      visible: allowed,
      run: (c) => void download(c, f.format)
    })
  ),

  // The Export section's slot is 600 to 690 (types.ts); Docs' row starts at 610 too.
  fileItems: [
    {
      id: 'file.download',
      label: 'Download a copy',
      icon: downloadIcon,
      section: 'Export',
      order: 610,
      visible: allowed,
      run: () => undefined,
      submenu: FORMATS.map((f) => ({ id: `file.download-${f.format}`, label: formatLabel(f.extension), icon: f.icon, run: (c: SheetsContext) => void download(c, f.format) }))
    }
  ]
};
