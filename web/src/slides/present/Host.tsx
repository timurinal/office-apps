/**
 * What `Presenter.render` draws: the show, in the form the person asked for.
 *
 * A plain show (F5, From beginning, From current slide, the Present button) is `SlideShow`. The
 * presenter's view, started by `startPresenterView` (`start.ts`), is `PresenterView`. Which one is
 * decided once, when the show mounts, from what the command left in `launch.ts`.
 */

import { useEffect, useState } from 'react';
import { clearLaunch, peekLaunch } from './launch';
import { PresenterView } from './Console';
import { SlideShow, type HostProps } from './SlideShow';

export function ShowHost(props: HostProps) {
  const [launch] = useState(() => peekLaunch());
  // Taken: what is left is for this show only.
  useEffect(() => {
    clearLaunch();
  }, []);
  return launch.mode === 'presenter' ? <PresenterView {...props} launch={launch} /> : <SlideShow {...props} />;
}
