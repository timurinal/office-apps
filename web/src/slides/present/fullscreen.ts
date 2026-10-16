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
 * screen on Escape ends the show (`onEscape`): Escape is how a show is left. F (`toggle`) leaves
 * and enters without ending it.
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
      const escaped = entered.current && !toggling.current;
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
