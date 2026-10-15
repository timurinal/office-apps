/**
 * The core module: what every spreadsheet needs.
 *
 *   Home      undo and redo; cut, copy and paste; insert and delete rows, columns and sheets;
 *             AutoSum (sum, average, count, max, min) and clear contents
 *   View      freeze panes, gridlines, zoom
 *
 * And the File menu's rows, the commands the Ctrl+K box runs, the keys (undo, redo, the command
 * box, insert and delete), the footer (the sheet tabs, the selection's sum, the connection) and
 * the Editing and Viewing modes.
 *
 * What each button does is in `actions.ts`, one function each with a test; this file says where
 * it goes. Ribbon groups are numbered 100, 200 … so another module can slot a group between them
 * (see types.ts for who owns which slot). A control that is disabled for a reader is disabled by
 * `can.edit`, never by a role.
 */

import { useEffect, useState } from 'react';
import {
  arrowUUpLeftIcon,
  arrowUUpRightIcon,
  clipboardTextIcon,
  clockCounterClockwiseIcon,
  copyIcon,
  eraserIcon,
  eyeIcon,
  filePlusIcon,
  folderOpenIcon,
  pencilSimpleIcon,
  trashIcon,
  usersIcon
} from '../../core/icons';
import { mod } from '../../core/keys';
import type { Command, FileItem, MenuEntry, RibbonGroup, StatusItem } from '../../core/shell/types';
import { formatValue } from '../engine';
import { SelectionStatus, SheetTabs } from '../grid';
import {
  autoSum,
  clearContents,
  copySelection,
  deleteByKey,
  deleteCols,
  deleteRows,
  deleteSheet,
  freeze,
  frozenAs,
  insertByKey,
  insertCols,
  insertRows,
  insertSheet,
  pasteHere,
  type AutoFunction,
  type FreezeKind
} from './actions';
import {
  columnsPlusLeftIcon,
  columnsPlusRightIcon,
  gridFourIcon,
  magnifyingGlassMinusIcon,
  magnifyingGlassPlusIcon,
  rowsPlusBottomIcon,
  rowsPlusTopIcon,
  scissorsIcon,
  sigmaIcon,
  snowflakeIcon
} from './icons';
import type { Connection, SheetsContext, SheetsKey, SheetsModule } from './types';

// ── small helpers ───────────────────────────────────────────────────────────

/** Everything that changes the workbook is off for a reader, in the trash, in Viewing mode and in a preview. */
const cannotEdit = (c: SheetsContext): boolean => !c.can.edit;

/** A command, then the keyboard back on the grid: a button must not leave the person's typing nowhere. */
const then = (fn: (c: SheetsContext) => void) => (c: SheetsContext) => {
  fn(c);
  c.actions.focusGrid();
};

const AUTO: { fn: AutoFunction; label: string; keywords: string[] }[] = [
  { fn: 'SUM', label: 'Sum', keywords: ['total', 'add', 'autosum'] },
  { fn: 'AVERAGE', label: 'Average', keywords: ['mean', 'autosum'] },
  { fn: 'COUNT', label: 'Count', keywords: ['numbers', 'autosum'] },
  { fn: 'MAX', label: 'Max', keywords: ['largest', 'maximum', 'autosum'] },
  { fn: 'MIN', label: 'Min', keywords: ['smallest', 'minimum', 'autosum'] }
];

const FREEZE: { kind: FreezeKind; label: string }[] = [
  { kind: 'row', label: 'Freeze top row' },
  { kind: 'column', label: 'Freeze first column' },
  { kind: 'selection', label: 'Freeze up to the selection' },
  { kind: 'none', label: 'Unfreeze' }
];

const ZOOM_STEP = 10;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const zoomBy = (c: SheetsContext, delta: number): void => c.setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom + delta)));

const insertEntries: MenuEntry<SheetsContext>[] = [
  { label: 'Insert rows above', icon: rowsPlusTopIcon, run: then((c) => insertRows(c, 'above')), disabled: cannotEdit },
  { label: 'Insert rows below', icon: rowsPlusBottomIcon, run: then((c) => insertRows(c, 'below')), disabled: cannotEdit },
  { label: 'Insert columns left', icon: columnsPlusLeftIcon, run: then((c) => insertCols(c, 'left')), disabled: cannotEdit, separated: true },
  { label: 'Insert columns right', icon: columnsPlusRightIcon, run: then((c) => insertCols(c, 'right')), disabled: cannotEdit },
  { label: 'Insert sheet', icon: filePlusIcon, run: then((c) => insertSheet(c)), disabled: cannotEdit, separated: true }
];

const deleteEntries: MenuEntry<SheetsContext>[] = [
  { label: 'Delete rows', run: then(deleteRows), disabled: cannotEdit },
  { label: 'Delete columns', run: then(deleteCols), disabled: cannotEdit },
  { label: 'Delete sheet', run: then((c) => deleteSheet(c)), disabled: cannotEdit, separated: true, danger: true }
];

// ── the footer ──────────────────────────────────────────────────────────────

/** The sheets as tabs, at the left of the footer. Every change to them is one step like any other. */
function SheetTabsStatus({ ctx }: { ctx: SheetsContext }) {
  const { model, sheets, sheetId, can } = ctx;
  return (
    <SheetTabs
      sheets={sheets}
      active={sheetId}
      readOnly={!can.edit}
      onSelect={(id) => {
        ctx.showSheet(id);
        ctx.actions.focusGrid();
      }}
      onAdd={() => {
        const id = model.addSheet();
        if (id) ctx.showSheet(id);
      }}
      onRename={(id, name) => model.renameSheet(id, name)}
      onDelete={(id) => deleteSheet(ctx, id)}
      onDuplicate={(id) => {
        const copy = model.duplicateSheet(id);
        if (copy) ctx.showSheet(copy);
      }}
      onColor={(id, color) => model.setTabColor(id, color)}
      onHide={(id) => model.setSheetHidden(id, true)}
      onUnhide={(id) => model.setSheetHidden(id, false)}
      onReorder={(id, to) => model.moveSheet(id, to)}
    />
  );
}

/** What the number format would show: `format(273000, '£#,##0')` is `£273,000`. */
const formatForStatus = (n: number, numFmt?: string): string => formatValue(n, numFmt).text;

/** How long the sum may be behind the cells. Somebody else's cursor changes nothing it adds up. */
const SUM_EVERY_MS = 120;

/**
 * The selection's sum, which has to follow a change in the cells as well as a move of the
 * selection. A big selection is added up in a pass over its cells, so a change is picked up at most
 * every 120 ms and not on each of the changes a busy room makes (every cursor is one).
 */
function SelectionStatusItem({ ctx }: { ctx: SheetsContext }) {
  const { data, session } = ctx;
  const [, setSeen] = useState(data.version);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = data.subscribe(() => {
      timer ??= setTimeout(() => {
        timer = undefined;
        setSeen(data.version);
      }, SUM_EVERY_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [data]);
  return <SelectionStatus session={session} data={data} format={formatForStatus} />;
}

const CONNECTION: Record<Connection, { label: string; warn: boolean } | null> = {
  live: { label: 'Connected', warn: false },
  connecting: { label: 'Connecting', warn: true },
  offline: { label: 'Offline', warn: true },
  local: { label: 'On this device', warn: false },
  stopped: null
};

function ConnectionStatus({ ctx }: { ctx: SheetsContext }) {
  const c = CONNECTION[ctx.connection];
  if (!c) return null;
  return (
    <span className="oa-status" role="status" style={{ marginRight: 10 }}>
      <span className="oa-dot" data-tone={c.warn ? 'warn' : undefined} />
      {c.label}
    </span>
  );
}

// ── the ribbon ──────────────────────────────────────────────────────────────

const ribbon: RibbonGroup<SheetsContext>[] = [
  // Home ─────────────────────────────────────────────────────────────────
  {
    id: 'home.history',
    tab: 'home',
    order: 100,
    label: 'Undo',
    items: [
      {
        type: 'button',
        id: 'home.undo',
        label: 'Undo',
        icon: arrowUUpLeftIcon,
        shortcut: mod('Z'),
        run: then((c) => void c.model.undo()),
        disabled: (c) => cannotEdit(c) || !c.model.canUndo()
      },
      {
        type: 'button',
        id: 'home.redo',
        label: 'Redo',
        icon: arrowUUpRightIcon,
        shortcut: mod('Y'),
        run: then((c) => void c.model.redo()),
        disabled: (c) => cannotEdit(c) || !c.model.canRedo()
      }
    ]
  },
  {
    id: 'home.clipboard',
    tab: 'home',
    order: 150,
    label: 'Clipboard',
    items: [
      {
        type: 'button',
        id: 'home.paste',
        label: 'Paste',
        icon: clipboardTextIcon,
        shortcut: mod('V'),
        showLabel: true,
        run: then((c) => void pasteHere(c)),
        disabled: cannotEdit
      },
      {
        type: 'button',
        id: 'home.cut',
        label: 'Cut',
        icon: scissorsIcon,
        shortcut: mod('X'),
        run: then((c) => void copySelection(c, true)),
        visible: (c) => c.can.download,
        disabled: cannotEdit
      },
      {
        type: 'button',
        id: 'home.copy',
        label: 'Copy',
        icon: copyIcon,
        shortcut: mod('C'),
        run: then((c) => void copySelection(c, false)),
        visible: (c) => c.can.download
      }
    ]
  },
  {
    id: 'home.cells',
    tab: 'home',
    order: 600,
    label: 'Cells',
    items: [
      { type: 'menu', id: 'home.insert', label: 'Insert', icon: rowsPlusBottomIcon, showLabel: true, disabled: cannotEdit, entries: insertEntries },
      { type: 'menu', id: 'home.delete', label: 'Delete', icon: trashIcon, showLabel: true, disabled: cannotEdit, entries: deleteEntries }
    ]
  },
  {
    id: 'home.editing',
    tab: 'home',
    order: 700,
    label: 'Editing',
    items: [
      {
        type: 'split',
        id: 'home.autosum',
        label: 'AutoSum',
        icon: sigmaIcon,
        showLabel: true,
        run: then((c) => autoSum(c, 'SUM')),
        disabled: cannotEdit,
        menu: AUTO.map((a) => ({ label: a.label, run: then((c) => autoSum(c, a.fn)), disabled: cannotEdit }))
      },
      {
        type: 'button',
        id: 'home.clear',
        label: 'Clear contents',
        icon: eraserIcon,
        shortcut: 'Delete',
        run: then(clearContents),
        disabled: cannotEdit
      }
    ]
  },

  // View ─────────────────────────────────────────────────────────────────
  {
    id: 'view.freeze',
    tab: 'view',
    order: 100,
    label: 'Freeze',
    items: [
      {
        type: 'menu',
        id: 'view.freeze',
        label: 'Freeze panes',
        icon: snowflakeIcon,
        showLabel: true,
        disabled: cannotEdit,
        entries: FREEZE.map((f) => ({
          label: f.label,
          active: (c: SheetsContext) => f.kind !== 'none' && frozenAs(c) === f.kind,
          run: then((c) => freeze(c, f.kind)),
          disabled: cannotEdit,
          ...(f.kind === 'none' ? { separated: true } : {})
        }))
      }
    ]
  },
  {
    id: 'view.show',
    tab: 'view',
    order: 150,
    label: 'Show',
    items: [
      {
        type: 'button',
        id: 'view.gridlines',
        label: 'Gridlines',
        icon: gridFourIcon,
        showLabel: true,
        active: (c) => c.view.gridlines,
        run: then((c) => c.view.setGridlines(!c.view.gridlines))
      }
    ]
  },
  {
    id: 'view.zoom',
    tab: 'view',
    order: 200,
    label: 'Zoom',
    items: [
      { type: 'button', id: 'view.zoom-out', label: 'Zoom out', icon: magnifyingGlassMinusIcon, run: (c) => zoomBy(c, -ZOOM_STEP), disabled: (c) => c.zoom <= ZOOM_MIN },
      { type: 'button', id: 'view.zoom-in', label: 'Zoom in', icon: magnifyingGlassPlusIcon, run: (c) => zoomBy(c, ZOOM_STEP), disabled: (c) => c.zoom >= ZOOM_MAX },
      { type: 'button', id: 'view.zoom-100', label: '100%', showLabel: true, run: (c) => c.setZoom(100), disabled: (c) => c.zoom === 100 }
    ]
  }
];

// ── the command box ─────────────────────────────────────────────────────────

const commands: Command<SheetsContext>[] = [
  { id: 'file.new', title: 'New spreadsheet', section: 'File', icon: filePlusIcon, keywords: ['create', 'blank', 'excel'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('sheets') },
  { id: 'file.new-document', title: 'New document', section: 'File', icon: filePlusIcon, keywords: ['create', 'word'], visible: (c) => c.can.create, run: (c) => c.actions.newDocument('docs') },
  { id: 'file.open', title: 'Open another document', section: 'File', icon: folderOpenIcon, keywords: ['home', 'recent'], visible: (c) => c.source.kind !== 'local', run: (c) => c.actions.openHome() },
  { id: 'file.copy', title: 'Make a copy', section: 'File', icon: copyIcon, keywords: ['duplicate'], visible: (c) => c.can.copy, run: (c) => c.actions.copy() },
  { id: 'file.rename', title: 'Rename', section: 'File', icon: pencilSimpleIcon, keywords: ['title'], visible: (c) => c.can.rename, run: (c) => c.actions.focusTitle() },
  { id: 'file.share', title: 'Share', section: 'File', icon: usersIcon, keywords: ['invite', 'link', 'permissions'], visible: (c) => c.can.share, run: (c) => c.actions.share() },
  { id: 'file.history', title: 'Version history', section: 'File', icon: clockCounterClockwiseIcon, keywords: ['restore', 'versions', 'earlier'], visible: (c) => c.can.history, run: (c) => c.panes.open('history') },
  { id: 'file.trash', title: 'Move to trash', section: 'File', icon: trashIcon, keywords: ['delete'], visible: (c) => c.can.trash, run: (c) => c.actions.trash() },

  { id: 'edit.undo', title: 'Undo', section: 'Edit', icon: arrowUUpLeftIcon, shortcut: mod('Z'), visible: (c) => c.can.edit, disabled: (c) => !c.model.canUndo(), run: (c) => void c.model.undo() },
  { id: 'edit.redo', title: 'Redo', section: 'Edit', icon: arrowUUpRightIcon, shortcut: mod('Y'), visible: (c) => c.can.edit, disabled: (c) => !c.model.canRedo(), run: (c) => void c.model.redo() },
  { id: 'edit.cut', title: 'Cut', section: 'Edit', icon: scissorsIcon, shortcut: mod('X'), visible: (c) => c.can.edit && c.can.download, run: (c) => void copySelection(c, true) },
  { id: 'edit.copy', title: 'Copy', section: 'Edit', icon: copyIcon, shortcut: mod('C'), visible: (c) => c.can.download, run: (c) => void copySelection(c, false) },
  { id: 'edit.paste', title: 'Paste', section: 'Edit', icon: clipboardTextIcon, shortcut: mod('V'), visible: (c) => c.can.edit, run: (c) => void pasteHere(c) },
  { id: 'edit.clear', title: 'Clear contents', section: 'Edit', icon: eraserIcon, keywords: ['delete', 'erase'], visible: (c) => c.can.edit, run: clearContents },

  { id: 'insert.row-above', title: 'Insert rows above', section: 'Insert', icon: rowsPlusTopIcon, keywords: ['add row'], visible: (c) => c.can.edit, run: (c) => insertRows(c, 'above') },
  { id: 'insert.row-below', title: 'Insert rows below', section: 'Insert', icon: rowsPlusBottomIcon, keywords: ['add row'], visible: (c) => c.can.edit, run: (c) => insertRows(c, 'below') },
  { id: 'insert.col-left', title: 'Insert columns left', section: 'Insert', icon: columnsPlusLeftIcon, keywords: ['add column'], visible: (c) => c.can.edit, run: (c) => insertCols(c, 'left') },
  { id: 'insert.col-right', title: 'Insert columns right', section: 'Insert', icon: columnsPlusRightIcon, keywords: ['add column'], visible: (c) => c.can.edit, run: (c) => insertCols(c, 'right') },
  { id: 'insert.sheet', title: 'Insert sheet', section: 'Insert', icon: filePlusIcon, keywords: ['add sheet', 'tab', 'worksheet'], visible: (c) => c.can.edit, run: (c) => insertSheet(c) },
  { id: 'delete.rows', title: 'Delete rows', section: 'Edit', keywords: ['remove row'], visible: (c) => c.can.edit, run: deleteRows },
  { id: 'delete.cols', title: 'Delete columns', section: 'Edit', keywords: ['remove column'], visible: (c) => c.can.edit, run: deleteCols },
  { id: 'delete.sheet', title: 'Delete sheet', section: 'Edit', keywords: ['remove sheet', 'tab', 'worksheet'], visible: (c) => c.can.edit, run: (c) => deleteSheet(c) },

  ...AUTO.map(
    (a): Command<SheetsContext> => ({
      id: `data.auto-${a.fn.toLowerCase()}`,
      title: a.fn === 'SUM' ? 'AutoSum' : `AutoSum ${a.label.toLowerCase()}`,
      section: 'Data',
      icon: sigmaIcon,
      keywords: [a.label.toLowerCase(), ...a.keywords],
      visible: (c) => c.can.edit,
      run: (c) => autoSum(c, a.fn)
    })
  ),

  ...FREEZE.map(
    (f): Command<SheetsContext> => ({
      id: `view.freeze-${f.kind}`,
      title: f.label,
      section: 'View',
      icon: snowflakeIcon,
      keywords: ['pane', 'lock', 'header'],
      visible: (c) => c.can.edit,
      run: (c) => freeze(c, f.kind)
    })
  ),
  { id: 'view.gridlines', title: 'Show or hide gridlines', section: 'View', icon: gridFourIcon, keywords: ['lines', 'grid'], run: (c) => c.view.setGridlines(!c.view.gridlines) },
  { id: 'view.zoom-in', title: 'Zoom in', section: 'View', icon: magnifyingGlassPlusIcon, disabled: (c) => c.zoom >= ZOOM_MAX, run: (c) => zoomBy(c, ZOOM_STEP) },
  { id: 'view.zoom-out', title: 'Zoom out', section: 'View', icon: magnifyingGlassMinusIcon, disabled: (c) => c.zoom <= ZOOM_MIN, run: (c) => zoomBy(c, -ZOOM_STEP) },
  { id: 'view.zoom-100', title: 'Zoom to 100%', section: 'View', icon: magnifyingGlassPlusIcon, keywords: ['reset'], disabled: (c) => c.zoom === 100, run: (c) => c.setZoom(100) }
];

// ── the keys ────────────────────────────────────────────────────────────────

const keys: SheetsKey[] = [
  { keys: 'Mod+Z', when: (c) => c.can.edit, run: (c) => void c.model.undo() },
  { keys: 'Mod+Shift+Z', when: (c) => c.can.edit, run: (c) => void c.model.redo() },
  { keys: 'Mod+Y', when: (c) => c.can.edit, run: (c) => void c.model.redo() },
  { keys: 'Mod+/', run: (c) => c.actions.focusPalette() },
  { keys: 'Mod+-', when: (c) => c.can.edit, run: deleteByKey },
  { keys: 'Mod++', when: (c) => c.can.edit, run: insertByKey }
];

// ── the footer's items ──────────────────────────────────────────────────────

const statusItems: StatusItem<SheetsContext>[] = [
  // Not before the workbook's structure has come: there is no sheet to name or to sum.
  { id: 'status.sheet-tabs', side: 'left', order: 10, visible: (c) => c.sheets.length > 0, render: (c) => <SheetTabsStatus ctx={c} /> },
  { id: 'status.selection', side: 'right', order: 10, visible: (c) => c.sheets.length > 0, render: (c) => <SelectionStatusItem ctx={c} /> },
  { id: 'status.connection', side: 'right', order: 20, render: (c) => <ConnectionStatus ctx={c} /> }
];

const fileItems: FileItem<SheetsContext>[] = [
  { id: 'file.new', label: 'New', icon: filePlusIcon, section: 'Document', order: 100, visible: (c) => c.can.create, run: (c) => c.actions.newDocument('sheets') },
  { id: 'file.open', label: 'Open', icon: folderOpenIcon, section: 'Document', order: 200, visible: (c) => c.source.kind !== 'local', run: (c) => c.actions.openHome() },
  { id: 'file.copy', label: 'Make a copy', icon: copyIcon, section: 'Document', order: 300, visible: (c) => c.can.copy, run: (c) => c.actions.copy() },
  { id: 'file.rename', label: 'Rename', icon: pencilSimpleIcon, section: 'Document', order: 400, visible: (c) => c.can.rename, run: (c) => c.actions.focusTitle() },
  { id: 'file.history', label: 'Version history', icon: clockCounterClockwiseIcon, section: 'Share', order: 500, visible: (c) => c.can.history, run: (c) => c.panes.open('history') },
  { id: 'file.share', label: 'Share', icon: usersIcon, section: 'Share', order: 510, visible: (c) => c.can.share, run: (c) => c.actions.share() },
  { id: 'file.trash', label: 'Move to trash', icon: trashIcon, section: 'Danger', order: 900, danger: true, visible: (c) => c.can.trash, run: (c) => c.actions.trash() }
];

export const coreModule: SheetsModule = {
  id: 'core',
  ribbon,
  commands,
  keys,
  statusItems,
  fileItems,
  modes: [
    { id: 'editing', label: 'Editing', icon: pencilSimpleIcon, order: 100 },
    { id: 'viewing', label: 'Viewing', icon: eyeIcon, order: 900 }
  ]
};
