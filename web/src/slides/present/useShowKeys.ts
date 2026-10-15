/**
 * The keyboard while a show is on screen: the show has all of it.
 *
 * One listener on the window, in the capture phase, so a key is the show's before it is the
 * editor's. The page under the show still has its text box focused or its slide selected, and Delete,
 * a letter or Ctrl+Z must not reach it. What the show does not take is the browser's own (reload
 * and close, the tools, leaving full screen), which `onKey` leaves alone.
 *
 * In the presenter's view the buttons are the keyboard's: Tab moves among them and Enter or Space
 * presses the one with focus. Everywhere else those are Next.
 */

import { useEffect, useRef, type RefObject } from 'react';
import type { ShowHandle } from './useShow';

export function useShowKeys(root: RefObject<HTMLElement | null>, show: ShowHandle | null, o: { buttons?: boolean } = {}): void {
  const latest = useRef({ show, buttons: o.buttons === true });
  latest.current = { show, buttons: o.buttons === true };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { show: h, buttons } = latest.current;
      if (!h || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      const inside = !!target && !!root.current?.contains(target);
      // Focus that wandered out (a dialog closed, a click on nothing) comes back to the show.
      if (!inside) root.current?.focus({ preventScroll: true });
      if (buttons && inside) {
        if ((e.key === 'Enter' || e.key === ' ') && target!.closest('button')) {
          e.stopPropagation();
          return;
        }
        if (e.key === 'Tab') {
          e.stopPropagation();
          e.preventDefault();
          const all = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
          if (!all.length) return;
          const at = all.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : (at + 1) % all.length;
          all[next]?.focus();
          return;
        }
      }
      const handled = h.key(e);
      e.stopPropagation();
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [root]);
}
