/**
 * A panel that floats beside the control that opened it, for a control inside a pane. The pane clips
 * what overflows it (it is a rounded glass panel), so a popover drawn inside it would be cut off;
 * this one is in a portal and fixed to the window, placed from the button's rectangle: under it and
 * flush with its right edge, or above it where there is no room below.
 *
 * It wears the app's colours itself (a portal is outside the editor's root), rises 4 px as it fades
 * in and leaves by opacity, and closes on Escape and on a press anywhere but on its button and
 * itself.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { useEditorTheme } from '../../../core/appearance';
import { usePresence } from '../../../motion/presence';

export function FloatPanel({
  anchor,
  open,
  onClose,
  label,
  children
}: {
  /** The button that opened it. */
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const { present, state } = usePresence(open);
  // Slides' chrome is dark unless the reader chose Light; a portal does not inherit it from the shell.
  const theme = useEditorTheme('slides');
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const a = anchor.current;
    const p = panel.current;
    if (!open || !a || !p) return;
    const r = a.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
    setAt((prev) => (prev && prev.left === left && prev.top === top ? prev : { top, left }));
  });

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close.current();
      anchor.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open, anchor]);

  if (!present) return null;
  return createPortal(
    <div data-app="slides" data-theme={theme} style={{ display: 'contents' }}>
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        data-state={state}
        className="oa-popover oa-rise sl-float"
        style={at ? { top: at.top, left: at.left } : { top: -9999, left: -9999, visibility: 'hidden' }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
