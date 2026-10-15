/**
 * The slide sorter module: a view in place of Normal (`slides/sorter/Sorter.tsx`). Adding the view is
 * all it takes to be in the View tab and the footer's switches, which draw one button per view in
 * `ctx.views` (core.tsx), and the command box has "Slide sorter view" from here.
 *
 * What is done to the slides in it (duplicate, delete, hide, New slide) is core's: the sorter works on
 * the same chosen slides the rail does, so the Home and Slide show buttons and the command box act on
 * what is chosen in it.
 */

import { squaresFourIcon } from '../../core/icons';
import { Sorter } from '../sorter/Sorter';
import type { SlidesModule } from './types';

export const sorterModule: SlidesModule = {
  id: 'sorter',
  ribbon: [],
  commands: [{ id: 'view.sorter', title: 'Slide sorter view', section: 'View', icon: squaresFourIcon, keywords: ['grid', 'thumbnails', 'reorder', 'slides'], run: (c) => c.setView('sorter') }],
  views: [{ id: 'sorter', label: 'Slide sorter', icon: squaresFourIcon, order: 100, render: (c) => <Sorter ctx={c} /> }]
};
