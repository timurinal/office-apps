/**
 * The audience's window: its address, and opening it.
 *
 * `/slides/<id>?present=audience&show=<token>&at=<index>` is the same page as the editor's, which
 * shows the slide and nothing else when it sees `present=audience` (`AudienceWindow`). Whatever
 * else the address carries is kept, so a person who reached the deck some other way reaches it
 * from this window too. `show` names the channel the two windows talk on; without one the window
 * is a show of its own.
 */

import { SHOW_TOKEN } from './protocol';

export interface AudienceParams {
  /** The show's token, or null: a window opened by hand, which runs alone. */
  show: string | null;
  /** The slide to start on, from 0. */
  at: number;
}

/** What the address says, or null when it is not an audience window's. */
export function audienceParams(query: URLSearchParams): AudienceParams | null {
  if (query.get('present') !== 'audience') return null;
  const token = query.get('show');
  const at = Number(query.get('at'));
  return { show: token && SHOW_TOKEN.test(token) ? token : null, at: Number.isInteger(at) && at >= 0 && at < 100_000 ? at : 0 };
}

/** The audience window's address, relative, for the page at `here`. */
export function audienceUrl(here: { pathname: string; search: string }, show: string, at: number): string {
  const params = new URLSearchParams(here.search);
  for (const k of ['present', 'show', 'at']) params.delete(k);
  params.set('present', 'audience');
  params.set('show', show);
  params.set('at', String(Math.max(0, Math.floor(at))));
  // One slash at the start: `//host` would be another origin.
  return `/${here.pathname.replace(/^\/+/, '')}?${params.toString()}`;
}

/** A name for the window, so asking again for this show's window reuses it. */
export const audienceWindowName = (show: string): string => `oa-audience-${show}`;

/** The size a new audience window starts at: a 16:9 slide with room around it. */
const FEATURES = 'popup=yes,width=1280,height=760';

/**
 * Opens it. Null when the browser refuses, which is what a pop-up blocker does outside a click:
 * the caller says so and offers to try again from one.
 */
export function openAudienceWindow(url: string, show: string, open: typeof window.open = (...a) => window.open(...a)): Window | null {
  try {
    return open(url, audienceWindowName(show), FEATURES);
  } catch {
    return null;
  }
}
