/**
 * The find module: Find and Replace on Home (Editing, order 600), Ctrl+F and Ctrl+H, and the bar they
 * open (`FindBar.tsx`, state in `findStore.ts`, what a search means in `findActions.ts`).
 *
 * Ctrl+F takes the browser's find while the keyboard is on the slide list or the slide and nowhere else
 * (every module key does: types.ts), so in the command box or a dialog it is still the browser's. A
 * text box has the caret most of the time in Slides, so the bar also listens for the two keys there
 * (FindBar.tsx, `useTextBoxKeys`).
 */

import { magnifyingGlassIcon } from '../../core/icons';
import { mod } from '../../core/keys';
import type { Command, RibbonGroup } from '../../core/shell/types';
import { FindHost } from './FindBar';
import { openFind } from './findStore';
import type { SlidesContext, SlidesKey, SlidesModule } from './types';

const ribbon: RibbonGroup<SlidesContext>[] = [
  {
    id: 'home.find',
    tab: 'home',
    order: 600,
    label: 'Editing',
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

const commands: Command<SlidesContext>[] = [
  { id: 'find.find', title: 'Find', section: 'Edit', icon: magnifyingGlassIcon, shortcut: mod('F'), keywords: ['search', 'look for'], run: () => openFind() },
  { id: 'find.replace', title: 'Find and replace', section: 'Edit', icon: magnifyingGlassIcon, shortcut: mod('H'), keywords: ['search', 'substitute', 'change all'], visible: (c) => c.can.edit, run: () => openFind({ replace: true }) }
];

const keys: SlidesKey[] = [
  { keys: 'Mod+F', run: () => openFind() },
  { keys: 'Mod+H', when: (c) => c.can.edit, run: () => openFind({ replace: true }) }
];

export const findModule: SlidesModule = {
  id: 'find',
  ribbon,
  commands,
  keys,
  overlays: [{ id: 'find.bar', render: (c) => <FindHost ctx={c} /> }]
};
