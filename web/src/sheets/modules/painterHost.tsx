/**
 * Lays the format painter's format on the selection when the pointer comes up on the grid, and puts
 * the painter away: Escape does, and so does leaving the page. While it is armed the page tells the
 * pointer (`data-painter`, tools.css).
 *
 * It listens on the document, in the capture phase, so a press the grid handles is still seen, and
 * it reads the selection a moment later, by which time the grid has made its own of the press.
 */

import { useEffect, useRef } from 'react';
import { paint } from './formatActions';
import { disarm, painterNow, usePainter } from './painter';
import type { SheetsContext } from './types';

export function PainterHost({ ctx }: { ctx: SheetsContext }) {
  const armed = usePainter() !== null;
  const latest = useRef(ctx);
  latest.current = ctx;

  useEffect(() => {
    if (!armed) return;
    const page = document.querySelector('.oa-sheet-page');
    page?.setAttribute('data-painter', 'armed');
    const up = (e: PointerEvent) => {
      const c = latest.current;
      const root = document.querySelector(`[data-sg-editor="${c.session.id}"]`)?.closest('.sg-root');
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
      setTimeout(() => {
        const lifted = painterNow();
        if (!lifted) return;
        paint(latest.current, lifted);
        disarm();
      }, 0);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') disarm();
    };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('keydown', key);
      page?.removeAttribute('data-painter');
    };
  }, [armed]);

  useEffect(() => () => disarm(), []);
  return null;
}
