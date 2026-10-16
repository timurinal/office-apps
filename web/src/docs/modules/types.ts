/**
 * What a Docs module is, and what it is handed.
 *
 * Docs is one shell and a list of modules (web/src/docs/modules/index.ts). A module
 * is a file `modules/<name>.tsx` that exports a `DocsModule`: the Tiptap extensions
 * it needs, the ribbon groups it adds to a tab, the commands the Ctrl+K box can
 * run, and optionally panes, footer items, File-menu rows and editing modes. It is
 * added by listing it in the index and nothing else changes, so three people can
 * build three modules at once without touching a shared file.
 *
 * Everything a module's predicates and commands see is a `DocsContext`. Read what
 * you need from it and never reach past it: `ctx.can` already says what this person
 * may do on this source, so a module does not recompute roles or ask whether it is a
 * local file.
 *
 * ── The right-click menu ────────────────────────────────────────────────────
 * A module's `contextItems(target, ctx)` answers with groups of rows (`ContextGroup`: an
 * `order` and the entries); the editor joins every module's groups by `order` with a rule
 * between, and the menu (core/ContextMenu.tsx) draws them. `target` is what was clicked
 * (`DocsMenuTarget`: a link, a picture, a table, or more than one at once: a link in a cell).
 * Core's (modules/menus.tsx) fills the slots marked *:
 *
 *   Link 100* (Open, Copy link, Edit link, Remove link) · Picture 200* (Alt text, Delete) ·
 *   Table 300* (insert and delete rows and columns, merge and split, delete the table)
 *
 * **Only there.** On plain text the browser's menu stays, because its spelling suggestions
 * cannot be read by a page and a menu of ours would hide them. Nor does a reader get a menu
 * with nothing in it: when no module has a row, the browser's own is left alone. Shift and a
 * right click is the browser's everywhere.
 */

import type { AnyExtension, Editor } from '@tiptap/core';
import type { DocKind, DocumentMeta } from '@shared/api';
import type { Caps } from '../../core/caps';
import type { ContextHook } from '../../core/ContextMenu';
import type { Toast } from '../../core/ui';
import type {
  Command,
  EditingMode,
  FileItem,
  PaneSpec,
  RibbonGroup,
  StatusItem,
  TabDef
} from '../../core/shell/types';
import type { DocumentSource, SourceFeatures } from '../source';

/** The ribbon's tabs for Docs, in order. A tab with no group on it is not drawn. */
export const DOCS_TABS: readonly TabDef[] = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'layout', label: 'Layout' },
  { id: 'references', label: 'References' },
  { id: 'review', label: 'Review' },
  { id: 'view', label: 'View' },
  { id: 'help', label: 'Help' }
];

/**
 * What this person may do here, source and role together. A module gates on these
 * rather than on `features` or `caps`, so a rule that changes changes in one place.
 */
export interface DocsCan {
  /** Type in the page. False in the trash, as a reader, in Viewing mode, in a preview. */
  edit: boolean;
  /** Start a comment thread. */
  comment: boolean;
  /** The comments pane at all. */
  comments: boolean;
  /**
   * Type in Suggesting, and accept or reject changes: an editor or the owner, signed in,
   * on a document with comments. Never a commenter, whose Yjs updates the room refuses.
   */
  suggest: boolean;
  share: boolean;
  history: boolean;
  lock: boolean;
  unlock: boolean;
  copy: boolean;
  trash: boolean;
  /** Offer this document as a template (File > Save as template): the owner of a live cloud document. */
  template: boolean;
  star: boolean;
  rename: boolean;
  /** Make another document: a cloud source only. */
  create: boolean;
  print: boolean;
}

export interface PaneApi {
  isOpen: (id: string) => boolean;
  open: (id: string) => void;
  close: (id: string) => void;
  toggle: (id: string) => void;
}

/** Things a command can do to the document as a whole. Each is a no-op where it does not apply. */
export interface DocsActions {
  /** `from` is the button, so the dialog can grow out of it. */
  share: (from?: HTMLElement | null) => void;
  lock: () => void;
  removePassword: () => void;
  copy: () => void;
  trash: () => void;
  newDocument: (kind?: DocKind) => void;
  openHome: () => void;
  print: () => void;
  /** Open the comments pane and take the selection as the thread's anchor. */
  startComment: () => void;
  /** Put the caret in the title so it can be typed over. */
  focusTitle: () => void;
  focusEditor: () => void;
}

/** How the page is connected, for the footer. */
export type Connection = 'live' | 'connecting' | 'offline' | 'local' | 'locked' | 'stopped';

export interface DocsContext {
  /** Null until the editor has mounted. Predicates must cope. */
  editor: Editor | null;
  source: DocumentSource;
  features: SourceFeatures;
  meta: DocumentMeta;
  caps: Caps;
  can: DocsCan;
  connection: Connection;
  /** The editing mode's id: `editing`, `viewing`, and whatever a module adds. */
  mode: string;
  setMode: (id: string) => void;
  panes: PaneApi;
  actions: DocsActions;
  notify: (toast: Toast) => void;
}

/**
 * What a right click landed on. Each part is there when the click was on one: a link in a table
 * cell has both. `link.href` is what the link points to; `image.pos` is where the picture is.
 */
export interface DocsMenuTarget {
  link?: { href: string };
  image?: { pos: number };
  table?: true;
}

export interface DocsModule {
  /** `core`, `layout`, `review`. Unique. */
  id: string;
  /** Tiptap extensions. Added after the base list (`docs/extensions.ts`). */
  extensions: AnyExtension[];
  /** Groups for the ribbon, placed by `tab` and `order`. */
  ribbon: RibbonGroup<DocsContext>[];
  /** Commands for the Ctrl+K box. */
  commands: Command<DocsContext>[];
  panes?: PaneSpec<DocsContext>[];
  statusItems?: StatusItem<DocsContext>[];
  /** Rows in the File menu. */
  fileItems?: FileItem<DocsContext>[];
  /** Entries in the "Editing" menu at the right of the tab row. */
  modes?: EditingMode[];
  /** Rows for the right-click menu over a link, a picture or a table. Empty groups are skipped. */
  contextItems?: ContextHook<DocsMenuTarget, DocsContext>;
}
