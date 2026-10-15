/**
 * What a Sheets module is, and what it is handed.
 *
 * Sheets is one shell and a list of modules (web/src/sheets/modules/index.ts), the way Docs is
 * (docs/modules/types.ts). A module is a file `modules/<name>.tsx` that exports a
 * `SheetsModule`: the ribbon groups it adds to a tab, the commands the Ctrl+K box can run, the
 * keys it takes in the grid, and optionally panes, footer items, File-menu rows, editing modes
 * and overlays. It is added by listing it in the index and nothing else changes, so the
 * formatting, charts and data modules are built without touching `core.tsx`.
 *
 * Everything a module's predicates and commands see is a `SheetsContext`. Read what you need from
 * it and never reach past it: `ctx.can` already says what this person may do on this source, so a
 * module does not recompute roles, and `ctx.model` is the one way to change the workbook, each
 * call one undoable step and one frame to the room.
 *
 * ── Where things go ─────────────────────────────────────────────────────────
 * Ribbon groups are placed by `tab` and `order` (lower is further left). Core uses round
 * numbers so a module can slot in between with 150:
 *
 *   Home      History 100 · Clipboard 150 · Font 200 · Alignment 300 · Number 400 ·
 *             Styles 500 · Cells 600 · Editing 700 (AutoSum, Clear) · Sort and filter 750 · Find 800
 *   Insert    Tables 100 · Charts 200 · Illustrations 300 · Links 400
 *   Page layout   whatever the print module wants
 *   Formulas  Function library 100 · Defined names 200 · Calculation 300
 *   Data      Sort and filter 100 · Data tools 200
 *   Review    Comments 100 · Protection 200
 *   View      Freeze 100 · Show 150 · Zoom 200
 *
 * Core fills only the slots it owns (History, Clipboard, Cells, Editing, and View's three); the
 * rest are reserved. A tab with no visible group is not drawn, so a tab appears when its first
 * group does.
 *
 * File rows come in sections, each placed by the `order` of its first row. Core's:
 *
 *   Document   New 100 · Open 200 · Make a copy 300 · Rename 400
 *   Share      Version history 500 · Share 510
 *   Export     reserved, 600 to 690: Export as Excel and CSV (formats) goes at 610 and 620
 *   Danger     Move to trash 900
 *
 * Commands take their `section` heading from the same vocabulary: File, Edit, Insert, Format, Data, View.
 */

import type { Cellpos, GridIntent, Rect } from '../grid/types';
import type { GridSession } from '../grid';
import type { DocKind, DocumentMeta } from '@shared/api';
import type { Caps } from '../../core/caps';
import type { Toast } from '../../core/ui';
import type { Command, EditingMode, FileItem, PaneSpec, RibbonGroup, StatusItem, TabDef } from '../../core/shell/types';
import type { SheetInfo, SheetModel, SheetView, SourceFeatures, SheetSource } from '../model';
import type { ReactNode } from 'react';

/** The ribbon's tabs for Sheets, in order. A tab with no group on it is not drawn. */
export const SHEETS_TABS: readonly TabDef[] = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'page-layout', label: 'Page layout' },
  { id: 'formulas', label: 'Formulas' },
  { id: 'data', label: 'Data' },
  { id: 'review', label: 'Review' },
  { id: 'view', label: 'View' },
  { id: 'help', label: 'Help' }
];

/**
 * What this person may do here, source and role together. A module gates on these rather than on
 * `features` or `caps`, so a rule that changes changes in one place. Comments and locking are not
 * built for Sheets yet, so there is no flag for either: add one with the module that needs it.
 */
export interface SheetsCan {
  /** Change the workbook. False in the trash, as a reader, in Viewing mode, in a version preview, after the room stopped. */
  edit: boolean;
  share: boolean;
  history: boolean;
  copy: boolean;
  trash: boolean;
  star: boolean;
  rename: boolean;
  /** Make another document: a cloud source only. */
  create: boolean;
  /** Download or print: false for a reader on a link whose owner turned downloads off. */
  download: boolean;
}

export interface PaneApi {
  isOpen: (id: string) => boolean;
  open: (id: string) => void;
  close: (id: string) => void;
  toggle: (id: string) => void;
}

/** Things a command can do to the document as a whole. Each is a no-op where it does not apply. */
export interface SheetsActions {
  /** `from` is the button, so the dialog can grow out of it. */
  share: (from?: HTMLElement | null) => void;
  copy: () => void;
  trash: () => void;
  newDocument: (kind?: DocKind) => void;
  openHome: () => void;
  /** Put the caret in the title so it can be typed over. */
  focusTitle: () => void;
  /** Put the keyboard back on the grid, after a menu or a dialog. */
  focusGrid: () => void;
  /** Put the keyboard in the command box. */
  focusPalette: () => void;
}

/** How the page is connected, for the footer. */
export type Connection = 'live' | 'connecting' | 'offline' | 'local' | 'stopped';

export interface SheetsContext {
  /**
   * The workbook on screen: the live one, or a version being previewed. Every change goes through
   * it; it refuses them itself (with a notice) where `can.edit` is false.
   */
  model: SheetModel;
  source: SheetSource;
  features: SourceFeatures;
  meta: DocumentMeta;
  caps: Caps;
  can: SheetsCan;
  connection: Connection;
  /** The sheet on screen. */
  sheetId: string;
  /** Every sheet, in tab order, hidden ones included. */
  sheets: readonly SheetInfo[];
  /** The active sheet, as the grid reads it. */
  data: SheetView;
  /** The active sheet's selection, edit and clipboard marker. The grid and the formula bar read it too. */
  session: GridSession;
  /** The selection now, in today's indexes. Read it when the command runs, not before. */
  selection: () => { rect: Rect; active: Cellpos };
  /** Show another sheet. */
  showSheet: (id: string) => void;
  /** The editing mode's id: `editing`, `viewing`, and whatever a module adds. */
  mode: string;
  setMode: (id: string) => void;
  /** The shell's zoom, as a percentage. */
  zoom: number;
  setZoom: (percent: number) => void;
  /** View settings that are the viewer's own and are not saved in the workbook. */
  view: { gridlines: boolean; setGridlines: (on: boolean) => void };
  panes: PaneApi;
  actions: SheetsActions;
  notify: (toast: Toast) => void;
}

/** A key a module takes while the grid, or nothing, has the keyboard. */
export interface SheetsKey {
  /**
   * `Mod+Z`, `Mod+Shift+Z`, `Mod+/`, `Mod+-`, `Mod++`: `Mod` is Ctrl, or Cmd on a Mac, and a letter
   * matches either case. `Mod++` is Ctrl and the plus key, which on most keyboards is Shift and `=`.
   */
  keys: string;
  /** Return true when the key was used; the browser's own action is then prevented. */
  run: (c: SheetsContext) => boolean | void;
  /** The key is skipped when this says no, and goes on to the browser. */
  when?: (c: SheetsContext) => boolean;
}

/** Something drawn over the grid or beside it: a dialog, a chart, a menu. It has no slot in a ribbon. */
export interface SheetsOverlay {
  id: string;
  /** Rendered once, inside the shell, so it takes the app's colours. It decides for itself when to show anything. */
  render: (c: SheetsContext) => ReactNode;
}

export interface SheetsModule {
  /** `core`, `format`, `charts`. Unique. */
  id: string;
  /** Groups for the ribbon, placed by `tab` and `order`. */
  ribbon: RibbonGroup<SheetsContext>[];
  /** Commands for the Ctrl+K box. */
  commands: Command<SheetsContext>[];
  /** Keys taken in the grid. */
  keys?: SheetsKey[];
  panes?: PaneSpec<SheetsContext>[];
  statusItems?: StatusItem<SheetsContext>[];
  /** Rows in the File menu. */
  fileItems?: FileItem<SheetsContext>[];
  /** Entries in the "Editing" menu at the right of the tab row. */
  modes?: EditingMode[];
  overlays?: SheetsOverlay[];
  /**
   * An intent from the grid that the model does not apply itself: today the filter button in a
   * header cell, which opens a menu. Return true when it was taken, and the next module is not asked.
   */
  onIntent?: (intent: GridIntent, c: SheetsContext) => boolean | void;
}
