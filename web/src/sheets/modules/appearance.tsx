/**
 * Appearance in Sheets: the theme, shared with the other editors, and Dark cells.
 *
 * The grid's own chrome, its headers, gridlines and automatic text, follow the theme through the
 * tokens (grid/grid.css). What a person set stays as set; Dark cells draws those colours the way a
 * dark page draws a document's (core/darkColors.ts), for this reader and in the dark theme. It is
 * the reader's alone (sheets/darkCells.ts), not in the workbook.
 *
 *   View   Appearance 250  Theme, Dark cells
 */

import moonRaw from '@phosphor-icons/core/assets/regular/moon.svg?raw';
import { appearanceCommands, appearanceGroup } from '../../core/appearanceRibbon';
import { Icon, ph } from '../../core/icons';
import type { Command, RibbonGroup } from '../../core/shell/types';
import { darkCellsPref } from '../darkCells';
import type { SheetsContext, SheetsModule } from './types';

const moonIcon = /* @__PURE__ */ ph(moonRaw);

/** A custom item, because what it shows is the reader's and not in the context. */
export function DarkCellsSwitch() {
  const on = darkCellsPref.use();
  return (
    <button
      type="button"
      data-rb-item
      data-id="view.dark-cells"
      className="oa-rb-tl"
      aria-pressed={on}
      title="Draw the fills and text colours you set for a dark ground"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => darkCellsPref.set(!on)}
    >
      <Icon icon={moonIcon} size={16} />
      Dark cells
    </button>
  );
}

const theme = appearanceGroup<SheetsContext>(250);
const ribbon: RibbonGroup<SheetsContext>[] = [{ ...theme, items: [...theme.items, { type: 'custom', id: 'view.dark-cells', render: () => <DarkCellsSwitch /> }] }];

const commands: Command<SheetsContext>[] = [
  ...appearanceCommands<SheetsContext>(),
  { id: 'view.dark-cells', title: 'Dark cells', section: 'View', icon: moonIcon, keywords: ['dark', 'fills', 'colours', 'theme'], run: () => darkCellsPref.set(!darkCellsPref.get()) }
];

export const appearanceModule: SheetsModule = { id: 'appearance', ribbon, commands };
