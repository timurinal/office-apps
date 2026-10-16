/**
 * The Transitions tab's preview, over the slide on the canvas: the slide before this one leaving
 * and this one arriving with its own transition, once. The first slide arrives from black.
 *
 * It is a canvas layer, so it is drawn in a box the size of the slide on screen under the
 * selection's handles, and takes no pointer events. Nothing is drawn until a preview is asked for.
 * The rail's marker asks for it by slide; the slide sorter has no canvas, and plays the same
 * preview inside a thumbnail (`ThumbPreview`).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Aspect, SlideJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import type { Design } from '../model/styles';
import type { CanvasFrame, SlidesContext } from '../modules/types';
import { previewRequests, previewSlide, subscribePreview } from './previewBus';
import { Stage, type Animator, type Shown } from './Stage';
import './present.css';

/** What the first slide arrives from. */
const BLACK: SlideJSON = { id: 'black', layout: 'blank', showMaster: false, bg: { kind: 'solid', color: '#000000' }, elements: [] };

interface Run {
  from: Shown;
  to: Shown;
}

/** The slide before `index` leaving and the slide at it arriving; black before the first. */
function pairFor(model: SlideModel, id: string, index: number, slide: SlideJSON | null | undefined): Run | null {
  if (!slide || index < 0) return null;
  const to: Shown = { id, index, slide };
  const before = index > 0 ? model.order()[index - 1] : undefined;
  const earlier = before ? model.slide(before) : null;
  const from: Shown = before && earlier ? { id: before, index: index - 1, slide: earlier } : { id: BLACK.id!, index: -1, slide: BLACK };
  return { from, to };
}

/** `from` is drawn first, and `to` after it has mounted, which is what makes the Stage play. */
function PreviewStage({ design, run, width, animator, onSettled }: { design: Design & { size: Aspect }; run: Run; width: number; animator?: Animator; onSettled: () => void }) {
  const [phase, setPhase] = useState<'from' | 'to'>('from');
  useEffect(() => setPhase('to'), []);
  return <Stage design={design} shown={phase === 'from' ? run.from : run.to} width={width} onSettled={onSettled} animator={animator} />;
}

export function TransitionPreviewLayer({ ctx, frame, animator }: { ctx: SlidesContext; frame: CanvasFrame; animator?: Animator }) {
  const requested = useSyncExternalStore(subscribePreview, previewRequests);
  const handled = useRef(requested);
  const [run, setRun] = useState<{ pair: Run; key: number } | null>(null);

  useEffect(() => {
    if (requested === handled.current) return;
    handled.current = requested;
    const asked = previewSlide();
    // The slide on the canvas is drawn from the frame; another is read from the deck.
    const id = asked ?? ctx.slideId;
    if (!id) return;
    const onCanvas = id === ctx.slideId;
    const pair = pairFor(ctx.model, id, onCanvas ? ctx.slideIndex : ctx.model.order().indexOf(id), onCanvas ? frame.slide : ctx.model.slide(id));
    setRun(pair ? { pair, key: requested } : null);
    // The slide id and the frame are read as they are when the preview is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  if (!run) return null;
  return (
    <div className="sp-preview" aria-hidden="true">
      <PreviewStage key={run.key} design={ctx.design} run={run.pair} width={frame.width * frame.scale} onSettled={() => setRun(null)} animator={animator} />
    </div>
  );
}

/**
 * The same preview inside a thumbnail, at its width, for a view with no canvas. The thumbnail is the
 * box, so it is positioned and clips. Nothing is drawn for a slide the deck does not have.
 */
export function ThumbPreview({ model, design, id, width, onSettled, animator }: { model: SlideModel; design: Design & { size: Aspect }; id: string; width: number; onSettled: () => void; animator?: Animator }) {
  const index = model.order().indexOf(id);
  const pair = pairFor(model, id, index, model.slide(id));
  const done = useRef(onSettled);
  done.current = onSettled;
  useEffect(() => {
    if (!pair) done.current();
    // Whether there is anything to play is settled when it is asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!pair) return null;
  return (
    <div className="sp-preview" aria-hidden="true">
      <PreviewStage design={design} run={pair} width={width} onSettled={onSettled} animator={animator} />
    </div>
  );
}
