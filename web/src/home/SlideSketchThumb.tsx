/**
 * A Slides template card's slide, drawn from the template's own content (slides/templates/sketch.ts).
 *
 * The decks and the code that sketches them are not in Home's chunk (`slides/templates/summaries.ts`
 * names the cards): they load when the first card is drawn, and a skeleton of a slide stands in
 * until then. The sketch is in the slide's own logical px and colours, so it draws at any size as
 * one SVG. A 1 px ring goes round it: a light slide on a white card would otherwise have no edge.
 */

import { useEffect, useState } from 'react';
import type { DocKind } from '@shared/api';
import type { SlideSketch } from '../slides/templates/sketch';
import { Thumb } from './Thumb';

let loading: Promise<typeof import('../slides/templates')> | null = null;
const templates = () => (loading ??= import('../slides/templates'));

const FRAME = { width: '84%', display: 'block', borderRadius: 3 } as const;

export function SlideSketchThumb({ templateId, kind }: { templateId: string; kind: DocKind }) {
  // undefined while it loads; null when there is no sketch to draw.
  const [sketch, setSketch] = useState<SlideSketch | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    templates().then(
      (m) => live && setSketch(m.slidesSketchFor(templateId)),
      () => live && setSketch(null)
    );
    return () => {
      live = false;
    };
  }, [templateId]);

  if (sketch === undefined) return <span className="oa-bone" aria-hidden="true" style={{ ...FRAME, aspectRatio: '16 / 9' }} />;
  if (sketch === null) return <Thumb kind={kind} variant="template" blank={false} />;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${sketch.w} ${sketch.h}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ ...FRAME, height: 'auto', boxShadow: '0 0 0 1px var(--bd)' }}
    >
      <rect width={sketch.w} height={sketch.h} fill={sketch.bg} />
      {sketch.marks.map((m, i) =>
        m.k === 'ellipse' ? (
          <ellipse key={i} cx={m.x + m.w / 2} cy={m.y + m.h / 2} rx={m.w / 2} ry={m.h / 2} fill={m.fill} />
        ) : (
          <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} rx={m.r} fill={m.fill} />
        )
      )}
    </svg>
  );
}
