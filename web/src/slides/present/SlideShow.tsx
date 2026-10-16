/**
 * The slide show in the editor's own window: full screen over the page, black around the slide.
 *
 * It owns the window while it runs (`useShowKeys`), asks the browser for full screen in the click
 * or key that started it, and ends when the person presses Escape (the browser's, leaving full
 * screen, or the show's own where there is no full screen) or after the last slide. Ending selects
 * the slide the show ended on, so the editor is where the talk stopped.
 *
 * It is drawn in a portal on the body, under the same colours as the editor's dialogs: nothing
 * between the page and the show can clip it or move it.
 */

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { SlidesContext } from '../modules/types';
import { useFullscreen } from './fullscreen';
import { Live } from './Live';
import { useShow, type ShowHandle } from './useShow';
import { useShowKeys } from './useShowKeys';

export interface HostProps {
  ctx: SlidesContext;
  /** The slide to start on, from 0. */
  from: number;
  /** End the show: the editor takes the page back. */
  close: () => void;
}

/** The show's own window leaves the show on the slide it ended on. */
export function useLeave(ctx: SlidesContext, close: () => void, show: { current: ShowHandle | null }): () => void {
  const latest = useRef({ ctx, close });
  latest.current = { ctx, close };
  return useCallback(() => {
    const id = show.current?.peek().slide;
    if (id) latest.current.ctx.select.slide(id);
    latest.current.close();
  }, [show]);
}

export function SlideShow({ ctx, from, close }: HostProps) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<ShowHandle | null>(null);
  const onExit = useLeave(ctx, close, handle);
  const fullscreen = useFullscreen(root, { start: true, onEscape: () => (handle.current ? handle.current.end() : onExit()) });
  const show = useShow({ model: ctx.model, from, role: 'solo', onExit, onFullscreen: fullscreen.toggle });
  handle.current = show;
  useShowKeys(root, show);

  useEffect(() => root.current?.focus({ preventScroll: true }), []);

  return createPortal(
    <div ref={root} className="sp-root" data-app="slides" data-theme="dark" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Slide show">
      {show && <Live model={ctx.model} design={ctx.design} show={show} />}
    </div>,
    document.body
  );
}
