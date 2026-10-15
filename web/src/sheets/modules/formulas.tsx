/**
 * The formulas module: putting a function into a formula, defined names, and Show formulas.
 *
 *   Formulas  Function library 100  Insert function, and a menu of the common ones for each kind
 *             Defined names 200     the name manager, define a name for the selection
 *             Calculation 300       Show formulas
 *   View      Formulas 160          Show formulas, beside Gridlines
 *
 * Show formulas is the viewer's own: it is not stored and nobody else sees it (`model.setShowFormulas`).
 * What the rest does is in `formulaActions.ts`; the dialogs are in `panes/`.
 */

import type { Command, MenuEntry, RibbonGroup } from '../../core/shell/types';
import { openTool } from '../panes/tools';
import { calculatorIcon, functionIcon, tagIcon } from './formatIcons';
import { insertFunction } from './formulaActions';
import type { SheetsContext, SheetsModule } from './types';

const cannotEdit = (c: SheetsContext): boolean => !c.can.edit;

/** The functions people reach for in each kind: a short list, the dialog has the rest. */
const COMMON: { id: string; label: string; names: string[] }[] = [
  { id: 'math', label: 'Math', names: ['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'MOD', 'INT', 'POWER', 'SQRT', 'RAND', 'RANDBETWEEN'] },
  { id: 'stats', label: 'Statistical', names: ['AVERAGE', 'AVERAGEIF', 'COUNT', 'COUNTA', 'COUNTIF', 'COUNTIFS', 'MAX', 'MIN', 'MEDIAN', 'STDEV', 'LARGE', 'SMALL', 'RANK'] },
  { id: 'logical', label: 'Logical', names: ['IF', 'IFS', 'AND', 'OR', 'NOT', 'IFERROR', 'SWITCH', 'XOR'] },
  { id: 'lookup', label: 'Lookup', names: ['XLOOKUP', 'VLOOKUP', 'HLOOKUP', 'INDEX', 'MATCH', 'XMATCH', 'CHOOSE', 'ROW', 'COLUMN'] },
  { id: 'text', label: 'Text', names: ['CONCAT', 'TEXTJOIN', 'LEFT', 'RIGHT', 'MID', 'LEN', 'TRIM', 'UPPER', 'LOWER', 'PROPER', 'SUBSTITUTE', 'TEXT', 'VALUE'] },
  { id: 'date', label: 'Date and time', names: ['TODAY', 'NOW', 'DATE', 'DAY', 'MONTH', 'YEAR', 'WEEKDAY', 'EDATE', 'EOMONTH', 'NETWORKDAYS', 'DATEDIF'] },
  { id: 'financial', label: 'Financial', names: ['PMT', 'PV', 'FV', 'NPV', 'IRR', 'RATE', 'NPER'] }
];

const entries = (names: string[]): MenuEntry<SheetsContext>[] =>
  names.map((n) => ({ label: n, run: (c) => void insertFunction(c, n), disabled: cannotEdit }));

const toggleFormulas = (c: SheetsContext): void => c.model.setShowFormulas(!c.model.showFormulas);

const ribbon: RibbonGroup<SheetsContext>[] = [
  {
    id: 'formulas.library',
    tab: 'formulas',
    order: 100,
    label: 'Function library',
    items: [
      { type: 'button', id: 'formulas.insert', label: 'Insert function', icon: functionIcon, showLabel: true, run: () => openTool({ id: 'function' }), disabled: cannotEdit },
      ...COMMON.map((g) => ({ type: 'menu' as const, id: `formulas.${g.id}`, label: g.label, showLabel: true, entries: entries(g.names), disabled: cannotEdit }))
    ]
  },
  {
    id: 'formulas.names',
    tab: 'formulas',
    order: 200,
    label: 'Defined names',
    items: [
      { type: 'button', id: 'formulas.name-manager', label: 'Name manager', icon: tagIcon, showLabel: true, run: () => openTool({ id: 'names' }) },
      { type: 'button', id: 'formulas.define-name', label: 'Define name', showLabel: true, run: () => openTool({ id: 'names', fromSelection: true }), disabled: cannotEdit }
    ]
  },
  {
    id: 'formulas.calc',
    tab: 'formulas',
    order: 300,
    label: 'Calculation',
    items: [{ type: 'button', id: 'formulas.show', label: 'Show formulas', icon: calculatorIcon, showLabel: true, active: (c) => c.model.showFormulas, run: toggleFormulas }]
  },
  {
    id: 'view.formulas',
    tab: 'view',
    order: 160,
    label: 'Formulas',
    items: [{ type: 'button', id: 'view.show-formulas', label: 'Show formulas', icon: calculatorIcon, showLabel: true, active: (c) => c.model.showFormulas, run: toggleFormulas }]
  }
];

const commands: Command<SheetsContext>[] = [
  { id: 'formulas.insert', title: 'Insert function', section: 'Insert', icon: functionIcon, keywords: ['formula', 'fx', 'sum', 'vlookup'], visible: (c) => c.can.edit, run: () => openTool({ id: 'function' }) },
  { id: 'formulas.name-manager', title: 'Name manager', section: 'Data', icon: tagIcon, keywords: ['defined names', 'named range'], run: () => openTool({ id: 'names' }) },
  { id: 'formulas.define-name', title: 'Define a name for the selection', section: 'Data', icon: tagIcon, keywords: ['named range'], visible: (c) => c.can.edit, run: () => openTool({ id: 'names', fromSelection: true }) },
  { id: 'formulas.show', title: 'Show or hide formulas', section: 'View', icon: calculatorIcon, keywords: ['display formulas', 'audit'], run: toggleFormulas }
];

export const formulasModule: SheetsModule = { id: 'formulas', ribbon, commands };
