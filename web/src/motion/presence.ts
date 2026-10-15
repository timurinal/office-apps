/**
 * Keeping something on screen for the moment it takes to leave.
 *
 * React removes an element the instant its condition goes false, which leaves no
 * time for the 120ms exit the design asks for. `usePresence` holds it mounted a
 * little longer and says which way it is going, so the element can wear
 * `data-state="closed"` and a CSS rule can fade it out.
 *
 *   const { present, state } = usePresence(open);
 *   return present ? <div className="oa-pop" data-state={state}>…</div> : null;
 *
 * The exit is opacity only under reduced motion, and the same length: the
 * element still has to be there for the fade.
 */

import { useEffect, useState } from 'react';
import { DUR } from './index';

export function usePresence(open: boolean, exitMs: number = DUR.fast): { present: boolean; state: 'open' | 'closed' } {
  const [held, setHeld] = useState(open);

  useEffect(() => {
    if (open) {
      setHeld(true);
      return;
    }
    const id = setTimeout(() => setHeld(false), exitMs);
    return () => clearTimeout(id);
  }, [open, exitMs]);

  return { present: open || held, state: open ? 'open' : 'closed' };
}
