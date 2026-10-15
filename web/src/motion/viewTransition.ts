/**
 * The View Transitions API, with the fade as its fallback.
 *
 * A route change or a dialog opening can morph one element into another (a card
 * becomes the page, the Share button becomes its dialog). The browser snapshots
 * both and animates between them; where it cannot, the new content simply plays
 * its own enter animation (`.oa-page`, `.oa-pop` in styles.css) and the result is
 * a fade, which is what the design says to fall back to.
 *
 * `update` must change the DOM before it returns. With React that means
 * `flushSync(() => navigate(...))`; a state set that lands a tick later is
 * missed by the snapshot and the browser animates nothing.
 *
 * The named elements are given `view-transition-name` only for the length of the
 * transition, because a name must be unique on the page and two cards would
 * otherwise clash.
 *
 * **The landing element must stay.** The browser ends a morph the moment the element
 * it lands on leaves the document, so a route that draws a skeleton and swaps it for
 * the real page a few milliseconds on loses the morph after about 50ms of 280. The update
 * callback may take its time (the old frame stays up until it settles), so `settleMs`
 * lets it wait, briefly, for an element that `stays` says is the one that will remain.
 */

import { motionOff } from './index';

type StartViewTransition = (update: () => void | Promise<void>) => { finished: Promise<void> };

export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition === 'function';
}

export interface MorphOptions {
  /** The element that grows from, as it is before the update. */
  from?: HTMLElement | null;
  /** Where it lands, looked up after the update has run. */
  to?: () => HTMLElement | null;
  /** The shared name. Default `oa-morph`. */
  name?: string;
  /** Whether `to`'s element is the one that will stay (not a placeholder about to be replaced). */
  stays?: (el: HTMLElement) => boolean;
  /** The longest to wait for a landing element that `stays`. Without it, or 0, the first one found is used. */
  settleMs?: number;
}

const setName = (el: HTMLElement | null | undefined, name: string): void => {
  if (el) el.style.setProperty('view-transition-name', name);
};

/**
 * The landing element: the first one `to` finds, or, when `settleMs` says to wait, the first
 * that `stays`, and failing that (the page is slow, or never comes) the best there is.
 */
export function landing(morph: Pick<MorphOptions, 'to' | 'stays' | 'settleMs'>): Promise<HTMLElement | null> {
  const find = () => morph.to?.() ?? null;
  const { stays, settleMs = 0 } = morph;
  const first = find();
  if (!stays || settleMs <= 0 || (first && stays(first))) return Promise.resolve(first);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(find());
    };
    const check = () => {
      const el = find();
      if (el && stays(el)) finish();
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(finish, settleMs);
  });
}

export async function viewTransition(update: () => void | Promise<void>, morph: MorphOptions = {}): Promise<void> {
  if (!supportsViewTransitions() || motionOff()) {
    await update();
    return;
  }

  const name = morph.name ?? 'oa-morph';
  const root = document.documentElement;
  setName(morph.from, name);
  root.classList.add('oa-vt');

  let landed: HTMLElement | null = null;
  const start = (document as unknown as { startViewTransition: StartViewTransition }).startViewTransition.bind(document);
  try {
    const t = start(async () => {
      // The old snapshot is already taken: the name has done its job on this side.
      morph.from?.style.removeProperty('view-transition-name');
      await update();
      landed = await landing(morph);
      setName(landed, name);
    });
    await t.finished;
  } catch {
    // An aborted transition (another started, the document hid) leaves the update
    // applied, which is all that matters.
  } finally {
    morph.from?.style.removeProperty('view-transition-name');
    (landed as HTMLElement | null)?.style.removeProperty('view-transition-name');
    root.classList.remove('oa-vt');
  }
}
