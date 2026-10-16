/**
 * Slides, on the desktop: the save state in the footer, New, Open, Save and Save as, and Insert →
 * Picture. Listed last in `slides/modules/index.ts`; everything in it is hidden outside a desktop
 * window. The footer is drawn once the deck is (there is no context before), so it is ready when it is.
 *
 * Upstream's own Picture button is shown only on a server, which keeps a deck's pictures. Here the
 * window keeps them (`slidesPictures.ts`), so this module offers the same button in the same place.
 */

import { addPictureFromFile } from '../slides/modules/insert';
import { imageIcon } from '../slides/modules/insert/icons';
import type { SlidesContext, SlidesModule } from '../slides/modules/types';
import { commandRows, fileRows, SaveStatus } from './parts';
import { currentSession } from './session';

const here = (): boolean => currentSession() !== null;
const cannotInsert = (c: SlidesContext): boolean => !c.can.edit || !c.slideId;

export const desktopSlidesModule: SlidesModule = {
  id: 'desktop',
  ribbon: [
    {
      id: 'desktop.images',
      tab: 'insert',
      order: 300,
      label: 'Images',
      items: [{ type: 'button', id: 'desktop.picture', label: 'Picture', icon: imageIcon, showLabel: true, visible: here, disabled: cannotInsert, run: addPictureFromFile }]
    }
  ],
  commands: [
    ...commandRows<SlidesContext>(),
    { id: 'desktop.picture', title: 'Add a picture', section: 'Insert', icon: imageIcon, keywords: ['picture', 'image', 'photo'], visible: (c) => here() && !cannotInsert(c), run: addPictureFromFile }
  ],
  fileItems: fileRows<SlidesContext>(),
  statusItems: [{ id: 'desktop.save', side: 'left', order: 31, visible: here, render: (c) => <SaveStatus ctx={c} ready /> }]
};
