/**
 * The find module: Find and Replace on Home (Find 800), and Ctrl+F and Ctrl+H in the grid.
 *
 * The bar itself is `panes/FindBar.tsx` and its state is `panes/findStore.ts`; what a search means is in
 * `findActions.ts`. Ctrl+F takes the browser's find while the keyboard is in the grid and nowhere else,
 * as every key does (keys.ts), so in the command box or a dialog it is still the browser's.
 */

import { magnifyingGlassIcon } from '../../core/icons';
import { mod } from '../../core/keys';
import type { Command, RibbonGroup } from '../../core/shell/types';
import { openFind } from '../panes/findStore';
import type { SheetsContext, SheetsKey, SheetsModule } from './types';

const ribbon: RibbonGroup<SheetsContext>[] = [
  {
    id: 'home.find',
    tab: 'home',
    order: 800,
    label: 'Find',
    items: [
      {
        type: 'menu',
        id: 'home.find',
        label: 'Find',
        icon: magnifyingGlassIcon,
        entries: [
          { label: 'Find', shortcut: mod('F'), run: () => openFind() },
          { label: 'Replace', shortcut: mod('H'), run: () => openFind({ replace: true }), disabled: (c) => !c.can.edit }
        ]
      }
    ]
  }
];

const commands: Command<SheetsContext>[] = [
  { id: 'find.find', title: 'Find', section: 'Edit', icon: magnifyingGlassIcon, shortcut: mod('F'), keywords: ['search', 'look for'], run: () => openFind() },
  { id: 'find.replace', title: 'Find and replace', section: 'Edit', icon: magnifyingGlassIcon, shortcut: mod('H'), keywords: ['search', 'substitute', 'change all'], visible: (c) => c.can.edit, run: () => openFind({ replace: true }) }
];

const keys: SheetsKey[] = [
  { keys: 'Mod+F', run: () => openFind() },
  { keys: 'Mod+H', when: (c) => c.can.edit, run: () => openFind({ replace: true }) }
];

export const findModule: SheetsModule = { id: 'find', ribbon, commands, keys };
