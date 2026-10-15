/**
 * Slides, on the desktop: the save state in the footer, and New, Open, Save and Save as.
 * Listed last in `slides/modules/index.ts`; everything in it is hidden outside a desktop window.
 * The footer is drawn once the deck is (there is no context before), so it is ready when it is.
 */

import type { SlidesContext, SlidesModule } from '../slides/modules/types';
import { commandRows, fileRows, SaveStatus } from './parts';
import { currentSession } from './session';

export const desktopSlidesModule: SlidesModule = {
  id: 'desktop',
  ribbon: [],
  commands: commandRows<SlidesContext>(),
  fileItems: fileRows<SlidesContext>(),
  statusItems: [{ id: 'desktop.save', side: 'left', order: 31, visible: () => currentSession() !== null, render: (c) => <SaveStatus ctx={c} ready /> }]
};
