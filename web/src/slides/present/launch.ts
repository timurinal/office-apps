/**
 * How the next show starts, handed from the button that asked to the show that mounts.
 *
 * `SlidesContext.present(from)` takes only a slide, so what else a start needs (the presenter's
 * view rather than a plain show, and the audience window already opened) is left here by the
 * command and picked up by the show a moment later. A window has to be opened in the click that
 * asked for it or a pop-up blocker refuses it, which is why it is opened before the show exists.
 *
 * What is left here is for the next show only, and goes stale after `FRESH_MS`: a command that
 * left it and then found no slides to show must not turn the next F5 into a presenter's view.
 */

export type ShowMode = 'present' | 'presenter';

export interface Launch {
  mode: ShowMode;
  /** The token naming the channel the windows talk on. Null for a show in one window. */
  show: string | null;
  /** The audience window the command opened, or null if the browser refused. */
  audience: Window | null;
}

const FRESH_MS = 2000;

export const PLAIN: Launch = { mode: 'present', show: null, audience: null };

let pending: { launch: Launch; at: number } | null = null;

export function setLaunch(launch: Launch, now: number = Date.now()): void {
  pending = { launch, at: now };
}

/** What the show that is mounting should start as. Reading it does not use it up: a development build mounts twice. */
export function peekLaunch(now: number = Date.now()): Launch {
  return pending && now - pending.at <= FRESH_MS ? pending.launch : PLAIN;
}

export function clearLaunch(): void {
  pending = null;
}
