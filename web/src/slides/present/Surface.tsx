/**
 * What the audience sees: the slide, as large as the window lets it be, on black.
 *
 * Presentational. The window that shows it (the editor's, the audience's, the presenter's own copy)
 * decides the slide, the screen and the laser; this draws them, and turns a click, a tap or a swipe
 * into an action and the pointer into where the laser is.
 *
 * The cursor goes after two seconds without moving, and is always gone while the laser is on. The
 * laser is a red dot moved by `transform` and never by React state, so following the pointer costs
 * no render. Black, white and the end of the show fade in as opacity.
 */

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Aspect } from '../model/deck';
import type { Design } from '../model/styles';
import { slideHeight } from '../render/SlideView';
import { fitWidth } from './fit';
import type { ShowAction, Screen } from './state';
import { Stage, type Animator, type Shown } from './Stage';
import { useSize } from './useSize';
import type { Pointer } from './useShow';
import './present.css';

/** The cursor is hidden after this long without moving. */
export const IDLE_MS = 2000;
/** A press that moves further than this is a swipe or a drag and not a click. */
const CLICK_SLOP = 10;
const SWIPE = 60;

export interface SurfaceProps {
  design: Design & { size: Aspect };
  shown: Shown | null;
  screen: Screen;
  laser: boolean;
  /** The other window's laser, as fractions of the slide. */
  remote: Pointer | null;
  /** This window's laser moved: fractions of the slide, or null when it left. */
  onPointer?: (at: Pointer | null) => void;
  /** A click or a tap is next, a swipe is next or previous. Left out, the surface only shows. */
  onAct?: (a: ShowAction) => void;
  animated?: boolean;
  /** False keeps the slide on view when the screen is black or white or the show is over: the presenter's own copy, which says so in words instead. */
  overlay?: boolean;
  /** Digits typed towards a slide number. */
  digits?: string;
  /** For a screen reader, when the slide changes. */
  announce?: string;
  /** A line shown for a moment under the slide. */
  hint?: string | null;
  animator?: Animator;
  className?: string;
}

export function Surface({ design, shown, screen, laser, remote, onPointer, onAct, animated = true, overlay = true, digits, announce, hint, animator, className }: SurfaceProps) {
  const [root, size] = useSize<HTMLDivElement>();
  const slide = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);

  const height = slideHeight(design.size);
  const width = fitWidth(size.w, size.h, 1920, height);
  const slideHeightPx = (height * width) / 1920;

  // ── the laser ─────────────────────────────────────────────────────────────

  const place = useCallback((at: Pointer | null) => {
    const el = dot.current;
    const box = slide.current;
    if (!el || !box) return;
    if (!at) {
      el.dataset.on = 'false';
      return;
    }
    el.style.transform = `translate(${at.x * box.clientWidth}px, ${at.y * box.clientHeight}px)`;
    el.dataset.on = 'true';
  }, []);

  // The other window's pointer, and the dot going when the laser does.
  useLayoutEffect(() => {
    place(laser ? remote : null);
  }, [laser, remote, place, width, slideHeightPx]);

  const sendFrame = useRef(0);
  const pending = useRef<Pointer | null | undefined>(undefined);
  const send = (at: Pointer | null) => {
    pending.current = at;
    if (sendFrame.current) return;
    sendFrame.current = requestAnimationFrame(() => {
      sendFrame.current = 0;
      const p = pending.current;
      pending.current = undefined;
      if (p !== undefined) onPointer?.(p);
    });
  };

  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(
    () => () => {
      if (sendFrame.current) cancelAnimationFrame(sendFrame.current);
    },
    []
  );

  const wake = () => {
    const el = root.current;
    if (!el) return;
    el.removeAttribute('data-idle');
    clearTimeout(idle.current);
    idle.current = setTimeout(() => el.setAttribute('data-idle', ''), IDLE_MS);
  };

  // A show that opens with the pointer still is at rest from the start.
  useLayoutEffect(() => {
    wake();
    return () => clearTimeout(idle.current);
    // `wake` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = useRef<{ x: number; y: number } | null>(null);

  const onPointerMove = (e: React.PointerEvent) => {
    wake();
    if (!laser) return;
    const box = slide.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      place(null);
      send(null);
      return;
    }
    place({ x, y });
    send({ x, y });
  };

  const onPointerLeave = () => {
    if (!laser) return;
    place(null);
    send(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 0) press.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const from = press.current;
    press.current = null;
    if (!from || !onAct || e.button !== 0) return;
    // A link on the slide is the link's, not Next.
    if (e.target instanceof Element && e.target.closest('a[href], button')) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) onAct({ type: dx < 0 ? 'next' : 'prev' });
    else if (Math.abs(dx) <= CLICK_SLOP && Math.abs(dy) <= CLICK_SLOP) onAct({ type: 'next' });
  };

  return (
    <div
      ref={root}
      className={className ? `sp-surface ${className}` : 'sp-surface'}
      data-laser={laser || undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (press.current = null)}
      // A two-finger tap on a trackpad must not put a menu over the slide.
      onContextMenu={(e) => e.preventDefault()}
    >
      {shown && width > 0 && (
        <div ref={slide} className="sp-slide" style={{ width, height: slideHeightPx }}>
          <Stage design={design} shown={shown} width={width} animated={animated} animator={animator} />
          <div ref={dot} className="sp-laser" data-on="false" aria-hidden="true" />
        </div>
      )}
      {overlay && (
        <div className="sp-screen" data-screen={screen} aria-hidden={screen === 'none'}>
          {screen === 'end' && <p>End of slide show. Click to exit.</p>}
        </div>
      )}
      {digits ? (
        <div className="sp-chip" role="status">
          Go to slide {digits}
        </div>
      ) : (
        hint && (
          <div className="sp-chip" role="status">
            {hint}
          </div>
        )
      )}
      <div className="sp-sr" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
