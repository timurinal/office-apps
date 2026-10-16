/**
 * Full screen, through the Fullscreen API where there is one. Where there is not (or the browser
 * says no, as it does outside a click), the show is the whole window anyway: it is `position:
 * fixed` over the page, so the fallback needs nothing here.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';

export const fullscreenAvailable = (): boolean => typeof document !== 'undefined' && document.fullscreenEnabled === true;

/** True when `el` is now full screen. */
export async function enterFullscreen(el: HTMLElement | null): Promise<boolean> {
  if (!el || !fullscreenAvailable() || typeof el.requestFullscreen !== 'function') return false;
  try {
    await el.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

export async function leaveFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || !document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    // Already out.
  }
}

/**
 * Full screen for a show's root element. `start` asks for it when the show opens, which works
 * because it is still inside the click or the key that opened it. A browser that leaves full
 * screen on Escape ends a show that opened full screen (`onEscape`): Escape is how a show is left.
 * F (`toggle`) leaves and enters without ending it.
 *
 * A window the person put into full screen themselves, with F or F11, is never ended by the browser
 * leaving it. In Fullscreen API full screen the browser keeps Escape and F11 and tells the page only
 * that it ended (seen in headed Zen and Chromium), so a second F11 looked like an Escape and ended
 * the show in both windows. The first Escape there leaves full screen, as it does on any page, and
 * the next is the show's own.
 */
export function useFullscreen(root: RefObject<HTMLElement | null>, o: { start: boolean; onEscape: () => void }): { toggle: () => void } {
  const latest = useRef(o);
  latest.current = o;
  const entered = useRef(false);
  const toggling = useRef(false);

  useEffect(() => {
    const change = () => {
      const on = document.fullscreenElement !== null && document.fullscreenElement === root.current;
      if (on) {
        entered.current = true;
        return;
      }
      const escaped = latest.current.start && entered.current && !toggling.current;
      entered.current = false;
      toggling.current = false;
      if (escaped) latest.current.onEscape();
    };
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, [root]);

  useEffect(() => {
    if (o.start) void enterFullscreen(root.current);
    // Only when the show opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement && document.fullscreenElement === root.current) {
      toggling.current = true;
      void leaveFullscreen();
    } else void enterFullscreen(root.current);
  }, [root]);

  return { toggle };
}

/** The parts of the page `windowIsFull` reads, so a test can hand in its own. */
interface FullEnv {
  document: Pick<Document, 'fullscreenElement'>;
  window: { fullScreen?: boolean; matchMedia?: (query: string) => { matches: boolean } };
}

/**
 * Whether this window fills the screen, by any of the ways it can. An element in the Fullscreen API is what F and a
 * click ask for. The browser's own full screen, F11 in a window that script opened, is not an element at all: Firefox
 * says it in `window.fullScreen`, and the display mode says it in the browsers that have no such flag.
 */
export function windowIsFull(env: FullEnv = { document, window }): boolean {
  if (env.document.fullscreenElement) return true;
  if (env.window.fullScreen === true) return true;
  try {
    return env.window.matchMedia?.('(display-mode: fullscreen)').matches === true;
  } catch {
    return false;
  }
}

/**
 * Calls `report` with whether this window is full screen, when it opens and each time that changes. F11 resizes the
 * window and moves no Fullscreen API element, so the resize is listened to as well as `fullscreenchange`.
 */
export function useReportFull(report: ((full: boolean) => void) | undefined): void {
  useEffect(() => {
    if (!report) return;
    let last: boolean | null = null;
    const check = () => {
      const now = windowIsFull();
      if (now === last) return;
      last = now;
      report(now);
    };
    check();
    document.addEventListener('fullscreenchange', check);
    window.addEventListener('resize', check);
    let mode: MediaQueryList | undefined;
    try {
      mode = window.matchMedia?.('(display-mode: fullscreen)');
    } catch {
      // No display mode to listen to.
    }
    mode?.addEventListener?.('change', check);
    return () => {
      document.removeEventListener('fullscreenchange', check);
      window.removeEventListener('resize', check);
      mode?.removeEventListener?.('change', check);
    };
  }, [report]);
}
