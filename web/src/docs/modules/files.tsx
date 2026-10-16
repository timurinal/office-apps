/**
 * Files: File > Download a copy, which lists the four formats a document leaves in: a document,
 * Markdown, a web page and plain text, each by what it is and its extension (core/formatNames.ts).
 *
 * The rows are the whole module. The converters are not imported here: a click loads them
 * (`formats/browser/download`), so the editor opens without carrying a docx writer, and a
 * person who never downloads never fetches one. The same four are in the Ctrl+K box, where the
 * old names of the formats still find them.
 *
 * Gated on `can.print`: that is "can download, print and copy", the switch a link owner
 * turns off for viewers, so a reader without it gets neither a printout nor a file. A file on the
 * computer is saved through Save as instead (local/LocalDocument.tsx), so it has no Download.
 */

import { ph } from '../../core/icons';
import downloadSimpleRaw from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import fileDocRaw from '@phosphor-icons/core/assets/regular/file-doc.svg?raw';
import fileHtmlRaw from '@phosphor-icons/core/assets/regular/file-html.svg?raw';
import fileTextRaw from '@phosphor-icons/core/assets/regular/file-text.svg?raw';
import markdownLogoRaw from '@phosphor-icons/core/assets/regular/markdown-logo.svg?raw';
import { downloadTitle, formatLabel, type FormatExtension } from '../../core/formatNames';
import type { Command } from '../../core/shell/types';
import type { DocsContext, DocsModule } from './types';

const downloadIcon = ph(downloadSimpleRaw);

type Format = 'docx' | 'markdown' | 'html' | 'text';

const FORMATS: { format: Format; extension: FormatExtension; icon: ReturnType<typeof ph>; keywords: string[] }[] = [
  { format: 'docx', extension: 'docx', icon: ph(fileDocRaw), keywords: ['docx', 'word', 'document', 'export', 'save', 'download'] },
  { format: 'markdown', extension: 'md', icon: ph(markdownLogoRaw), keywords: ['md', 'markdown', 'export', 'save', 'download'] },
  { format: 'html', extension: 'html', icon: ph(fileHtmlRaw), keywords: ['html', 'web', 'web page', 'export', 'save', 'download'] },
  { format: 'text', extension: 'txt', icon: ph(fileTextRaw), keywords: ['txt', 'text', 'plain text', 'export', 'save', 'download'] }
];

async function download(c: DocsContext, format: Format): Promise<void> {
  // Loaded now, not before: the converters are the heaviest thing a document can ask for.
  const { downloadDocument } = await import('../../formats/browser/download');
  await downloadDocument(
    {
      editor: c.editor,
      title: c.meta.title,
      documentId: c.source.kind === 'cloud' ? c.meta.id : null,
      comments: c.can.comments,
      notify: c.notify
    },
    format
  );
}

const allowed = (c: DocsContext): boolean => c.can.print && c.source.kind !== 'local';
const notReady = (c: DocsContext): boolean => !c.editor;

export const filesModule: DocsModule = {
  id: 'files',
  extensions: [],
  ribbon: [],

  commands: FORMATS.map(
    (f): Command<DocsContext> => ({
      id: `file.download-${f.format}`,
      title: downloadTitle(f.extension),
      section: 'File',
      icon: downloadIcon,
      keywords: f.keywords,
      visible: allowed,
      disabled: notReady,
      run: (c) => void download(c, f.format)
    })
  ),

  fileItems: [
    {
      id: 'file.download',
      label: 'Download a copy',
      icon: downloadIcon,
      section: 'Export',
      order: 610,
      visible: allowed,
      disabled: notReady,
      run: () => undefined,
      submenu: FORMATS.map((f) => ({ id: `file.download-${f.format}`, label: formatLabel(f.extension), icon: f.icon, run: (c: DocsContext) => void download(c, f.format) }))
    }
  ]
};
