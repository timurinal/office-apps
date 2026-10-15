/**
 * A panel that floats beside the caret: the link editor, the `@` picker, the date editor.
 *
 * Fixed to the window and placed from a rectangle (`placeFloat`), under the shell so it
 * has the app's colour. It is the shell's `.oa-popover` in look and its `oa-rise` in
 * motion: 4px up as it fades in, and out by opacity. A fixed child is safe here, where the
 * ribbon's popovers are not: this one is drawn into the shell, not inside the glass
 * banner, whose `backdrop-filter` would make it the containing block.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../../motion/presence';
import { placeFloat, type Rect } from './hooks';

export function Float({
  root,
  rect,
  open,
  className,
  role,
  label,
  children
}: {
  root: HTMLElement | null;
  /** The anchor, in window coordinates. Nothing is drawn without one. */
  rect: Pick<Rect, 'top' | 'left' | 'bottom'> | null;
  open: boolean;
  className?: string;
  role?: string;
  label?: string;
  children: React.ReactNode;
}) {
  const { present, state } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  // Measured after every render: the panel's size changes with what is in it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const next = placeFloat(rect, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    setAt((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  });

  if (!root || !present || !rect) return null;
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      data-state={state}
      className={`oa-popover oa-rise oa-float${className ? ` ${className}` : ''}`}
      // Until it has been measured it is placed off the screen, not shown in the wrong place.
      style={at ? { top: at.top, left: at.left } : { top: -9999, left: -9999, visibility: 'hidden' }}
    >
      {children}
    </div>,
    root
  );
}
