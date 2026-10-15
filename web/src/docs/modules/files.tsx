/**
 * Files: File > Export as Word, Markdown, a web page or plain text.
 *
 * The rows are the whole module. The converters are not imported here: a click loads them
 * (`formats/browser/download`), so the editor opens without carrying a docx writer, and a
 * person who never downloads never fetches one. The same four are in the Ctrl+K box.
 *
 * Gated on `can.print`: that is "can download, print and copy", the switch a link owner
 * turns off for viewers, so a reader without it gets neither a printout nor a file.
 */

import { ph } from '../../core/icons';
import downloadSimpleRaw from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import fileDocRaw from '@phosphor-icons/core/assets/regular/file-doc.svg?raw';
import fileHtmlRaw from '@phosphor-icons/core/assets/regular/file-html.svg?raw';
import fileTextRaw from '@phosphor-icons/core/assets/regular/file-text.svg?raw';
import markdownLogoRaw from '@phosphor-icons/core/assets/regular/markdown-logo.svg?raw';
import type { Command, FileItem } from '../../core/shell/types';
import type { DocsContext, DocsModule } from './types';

const downloadIcon = ph(downloadSimpleRaw);

type Format = 'docx' | 'markdown' | 'html' | 'text';

const FORMATS: { format: Format; label: string; title: string; icon: ReturnType<typeof ph>; keywords: string[] }[] = [
  { format: 'docx', label: 'Export as Word (.docx)', title: 'Export as Word', icon: ph(fileDocRaw), keywords: ['docx', 'word', 'export', 'save', 'download'] },
  { format: 'markdown', label: 'Export as Markdown (.md)', title: 'Export as Markdown', icon: ph(markdownLogoRaw), keywords: ['md', 'markdown', 'export', 'save', 'download'] },
  { format: 'html', label: 'Export as web page (.html)', title: 'Export as a web page', icon: ph(fileHtmlRaw), keywords: ['html', 'web', 'export', 'save', 'download'] },
  { format: 'text', label: 'Export as plain text (.txt)', title: 'Export as plain text', icon: ph(fileTextRaw), keywords: ['txt', 'text', 'export', 'save', 'download'] }
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

const allowed = (c: DocsContext): boolean => c.can.print;
const notReady = (c: DocsContext): boolean => !c.editor;

export const filesModule: DocsModule = {
  id: 'files',
  extensions: [],
  ribbon: [],

  commands: FORMATS.map(
    (f): Command<DocsContext> => ({
      id: `file.download-${f.format}`,
      title: f.title,
      section: 'File',
      icon: downloadIcon,
      keywords: f.keywords,
      visible: allowed,
      disabled: notReady,
      run: (c) => void download(c, f.format)
    })
  ),

  fileItems: FORMATS.map(
    (f, i): FileItem<DocsContext> => ({
      id: `file.download-${f.format}`,
      label: f.label,
      icon: f.icon,
      section: 'Export',
      order: 610 + i * 10,
      visible: allowed,
      disabled: notReady,
      run: (c) => void download(c, f.format)
    })
  )
};
