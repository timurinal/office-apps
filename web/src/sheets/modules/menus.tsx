/**
 * The right-click menu over the grid: a cell or a range, a column header, a row header.
 *
 * It is the core rows (see types.ts, "The right-click menu", for the slots). What each row does is a
 * function the ribbon, the command box and the keys call too (`actions.ts`, `dataActions.ts`), so a row
 * here is a label, an icon and a call. Every row that changes the workbook is gated on `ctx.can.edit`, so
 * a reader's menu is Copy; and Cut and Copy on `ctx.can.download`, so a reader who may not copy has none.
 *
 * The width and height dialogs (panes/SizeDialog.tsx) are opened through the tools store, like every
 * other dialog, so a row here and a command in the Ctrl+K box open the same one.
 */

import type { ContextEntry, ContextGroup } from '../../core/ContextMenu';
import { clipboardTextIcon, copyIcon, eraserIcon, eyeIcon, eyeSlashIcon, trashIcon } from '../../core/icons';
import { mod } from '../../core/keys';
import type { Command } from '../../core/shell/types';
import { openTool } from '../panes/tools';
import {
  anyHidden,
  autofitLines,
  clearContents,
  copySelection,
  deleteCols,
  deleteRows,
  hideLines,
  insertCols,
  insertRows,
  pasteHere,
  type Axis
} from './actions';
import { filterOn, sortBy, toggleFilter } from './dataActions';
import { funnelIcon, selectionIcon, sortAscendingIcon, sortDescendingIcon } from './formatIcons';
import { columnsPlusLeftIcon, columnsPlusRightIcon, rowsPlusBottomIcon, rowsPlusTopIcon, scissorsIcon } from './icons';
import type { SheetsContext, SheetsMenuTarget, SheetsModule } from './types';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many.replace('#', String(n)));

/** Cut, Copy, Paste and Paste values: what each person may do. */
function clipboard(c: SheetsContext): ContextGroup {
  const items: ContextEntry[] = [];
  if (c.can.edit && c.can.download) items.push({ label: 'Cut', icon: scissorsIcon, shortcut: mod('X'), onSelect: () => void copySelection(c, true) });
  if (c.can.download) items.push({ label: 'Copy', icon: copyIcon, shortcut: mod('C'), onSelect: () => void copySelection(c, false) });
  if (c.can.edit) {
    items.push({ label: 'Paste', icon: clipboardTextIcon, shortcut: mod('V'), onSelect: () => void pasteHere(c) });
    items.push({ label: 'Paste values', icon: clipboardTextIcon, shortcut: mod('Shift+V'), onSelect: () => void pasteHere(c, 'values') });
  }
  return { id: 'menu.clipboard', order: 100, items };
}

function cellMenu(c: SheetsContext): ContextGroup[] {
  const groups = [clipboard(c)];
  if (!c.can.edit) return groups;
  groups.push({
    id: 'menu.cells',
    order: 200,
    items: [
      {
        label: 'Insert',
        submenu: [
          { label: 'Rows above', icon: rowsPlusTopIcon, onSelect: () => insertRows(c, 'above') },
          { label: 'Rows below', icon: rowsPlusBottomIcon, onSelect: () => insertRows(c, 'below') },
          { label: 'Columns left', icon: columnsPlusLeftIcon, separated: true, onSelect: () => insertCols(c, 'left') },
          { label: 'Columns right', icon: columnsPlusRightIcon, onSelect: () => insertCols(c, 'right') }
        ]
      },
      {
        label: 'Delete',
        submenu: [
          { label: 'Rows', onSelect: () => deleteRows(c) },
          { label: 'Columns', onSelect: () => deleteCols(c) }
        ]
      },
      { label: 'Clear contents', icon: eraserIcon, shortcut: 'Delete', onSelect: () => clearContents(c) }
    ]
  });
  groups.push({
    id: 'menu.data',
    order: 300,
    items: [
      {
        label: 'Sort',
        icon: sortAscendingIcon,
        submenu: [
          { label: 'Sort A to Z', icon: sortAscendingIcon, onSelect: () => sortBy(c, false) },
          { label: 'Sort Z to A', icon: sortDescendingIcon, onSelect: () => sortBy(c, true) },
          { label: 'Custom sort…', separated: true, onSelect: () => openTool({ id: 'sort' }) }
        ]
      },
      { label: 'Filter', icon: funnelIcon, shortcut: mod('Shift+L'), checked: filterOn(c), onSelect: () => toggleFilter(c) }
    ]
  });
  groups.push({ id: 'menu.format', order: 400, items: [{ label: 'Format cells…', icon: selectionIcon, shortcut: mod('1'), onSelect: () => openTool({ id: 'numfmt' }) }] });
  return groups;
}

/** The menu over a column header (`axis` col) or a row header (`row`): the same rows, said for each. */
function lineMenu(c: SheetsContext, axis: Axis, from: number, to: number): ContextGroup[] {
  const groups = [clipboard(c)];
  if (!c.can.edit) return groups;
  const n = to - from + 1;
  const col = axis === 'col';
  const noun = col ? 'column' : 'row';
  groups.push({
    id: 'menu.size',
    order: 200,
    items: [
      { label: col ? 'Column width…' : 'Row height…', onSelect: () => openTool({ id: 'size', axis }) },
      { label: col ? 'Autofit column width' : 'Autofit row height', onSelect: () => autofitLines(c, axis) }
    ]
  });
  groups.push({
    id: 'menu.cells',
    order: 300,
    items: col
      ? [
          { label: 'Insert column left', icon: columnsPlusLeftIcon, onSelect: () => insertCols(c, 'left') },
          { label: 'Insert column right', icon: columnsPlusRightIcon, onSelect: () => insertCols(c, 'right') },
          { label: plural(n, 'Delete column', 'Delete # columns'), icon: trashIcon, danger: true, onSelect: () => deleteCols(c) }
        ]
      : [
          { label: 'Insert row above', icon: rowsPlusTopIcon, onSelect: () => insertRows(c, 'above') },
          { label: 'Insert row below', icon: rowsPlusBottomIcon, onSelect: () => insertRows(c, 'below') },
          { label: plural(n, 'Delete row', 'Delete # rows'), icon: trashIcon, danger: true, onSelect: () => deleteRows(c) }
        ]
  });
  groups.push({
    id: 'menu.show',
    order: 400,
    items: [
      { label: plural(n, `Hide ${noun}`, `Hide # ${noun}s`), icon: eyeSlashIcon, onSelect: () => hideLines(c, axis, true) },
      { label: 'Unhide', icon: eyeIcon, disabled: !anyHidden(c, axis), onSelect: () => hideLines(c, axis, false) }
    ]
  });
  if (col)
    groups.push({
      id: 'menu.data',
      order: 500,
      items: [
        { label: 'Sort A to Z', icon: sortAscendingIcon, onSelect: () => sortBy(c, false) },
        { label: 'Sort Z to A', icon: sortDescendingIcon, onSelect: () => sortBy(c, true) }
      ]
    });
  return groups;
}

export function contextItems(target: SheetsMenuTarget, c: SheetsContext): ContextGroup[] {
  switch (target.kind) {
    case 'cell':
      return cellMenu(c);
    case 'col':
      return lineMenu(c, 'col', target.from, target.to);
    case 'row':
      return lineMenu(c, 'row', target.from, target.to);
  }
}

const edit = (c: SheetsContext): boolean => c.can.edit;

const commands: Command<SheetsContext>[] = [
  { id: 'edit.paste-values', title: 'Paste values', section: 'Edit', icon: clipboardTextIcon, keywords: ['paste special', 'plain', 'without formatting'], visible: edit, run: (c) => void pasteHere(c, 'values') },
  { id: 'format.col-width', title: 'Column width', section: 'Format', keywords: ['size', 'wider', 'narrower'], visible: edit, run: () => openTool({ id: 'size', axis: 'col' }) },
  { id: 'format.row-height', title: 'Row height', section: 'Format', keywords: ['size', 'taller', 'shorter'], visible: edit, run: () => openTool({ id: 'size', axis: 'row' }) },
  { id: 'format.autofit-cols', title: 'Autofit column width', section: 'Format', keywords: ['fit', 'size'], visible: edit, run: (c) => autofitLines(c, 'col') },
  { id: 'format.autofit-rows', title: 'Autofit row height', section: 'Format', keywords: ['fit', 'size'], visible: edit, run: (c) => autofitLines(c, 'row') },
  { id: 'format.hide-cols', title: 'Hide columns', section: 'Format', keywords: ['hide column'], visible: edit, run: (c) => hideLines(c, 'col', true) },
  { id: 'format.hide-rows', title: 'Hide rows', section: 'Format', keywords: ['hide row'], visible: edit, run: (c) => hideLines(c, 'row', true) },
  { id: 'format.unhide-cols', title: 'Unhide columns', section: 'Format', keywords: ['show column'], visible: edit, disabled: (c) => !anyHidden(c, 'col'), run: (c) => hideLines(c, 'col', false) },
  { id: 'format.unhide-rows', title: 'Unhide rows', section: 'Format', keywords: ['show row'], visible: edit, disabled: (c) => !anyHidden(c, 'row'), run: (c) => hideLines(c, 'row', false) }
];

export const menusModule: SheetsModule = {
  id: 'menus',
  ribbon: [],
  commands,
  contextItems
};
