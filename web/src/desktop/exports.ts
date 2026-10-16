/**
 * File > Export a copy: the editors' own writers, from the File menu, the Ctrl+K box and the menu
 * bar's Export (`kinds.ts` names these commands).
 *
 * The editors offer the same writers as "Download a copy", but not on a local document, which they
 * expect to be saved through a Save as of their own. Here the document is the app's own file and a
 * Word, Excel or PowerPoint copy is an export, so the desktop modules carry these rows. Each writer
 * is loaded on the press, as the editors' are.
 */

import exportRaw from '@phosphor-icons/core/assets/regular/export.svg?raw';
import { formatLabel, type FormatExtension } from '../core/formatNames';
import { ph } from '../core/icons';
import type { Command, FileItem } from '../core/shell/types';
import type { DocsContext } from '../docs/modules/types';
import type { SheetsContext } from '../sheets/modules/types';
import type { SlidesContext } from '../slides/modules/types';
import { currentSession } from './session';

const exportIcon = ph(exportRaw);

export interface ExportFormat<C> {
  /** The command's id: what the menu bar's Export runs. */
  id: string;
  extension: FormatExtension;
  keywords: string[];
  run: (c: C) => Promise<void>;
}

const here = (): boolean => currentSession() !== null;

/** The File menu's row, and the same formats in the Ctrl+K box. */
export function exportRows<C>(formats: readonly ExportFormat<C>[], ready: (c: C) => boolean): { fileItem: FileItem<C>; commands: Command<C>[] } {
  return {
    fileItem: {
      id: 'desktop.export',
      label: 'Export a copy',
      icon: exportIcon,
      // Upstream's Download a copy holds this slot and is hidden on a local document.
      section: 'Export',
      order: 610,
      visible: here,
      disabled: (c) => !ready(c),
      run: () => undefined,
      submenu: formats.map((f) => ({ id: f.id, label: formatLabel(f.extension), run: (c: C) => void f.run(c) }))
    },
    commands: formats.map((f) => ({
      id: f.id,
      title: `Export a copy as .${f.extension}`,
      section: 'File',
      icon: exportIcon,
      keywords: ['export', 'download', 'save', ...f.keywords],
      visible: (c: C) => here() && ready(c),
      run: (c: C) => void f.run(c)
    }))
  };
}

// ── each kind's formats ─────────────────────────────────────────────────────

type DocsFormat = 'docx' | 'markdown' | 'html' | 'text';

const docs = (format: DocsFormat) => async (c: DocsContext) => {
  const { downloadDocument } = await import('../formats/browser/download');
  // A local document's pictures are in it already, and it has no comments to carry.
  await downloadDocument({ editor: c.editor, title: c.meta.title, documentId: null, comments: false, notify: c.notify }, format);
};

export const DOCS_EXPORTS: readonly ExportFormat<DocsContext>[] = [
  { id: 'desktop.export-docx', extension: 'docx', keywords: ['docx', 'word', 'document'], run: docs('docx') },
  { id: 'desktop.export-markdown', extension: 'md', keywords: ['md', 'markdown'], run: docs('markdown') },
  { id: 'desktop.export-html', extension: 'html', keywords: ['html', 'web page'], run: docs('html') },
  { id: 'desktop.export-text', extension: 'txt', keywords: ['txt', 'plain text'], run: docs('text') }
];

const sheets = (format: 'xlsx' | 'csv' | 'tsv') => async (c: SheetsContext) => {
  const { downloadSheet } = await import('../formats/browser/sheetsDownload');
  await downloadSheet({ file: () => c.model.export(), title: c.meta.title, activeSheetId: c.sheetId, notify: c.notify }, format);
};

export const SHEETS_EXPORTS: readonly ExportFormat<SheetsContext>[] = [
  { id: 'desktop.export-xlsx', extension: 'xlsx', keywords: ['xlsx', 'excel', 'workbook'], run: sheets('xlsx') },
  { id: 'desktop.export-csv', extension: 'csv', keywords: ['csv', 'comma'], run: sheets('csv') },
  { id: 'desktop.export-tsv', extension: 'tsv', keywords: ['tsv', 'tab'], run: sheets('tsv') }
];

export const SLIDES_EXPORTS: readonly ExportFormat<SlidesContext>[] = [
  {
    id: 'desktop.export-pptx',
    extension: 'pptx',
    keywords: ['pptx', 'powerpoint', 'presentation'],
    run: async (c) => {
      const { downloadPptx } = await import('../formats/browser/slidesDownload');
      await downloadPptx({ deck: () => c.model.deck(), title: c.meta.title, assetUrl: c.assets, notify: c.notify });
    }
  }
];
