/** The page's theme, told to the shell so that its title bar and tab strip match (docs/desktop-bridge.md). */

import { appearanceState, subscribeAppearance } from '../core/appearance';
import type { DesktopClient, Theme } from './bridge';

/** Tell the shell the page's theme now and on every change. Answers a function that stops. */
export function followTheme(client: Pick<DesktopClient, 'setTheme'>): () => void {
  let sent: Theme | null = null;
  const send = () => {
    const theme = appearanceState().theme;
    if (theme === sent) return;
    sent = theme;
    client.setTheme(theme);
  };
  send();
  return subscribeAppearance(send);
}
