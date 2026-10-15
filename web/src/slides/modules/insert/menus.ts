/**
 * What the Insert, Design and Format modules' own ribbon controls share: a press on a ribbon button
 * must not take the keyboard from the slide, and a popover opens from the edge of its button that
 * leaves it on the page.
 */

import { useState } from 'react';
import type React from 'react';

/** A mouse-down on a ribbon button is swallowed, as the shell's own buttons do, so the selection stays. */
export const keepSelection = (e: React.MouseEvent): void => e.preventDefault();

/** A popover's open state, and which edge of its button it hangs from: the right one where the left would run off the page. */
export function useOpen(width = 260) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<'left' | 'right'>('left');
  return {
    open,
    align,
    setOpen,
    close: () => setOpen(false),
    toggle: (e: React.MouseEvent<HTMLElement>) => {
      setAlign(e.currentTarget.getBoundingClientRect().left + width > window.innerWidth - 8 ? 'right' : 'left');
      setOpen((v) => !v);
    }
  };
}
