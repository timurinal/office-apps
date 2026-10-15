/**
 * The Transitions tab's preview, over the slide on the canvas: the slide before this one leaving
 * and this one arriving with its own transition, once. The first slide arrives from black.
 *
 * It is a canvas layer, so it is drawn in a box the size of the slide on screen under the
 * selection's handles, and takes no pointer events. Nothing is drawn until a preview is asked for.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SlideJSON } from '../model/deck';
import type { CanvasFrame, SlidesContext } from '../modules/types';
import { previewRequests, subscribePreview } from './previewBus';
import { Stage, type Animator, type Shown } from './Stage';
import './present.css';

/** What the first slide arrives from. */
const BLACK: SlideJSON = { id: 'black', layout: 'blank', showMaster: false, bg: { kind: 'solid', color: '#000000' }, elements: [] };

interface Run {
  from: Shown;
  to: Shown;
  /** `from` is drawn first, and `to` after it has mounted, which is what makes the Stage play. */
  phase: 'from' | 'to';
}

export function TransitionPreviewLayer({ ctx, frame, animator }: { ctx: SlidesContext; frame: CanvasFrame; animator?: Animator }) {
  const requested = useSyncExternalStore(subscribePreview, previewRequests);
  const handled = useRef(requested);
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    if (requested === handled.current) return;
    handled.current = requested;
    const id = ctx.slideId;
    if (!id || ctx.slideIndex < 0) return;
    const to: Shown = { id, index: ctx.slideIndex, slide: frame.slide };
    const before = ctx.slideIndex > 0 ? ctx.model.order()[ctx.slideIndex - 1] : undefined;
    const earlier = before ? ctx.model.slide(before) : null;
    const from: Shown = before && earlier ? { id: before, index: ctx.slideIndex - 1, slide: earlier } : { id: BLACK.id!, index: -1, slide: BLACK };
    setRun({ from, to, phase: 'from' });
    // The slide id and the frame are read as they are when the preview is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  useEffect(() => {
    if (run?.phase === 'from') setRun((r) => (r ? { ...r, phase: 'to' } : r));
  }, [run?.phase]);

  if (!run) return null;
  return (
    <div className="sp-preview" aria-hidden="true">
      <Stage
        design={ctx.design}
        shown={run.phase === 'from' ? run.from : run.to}
        width={frame.width * frame.scale}
        onSettled={() => setRun(null)}
        animator={animator}
      />
    </div>
  );
}
