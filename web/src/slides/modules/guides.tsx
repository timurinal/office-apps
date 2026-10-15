/**
 * The smart guides module: the rule that pulls a box being dragged onto the slide's edges and centre
 * lines and onto the other objects', and the canvas layer that marks equal gaps.
 *
 * The rule runs before core's own (types.ts, "snap"), so turning guides off is the rule answering
 * "nowhere to go" and not "no opinion". Alt is not asked about: the canvas does not consult any rule
 * while it is held. The dashed lines are the canvas's own (`.sl-guide`, drawn from `SnapResult.guides`),
 * and appear and go with the drag, never animated.
 *
 * Whether guides are on is `guidesState.ts`; the View tab's button is in `view.tsx`, and the command
 * box has "Show or hide smart guides" from here.
 */

import type React from 'react';
import { boundsOf, unionOf } from '../model/model';
import { SNAP_PX } from '../editor/snap';
import { spacingHints, smartSnap } from './guideSnap';
import { guidesOn, toggleGuides, useGuides } from './guidesState';
import { magnetIcon } from './guideIcons';
import type { CanvasFrame, SlidesModule } from './types';
import './guides.css';

/** The marks for equal gaps, over the slide while a box is being moved. */
function SpacingHints({ frame }: { frame: CanvasFrame }) {
  const on = useGuides();
  const drag = frame.drag;
  if (!on || !drag || drag.kind !== 'move') return null;
  const moving = new Set(drag.ids);
  const own = frame.slide.elements.filter((e) => e.id && moving.has(e.id)).map(boundsOf);
  const box = unionOf(own);
  if (!box) return null;
  const others = frame.slide.elements.filter((e) => !(e.id && moving.has(e.id))).map(boundsOf);
  const hints = spacingHints(box, others);
  if (!hints.length) return null;
  const px = (v: number): number => v * frame.scale;
  return (
    <>
      {hints.map((h, i) => {
        const style: React.CSSProperties = h.axis === 'x' ? { left: px(h.from), top: px(h.at), width: px(h.to - h.from) } : { top: px(h.from), left: px(h.at), height: px(h.to - h.from) };
        return <div key={i} className="sl-gap" data-axis={h.axis} style={style} />;
      })}
    </>
  );
}

export const guidesModule: SlidesModule = {
  id: 'guides',
  ribbon: [],
  commands: [
    {
      id: 'guides.toggle',
      title: 'Show or hide smart guides',
      section: 'View',
      icon: magnetIcon,
      keywords: ['snap', 'align', 'lines', 'guides'],
      run: () => toggleGuides()
    }
  ],
  snap: (box, s) => {
    if (s.drag.kind !== 'move' && s.drag.kind !== 'resize') return null;
    // Off is an answer, not no opinion: the next rule is core's, which would snap anyway.
    if (!guidesOn()) return { dx: 0, dy: 0, guides: [] };
    const moving = new Set(s.drag.ids);
    const others = s.slide.elements.filter((e) => !(e.id && moving.has(e.id))).map(boundsOf);
    return smartSnap(box, others, s.width, s.height, SNAP_PX / s.scale, { kind: s.drag.kind, handle: s.drag.handle });
  },
  canvas: [{ id: 'guides.spacing', render: (_c, frame) => (frame.drag ? <SpacingHints frame={frame} /> : null) }]
};
