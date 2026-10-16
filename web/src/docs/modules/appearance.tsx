/**
 * Appearance in Docs: the theme, shared with the other editors, and the page's own colour.
 *
 * Page colour is Auto (it follows the theme), White, Sepia or Dark, and is the reader's alone
 * (docs/pageColour.ts). It is in the View tab and, as four dots, in the footer beside the layout
 * switch, where a reader who wants a dark page for the evening can reach it without a tab.
 */

import { appearanceCommands, appearanceGroup } from '../../core/appearanceRibbon';
import { paintBucketIcon } from '../../core/icons';
import type { Command, MenuEntry, RibbonGroup } from '../../core/shell/types';
import { PAGE_COLOURS, pageColourPref, usePageColour } from '../pageColour';
import type { DocsContext, DocsModule } from './types';

const entries: MenuEntry<DocsContext>[] = PAGE_COLOURS.map((c) => ({
  label: c.label,
  active: () => pageColourPref.get() === c.id,
  run: () => pageColourPref.set(c.id)
}));

const ribbon: RibbonGroup<DocsContext>[] = [
  // After Views (50) and Navigation (100).
  {
    id: 'view.page-colour',
    tab: 'view',
    order: 200,
    label: 'Page colour',
    items: [{ type: 'menu', id: 'view.page-colour', label: 'Page colour', icon: paintBucketIcon, showLabel: true, entries }]
  },
  appearanceGroup<DocsContext>(300)
];

const commands: Command<DocsContext>[] = [
  ...appearanceCommands<DocsContext>(),
  ...PAGE_COLOURS.map<Command<DocsContext>>((c) => ({
    id: `view.page-colour-${c.id}`,
    title: `Page colour: ${c.label}`,
    section: 'View',
    icon: paintBucketIcon,
    keywords: ['sepia', 'dark page', 'white page', 'background'],
    run: () => pageColourPref.set(c.id)
  }))
];

/** Four dots: Auto, White, Sepia, Dark. */
export function PageColourSwitch() {
  const { colour, set } = usePageColour();
  return (
    <span role="group" aria-label="Page colour" className="hide-sm" style={{ display: 'inline-flex', gap: 2 }}>
      {PAGE_COLOURS.map((c) => (
        <button
          key={c.id}
          type="button"
          className="oa-sb"
          aria-pressed={colour === c.id}
          aria-label={`Page colour: ${c.label}`}
          title={`Page colour: ${c.label}`}
          onClick={() => set(c.id)}
        >
          <span className="oa-pc-dot" data-pc={c.id} aria-hidden="true" />
        </button>
      ))}
    </span>
  );
}

export const appearanceModule: DocsModule = {
  id: 'appearance',
  extensions: [],
  ribbon,
  commands,
  statusItems: [{ id: 'appearance.page-colour', side: 'right', order: 12, render: () => <PageColourSwitch /> }]
};
