/**
 * Starting the show in the presenter's view: open the audience's window, leave what the show needs
 * to know about it (`launch.ts`), then start as any show starts. The window is opened first, in the
 * click, because a pop-up opened later is a pop-up the browser blocks.
 */

import type { SlidesContext } from '../modules/types';
import { setLaunch } from './launch';
import { newShowToken } from './protocol';
import { audienceUrl, openAudienceWindow } from './window';

export const POPUP_BLOCKED = 'Allow pop-ups to show the audience window.';

export function startPresenterView(
  ctx: Pick<SlidesContext, 'present' | 'slideIndex' | 'notify'> & { model: { order: () => readonly string[] } },
  here: { pathname: string; search: string } = window.location,
  open: typeof openAudienceWindow = openAudienceWindow
): void {
  if (!ctx.model.order().length) return;
  const from = Math.max(0, ctx.slideIndex);
  const show = newShowToken();
  const audience = open(audienceUrl(here, show, from), show);
  setLaunch({ mode: 'presenter', show, audience });
  // The presenter's view offers to try again from a click, which is the only place a browser lets it.
  if (!audience) ctx.notify({ text: POPUP_BLOCKED, tone: 'danger' });
  ctx.present(from);
}
