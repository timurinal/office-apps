/**
 * The three kinds of document, as the desktop app sees them: what a file of each is called on
 * disk, which other files open as one, and which commands export one.
 *
 * `shell/officeapps/kinds.json` says the same for the Qt side (the Open panel's filters, the
 * Export menu, Finder's document types); `kinds.test.ts` fails when the two disagree.
 */

import type { DocKind } from '@shared/api';

export type Kind = DocKind;

export interface ExportEntry {
  /** The desktop module's command (`exports.ts`), which runs the editor's own writer. */
  command: string;
  label: string;
}

export interface KindInfo {
  kind: Kind;
  /** The app's name: "Docs". */
  label: string;
  /** What one is called in a sentence: "document". */
  noun: string;
  /** The native file's extension, without the dot. */
  extension: string;
  mime: string;
  /** Other files that open as a new document of this kind, by extension. */
  imports: readonly string[];
  exports: readonly ExportEntry[];
  /** Built and offered. */
  enabled: boolean;
}

export const KINDS: Readonly<Record<Kind, KindInfo>> = {
  docs: {
    kind: 'docs',
    label: 'Docs',
    noun: 'document',
    extension: 'oadoc',
    mime: 'application/x-office-document',
    imports: ['docx', 'md', 'markdown', 'html', 'htm', 'txt'],
    exports: [
      { command: 'desktop.export-docx', label: 'Document (.docx)' },
      { command: 'desktop.export-markdown', label: 'Markdown (.md)' },
      { command: 'desktop.export-html', label: 'Web page (.html)' },
      { command: 'desktop.export-text', label: 'Plain text (.txt)' }
    ],
    enabled: true
  },
  sheets: {
    kind: 'sheets',
    label: 'Sheets',
    noun: 'spreadsheet',
    extension: 'oasheet',
    mime: 'application/x-office-spreadsheet',
    imports: ['xlsx', 'csv', 'tsv'],
    exports: [
      { command: 'desktop.export-xlsx', label: 'Workbook (.xlsx)' },
      { command: 'desktop.export-csv', label: 'Comma-separated values (.csv)' },
      { command: 'desktop.export-tsv', label: 'Tab-separated values (.tsv)' }
    ],
    enabled: true
  },
  slides: {
    kind: 'slides',
    label: 'Slides',
    noun: 'presentation',
    extension: 'oadeck',
    mime: 'application/x-office-presentation',
    imports: ['pptx', 'ppsx', 'potx'],
    exports: [{ command: 'desktop.export-pptx', label: 'Presentation (.pptx)' }],
    enabled: true
  }
};

export const ENABLED_KINDS: readonly Kind[] = (Object.keys(KINDS) as Kind[]).filter((k) => KINDS[k].enabled);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** What a file is, by its name: a native file of a kind, a file that imports as one, or neither. */
export function classify(name: string): { kind: Kind; native: boolean } | null {
  const ext = extensionOf(name);
  for (const k of ENABLED_KINDS) {
    if (KINDS[k].extension === ext) return { kind: k, native: true };
    if (KINDS[k].imports.includes(ext)) return { kind: k, native: false };
  }
  return null;
}

/** A file's name without its folder or its extension: the document's title. */
export function baseName(name: string): string {
  const file = name.replace(/^.*[\\/]/, '');
  const dot = file.lastIndexOf('.');
  return (dot > 0 ? file.slice(0, dot) : file).trim() || 'Untitled';
}
