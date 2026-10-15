/**
 * The data module: sorting, the filter, data validation, removing duplicates and text to columns.
 *
 *   Data  Sort and filter 100   A to Z, Z to A, custom sort, filter, clear
 *         Data tools 200        data validation, remove duplicates, text to columns
 *   Home  Sort and filter 750   the same, as one menu
 *
 * plus the keys (Ctrl+Shift+L turns the filter on or off) and the commands the Ctrl+K box runs, and the
 * filter button in a header cell, which the grid reports as an intent and this module answers by opening
 * the filter menu at it (`onIntent`). What each does is in `dataActions.ts`; the dialogs are in
 * `panes/` and are fetched when first opened.
 */

import { mod } from '../../core/keys';
import type { Command, MenuEntry, RibbonGroup } from '../../core/shell/types';
import { openTool } from '../panes/tools';
import { clearFilters, clearValidation, filterActive, filterOn, sortBy, toggleFilter } from './dataActions';
import { copyOutlineIcon, funnelIcon, funnelXIcon, listChecksIcon, sortAscendingIcon, sortDescendingIcon, textColumnsIcon } from './formatIcons';
import type { SheetsContext, SheetsKey, SheetsModule } from './types';

const cannotEdit = (c: SheetsContext): boolean => !c.can.edit;

/** A command, then the keyboard back on the grid. A dialog takes the keyboard itself, so those do not. */
const then = (fn: (c: SheetsContext) => void) => (c: SheetsContext) => {
  fn(c);
  c.actions.focusGrid();
};

const sortEntries: MenuEntry<SheetsContext>[] = [
  { label: 'Sort A to Z', icon: sortAscendingIcon, run: then((c) => sortBy(c, false)), disabled: cannotEdit },
  { label: 'Sort Z to A', icon: sortDescendingIcon, run: then((c) => sortBy(c, true)), disabled: cannotEdit },
  { label: 'Custom sort', run: () => openTool({ id: 'sort' }), disabled: cannotEdit },
  { label: 'Filter', shortcut: mod('Shift+L'), run: then(toggleFilter), active: filterOn, disabled: cannotEdit, separated: true },
  { label: 'Clear filter', icon: funnelXIcon, run: then(clearFilters), disabled: (c) => !c.can.edit || !filterActive(c) }
];

const ribbon: RibbonGroup<SheetsContext>[] = [
  {
    id: 'home.sort-filter',
    tab: 'home',
    order: 750,
    label: 'Sort and filter',
    items: [{ type: 'menu', id: 'home.sort-filter', label: 'Sort and filter', icon: funnelIcon, showLabel: true, entries: sortEntries, disabled: cannotEdit }]
  },
  {
    id: 'data.sort',
    tab: 'data',
    order: 100,
    label: 'Sort and filter',
    items: [
      { type: 'button', id: 'data.sort-az', label: 'Sort A to Z', icon: sortAscendingIcon, run: then((c) => sortBy(c, false)), disabled: cannotEdit },
      { type: 'button', id: 'data.sort-za', label: 'Sort Z to A', icon: sortDescendingIcon, run: then((c) => sortBy(c, true)), disabled: cannotEdit },
      { type: 'button', id: 'data.sort', label: 'Sort', showLabel: true, run: () => openTool({ id: 'sort' }), disabled: cannotEdit },
      { type: 'button', id: 'data.filter', label: 'Filter', shortcut: mod('Shift+L'), icon: funnelIcon, showLabel: true, active: filterOn, run: then(toggleFilter), disabled: cannotEdit },
      { type: 'button', id: 'data.clear-filter', label: 'Clear', icon: funnelXIcon, showLabel: true, run: then(clearFilters), disabled: (c) => !c.can.edit || !filterActive(c) }
    ]
  },
  {
    id: 'data.tools',
    tab: 'data',
    order: 200,
    label: 'Data tools',
    items: [
      { type: 'button', id: 'data.validation', label: 'Data validation', icon: listChecksIcon, showLabel: true, run: () => openTool({ id: 'validation' }), disabled: cannotEdit },
      { type: 'button', id: 'data.duplicates', label: 'Remove duplicates', icon: copyOutlineIcon, showLabel: true, run: () => openTool({ id: 'duplicates' }), disabled: cannotEdit },
      { type: 'button', id: 'data.split', label: 'Text to columns', icon: textColumnsIcon, showLabel: true, run: () => openTool({ id: 'split' }), disabled: cannotEdit }
    ]
  }
];

const edit = (c: SheetsContext): boolean => c.can.edit;

const commands: Command<SheetsContext>[] = [
  { id: 'data.sort-az', title: 'Sort A to Z', section: 'Data', icon: sortAscendingIcon, keywords: ['ascending', 'order'], visible: edit, run: (c) => sortBy(c, false) },
  { id: 'data.sort-za', title: 'Sort Z to A', section: 'Data', icon: sortDescendingIcon, keywords: ['descending', 'order'], visible: edit, run: (c) => sortBy(c, true) },
  { id: 'data.sort', title: 'Custom sort', section: 'Data', icon: sortAscendingIcon, keywords: ['sort by several columns', 'order'], visible: edit, run: () => openTool({ id: 'sort' }) },
  { id: 'data.filter', title: 'Turn the filter on or off', section: 'Data', icon: funnelIcon, shortcut: mod('Shift+L'), keywords: ['autofilter', 'filter rows'], visible: edit, run: toggleFilter },
  { id: 'data.clear-filter', title: 'Clear the filter', section: 'Data', icon: funnelXIcon, keywords: ['show all rows', 'reset filter'], visible: edit, disabled: (c) => !filterActive(c), run: clearFilters },
  { id: 'data.validation', title: 'Data validation', section: 'Data', icon: listChecksIcon, keywords: ['dropdown', 'list', 'allow only', 'restrict'], visible: edit, run: () => openTool({ id: 'validation' }) },
  { id: 'data.clear-validation', title: 'Clear data validation', section: 'Data', icon: listChecksIcon, keywords: ['remove dropdown'], visible: edit, run: (c) => void clearValidation(c) },
  { id: 'data.duplicates', title: 'Remove duplicates', section: 'Data', icon: copyOutlineIcon, keywords: ['unique', 'repeated rows', 'dedupe'], visible: edit, run: () => openTool({ id: 'duplicates' }) },
  { id: 'data.split', title: 'Text to columns', section: 'Data', icon: textColumnsIcon, keywords: ['split', 'separate', 'delimiter', 'csv'], visible: edit, run: () => openTool({ id: 'split' }) }
];

const keys: SheetsKey[] = [{ keys: 'Mod+Shift+L', when: edit, run: (c) => toggleFilter(c) }];

export const dataModule: SheetsModule = {
  id: 'data',
  ribbon,
  commands,
  keys,
  onIntent: (intent) => {
    if (intent.type !== 'filterMenu') return false;
    openTool({ id: 'filter', col: intent.col });
    return true;
  }
};
