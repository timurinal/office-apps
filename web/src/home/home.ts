/**
 * The home page's decisions: what each view is called, which file opens as
 * which kind, and what an empty list says. Pure, so the page is just drawing.
 */

import type { DocKind, DocumentSummary, DocumentView } from '@shared/api';

/** What the rail on Home picks. The first four are lists; `templates` is the shelf. */
export type HomeView = DocumentView | 'templates';

export const RAIL: readonly { value: HomeView; label: string }[] = [
  { value: 'recent', label: 'Home' },
  { value: 'shared', label: 'Shared with you' },
  { value: 'starred', label: 'Starred' },
  { value: 'templates', label: 'Templates' },
  { value: 'trash', label: 'Trash' }
];

/** The heading over the list, in the house style: it ends with a full stop. */
export const VIEW_HEADING: Record<HomeView, string> = {
  recent: 'Recent.',
  owned: 'Yours.',
  shared: 'Shared with you.',
  starred: 'Starred.',
  templates: 'Templates.',
  trash: 'Trash.'
};

export const KIND_CHIPS: readonly { value: '' | DocKind; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'docs', label: 'Docs' },
  { value: 'sheets', label: 'Sheets' },
  { value: 'slides', label: 'Slides' }
];

export const KIND_LABEL: Record<DocKind, string> = { docs: 'Docs', sheets: 'Sheets', slides: 'Slides' };

export type OwnerFilter = 'any' | 'me' | 'others';

export const OWNER_OPTIONS: readonly { value: OwnerFilter; label: string }[] = [
  { value: 'any', label: 'Owned by anyone' },
  { value: 'me', label: 'Owned by you' },
  { value: 'others', label: 'Not owned by you' }
];

/** Who the list is narrowed to. Applied to what was fetched: the API has no such filter. */
export function ownedBy<T extends Pick<DocumentSummary, 'ownerId'>>(docs: readonly T[], filter: OwnerFilter, meId: string | null): T[] {
  if (filter === 'any' || meId === null) return [...docs];
  return docs.filter((d) => (filter === 'me') === (d.ownerId === meId));
}

/** `/docs/<id>`. The paths are permanent: a link is pasted into mail and chat. */
export const docPath = (kind: DocKind, id: string): string => `/${kind}/${encodeURIComponent(id)}`;

/** The three blank starts, in the order the row shows them. */
export const BLANKS: { kind: DocKind; title: string }[] = [
  { kind: 'docs', title: 'Blank document' },
  { kind: 'sheets', title: 'Blank spreadsheet' },
  { kind: 'slides', title: 'Blank presentation' }
];

// ── files ───────────────────────────────────────────────────────────────────

/** What the file picker offers. */
export const IMPORT_ACCEPT = '.docx,.md,.markdown,.html,.htm,.xlsx,.csv,.tsv,.pptx,.ppsx,.potx';

const IMPORT_KINDS: Record<string, DocKind> = {
  docx: 'docs',
  md: 'docs',
  markdown: 'docs',
  html: 'docs',
  htm: 'docs',
  xlsx: 'sheets',
  csv: 'sheets',
  tsv: 'sheets',
  pptx: 'slides',
  // A show and a template are the same package as a deck.
  ppsx: 'slides',
  potx: 'slides'
};

/** Which editor a file would open in, by its extension; null for any other file. */
export function importKindFor(fileName: string): DocKind | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return IMPORT_KINDS[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

/** Whether the file is one Docs opens: a Word document, Markdown or a web page. */
export const isDocsFile = (fileName: string): boolean => importKindFor(fileName) === 'docs';

/** Whether the file is one Sheets opens: a workbook, or comma or tab separated text. */
export const isSheetsFile = (fileName: string): boolean => importKindFor(fileName) === 'sheets';

/** Whether the file is one Slides opens: a deck, a show or a template. */
export const isSlidesFile = (fileName: string): boolean => importKindFor(fileName) === 'slides';

// ── rows ────────────────────────────────────────────────────────────────────

/** The date a card shows and what to call it. Trash shows when it was deleted;
 *  recent shows when you last opened it; everything else when it last changed. */
export function dateColumn(
  doc: Pick<DocumentSummary, 'openedAt' | 'updatedAt' | 'trashedAt'>,
  view: HomeView
): { label: string; at: number } {
  if (view === 'trash' && doc.trashedAt !== null) return { label: 'Deleted', at: doc.trashedAt };
  if (view === 'recent' && doc.openedAt !== null) return { label: 'Opened', at: doc.openedAt };
  return { label: 'Modified', at: doc.updatedAt };
}

/** "You", or the owner's name. */
export const ownerLabel = (doc: Pick<DocumentSummary, 'ownerId' | 'ownerName'>, meId: string | null): string =>
  meId !== null && doc.ownerId === meId ? 'You' : doc.ownerName;

export function emptyText(view: HomeView, query = ''): string {
  if (query.trim()) return `No documents match “${query.trim()}”.`;
  switch (view) {
    case 'recent':
    case 'owned':
      return 'Nothing here yet. Start with a blank document.';
    case 'shared':
      return 'Nothing has been shared with you yet.';
    case 'starred':
      return 'Star a document to find it here.';
    case 'templates':
      return 'No templates yet.';
    case 'trash':
      return 'The trash is empty.';
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── remembered choices ──────────────────────────────────────────────────────

export type Layout = 'list' | 'grid';

const LAYOUT_KEY = 'office.home.layout';

/** The reader's grid-or-list choice. Storage can be blocked or empty, and the
 *  page works the same without it. */
export function readLayout(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Layout {
  try {
    // The board's default is the grid; the list is a choice.
    return storage?.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function writeLayout(layout: Layout, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LAYOUT_KEY, layout);
  } catch {
    // Private window, blocked site data: the choice lasts until the page closes.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
