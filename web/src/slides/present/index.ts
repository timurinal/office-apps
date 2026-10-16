/**
 * The slide show: what `modules/slideshow.tsx` provides as the deck's presenter, and what the page
 * needs to open an audience window.
 *
 *   presenter                     the `Presenter` a module hands the editor
 *   PresentMenu                   the header's Present button with its chevron menu
 *   AudienceWindow, AudienceSkeleton, audienceParams   `/slides/<id>?present=audience`, for SlidesPage
 *   startPresenterView            what the Presenter view button and command run
 */

import { createElement } from 'react';
import type { Presenter } from '../modules/types';
import { ShowHost } from './Host';

export const presenter: Presenter = {
  render: (ctx, show) => createElement(ShowHost, { ctx, from: show.from, close: show.close })
};

export { PresentMenu } from './PresentMenu';
export { AudienceSkeleton, AudienceWindow, type AudienceWindowProps } from './AudienceWindow';
export { audienceParams, audienceUrl, type AudienceParams } from './window';
export { startPresenterView } from './start';
