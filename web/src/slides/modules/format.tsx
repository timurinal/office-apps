/**
 * The Format module: the Format pane, and the ways into it.
 *
 *   Home › Format       a button that opens and closes the pane
 *   The pane            "Format shape" on the right edge (panes/format/FormatPane.tsx): fill, line,
 *                       size and position, the text box, alt text, the type's colour and spacing, and
 *                       a chart's data or a table's cells
 *   A right click       on a shape, a picture, a line, a chart or a table: Format shape is a row of the
 *                       menu (modules/menus.tsx)
 *   Ctrl+K              "Format shape"
 *
 * The pane is the right edge's other pane (Version history is the first; one is open at a time). A
 * reader has no use for it, so it is not offered to one, and it goes if the page becomes Viewing mode.
 */

import type { RibbonGroup } from '../../core/shell/types';
import { FormatPane } from '../panes/format/FormatPane';
import { slidersHorizontalIcon } from './insert/icons';
import type { SlidesContext, SlidesModule } from './types';

/** The pane's id: what `ctx.panes.open` takes. */
export const FORMAT_PANE = 'format';

const ribbon: RibbonGroup<SlidesContext>[] = [
  {
    id: 'home.format',
    tab: 'home',
    order: 550,
    label: 'Format',
    items: [
      {
        type: 'button',
        id: 'home.format-pane',
        label: 'Format',
        icon: slidersHorizontalIcon,
        showLabel: true,
        visible: (c) => c.can.edit,
        active: (c) => c.panes.isOpen(FORMAT_PANE),
        run: (c) => c.panes.toggle(FORMAT_PANE)
      }
    ]
  }
];

export const formatModule: SlidesModule = {
  id: 'format',
  ribbon,
  commands: [
    {
      id: 'format.pane',
      title: 'Format shape',
      section: 'Format',
      icon: slidersHorizontalIcon,
      keywords: ['fill', 'line', 'size', 'position', 'rotate', 'alt text', 'options', 'pane'],
      visible: (c) => c.can.edit,
      run: (c) => c.panes.toggle(FORMAT_PANE)
    }
  ],
  panes: [
    {
      id: FORMAT_PANE,
      side: 'right',
      title: 'Format shape',
      width: 272,
      visible: (c) => c.can.edit,
      render: (c) => <FormatPane ctx={c} />
    }
  ]
};
