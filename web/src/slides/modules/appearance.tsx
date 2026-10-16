/**
 * Appearance in Slides: the theme, shared with the other editors.
 *
 * The editor's own chrome (the ribbon, the rail, the panes, the notes) follows the page, as Docs and
 * Sheets do (core/appearance.ts `editorTheme`). The slides themselves never change with it: a slide is
 * the deck's own colours, and the slide show and the presenter's view are dark whatever the choice.
 *
 *   View   Appearance 400  Theme (after Zoom, 300)
 */

import { appearanceCommands, appearanceGroup } from '../../core/appearanceRibbon';
import type { SlidesContext, SlidesModule } from './types';

export const appearanceModule: SlidesModule = {
  id: 'appearance',
  ribbon: [appearanceGroup<SlidesContext>(400)],
  commands: appearanceCommands<SlidesContext>()
};
