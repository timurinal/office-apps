/**
 * Dark cells: the reader's choice to have a sheet's fills and text colours drawn as a dark ground
 * would draw them (core/darkColors.ts), in the dark theme. Off, they stay exactly as set. It is
 * kept in this browser (core/pref.ts) and is never in the workbook: what is stored, exported and
 * seen by anyone else is the colours as they were set.
 */

import { createPref } from '../core/pref';

export const DARK_CELLS_KEY = 'office.sheets.dark-cells';

export const darkCellsPref = createPref<boolean>({ key: DARK_CELLS_KEY, parse: (raw) => raw === 'on', serialize: (v) => (v ? 'on' : 'off') });
