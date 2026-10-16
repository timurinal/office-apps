/**
 * The slide show: the module that makes Present exist.
 *
 * It provides the `presenter` that `SlidesContext.present` starts, which turns on F5 and Shift+F5,
 * the Start group on the Slide show tab and the header's Present button (types.ts, "The slide
 * show"). Core draws From beginning, From current slide and Hide slide; this adds Presenter view,
 * which opens the audience's window and shows the speaker notes here.
 *
 * What a show does is in `present/`: `SlideShow` (full screen), `PresenterView` and
 * `AudienceWindow`, their keys in `present/keys.ts`, and the transitions in `present/transitions.ts`.
 */

import { presenter } from '../present';
import { monitorPlayIcon } from '../present/icons';
import { startPresenterView } from '../present/start';
import type { SlidesContext, SlidesModule } from './types';

const available = (c: SlidesContext): boolean => c.can.present && !!c.slideId;

export const slideshowModule: SlidesModule = {
  id: 'slideshow',
  presenter,
  ribbon: [
    {
      id: 'slideshow.presenter',
      tab: 'slideshow',
      order: 150,
      label: 'Presenter view',
      items: [
        {
          type: 'button',
          id: 'slideshow.presenter-view',
          label: 'Presenter view',
          icon: monitorPlayIcon,
          showLabel: true,
          visible: (c) => c.can.present,
          disabled: (c) => !c.slideId,
          run: (c) => startPresenterView(c)
        }
      ]
    }
  ],
  commands: [
    {
      id: 'show.presenter-view',
      title: 'Slide show in presenter view',
      section: 'View',
      icon: monitorPlayIcon,
      keywords: ['present', 'notes', 'speaker', 'second screen', 'audience'],
      visible: available,
      run: (c) => startPresenterView(c)
    }
  ]
};

