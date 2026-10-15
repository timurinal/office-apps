/**
 * The Sheets modules, in the order they are drawn.
 *
 * Add a module by writing `modules/<name>.tsx` and listing it here. That is the whole seam: the
 * editor reads this array and builds its ribbon, commands, keys, panes, footer items, File menu,
 * modes and overlays from it. The order only breaks ties; ribbon groups are placed by `tab` and
 * `order` (see types.ts for the slots), and footer items and File rows by their own `order`.
 */

import { chartsModule } from './charts';
import { coreModule } from './core';
import { dataModule } from './data';
import { filesModule } from './files';
import { findModule } from './find';
import { formatModule } from './format';
import { formulasModule } from './formulas';
import { toolsModule } from './tools';
import type { SheetsModule } from './types';

export const SHEETS_MODULES: readonly SheetsModule[] = [coreModule, chartsModule, formatModule, dataModule, formulasModule, findModule, toolsModule, filesModule];

export type { SheetsContext, SheetsModule } from './types';
export { SHEETS_TABS } from './types';
