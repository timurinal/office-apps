/**
 * The header row and the footer, short of room. Each takes steps, least needed first, until
 * nothing in it overflows: `data-squeeze` lists the steps taken, and shell.css says what each one
 * hides (`[data-squeeze~='words']`). The title never goes: it ends in an ellipsis instead.
 *
 *   header   title    the title has the room first: the search narrows to its least, and stops
 *                     being held in the middle
 *            words    the buttons on the right drop their words and keep their icons
 *            extras   the save state, the note and the star go
 *   footer   slider   the zoom slider goes; minus, plus and the percentage stay
 *            words    words beside a dot or an icon go ("Connected", "Notes")
 *            extras   the view switches, the page colour and Fit go
 *            zoom     minus and plus go, and the percentage stays; Ctrl and the wheel still zoom
 *
 * The bar is measured again when it changes size and, at most once a frame, when what it holds
 * changes (a count, a name, a person joining). Each measure starts from no steps, so room that
 * comes back is given back.
 */

import { useLayoutEffect, useRef, type RefObject } from 'react';

export const HEADER_STEPS = ['title', 'words', 'extras'] as const;
export const FOOTER_STEPS = ['slider', 'words', 'extras', 'zoom'] as const;

/** The bar, or one of its parts, holds more than its width: something is over something else. */
export function overflows(el: HTMLElement): boolean {
  const over = (e: Element) => e.scrollWidth > e.clientWidth + 1;
  return over(el) || Array.from(el.children).some(over);
}

/**
 * Keeps `ref`'s element at the fewest of `steps` that leave nothing overflowing. `tight` is a
 * reason of the caller's own to take the next step, asked after each one.
 */
export function useSqueeze(ref: RefObject<HTMLElement | null>, steps: readonly string[], tight?: (el: HTMLElement) => boolean): void {
  const latest = useRef({ steps, tight });
  latest.current = { steps, tight };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const { steps, tight } = latest.current;
      let n = 0;
      const show = () => {
        if (n) el.dataset.squeeze = steps.slice(0, n).join(' ');
        else delete el.dataset.squeeze;
      };
      show();
      while (n < steps.length && (overflows(el) || tight?.(el))) {
        n++;
        show();
      }
    };
    let frame = 0;
    const soon = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };
    fit();
    // The bar's own size does not follow what it holds, so a step never resizes what is observed.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const mo = new MutationObserver(soon);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    void document.fonts?.ready.then(soon);
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}
