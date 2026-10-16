/**
 * Shapes: the gallery of every preset the deck can hold, drawn from the renderer's own outlines
 * (`render/geometry.ts`), so a tile is the shape a slide will show. Choosing one arms the drawing
 * tool (tool.ts): the next click on the slide places it, a drag draws it. A keyboard cannot drag, so
 * a press that came from the keyboard places it in the middle of the slide at once.
 *
 * The gallery also carries the text box and the line and arrow, which are drawn the same way.
 */

import type React from 'react';
import { caretDownIcon, Icon } from '../../../core/icons';
import { Popover } from '../../../core/ui';
import type { ShapeKind } from '../../model/deck';
import { shapePath } from '../../render/geometry';
import { textTIcon } from '../icons';
import type { SlidesContext } from '../types';
import { defaultSize } from './defaults';
import { arrowUpRightIcon, lineSegmentIcon, shapesIcon } from './icons';
import { keepSelection, useOpen } from './menus';
import { insertLine, insertShape, insertTextBoxAt } from './place';
import { arm, sameTool, useArmed, type Tool } from './tool';
import './shapes.css';

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  roundRect: 'Rounded rectangle',
  ellipse: 'Oval',
  triangle: 'Triangle',
  rtTriangle: 'Right triangle',
  diamond: 'Diamond',
  parallelogram: 'Parallelogram',
  trapezoid: 'Trapezoid',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  octagon: 'Octagon',
  star5: '5-point star',
  star6: '6-point star',
  rightArrow: 'Right arrow',
  leftArrow: 'Left arrow',
  upArrow: 'Up arrow',
  downArrow: 'Down arrow',
  leftRightArrow: 'Left and right arrow',
  chevron: 'Chevron',
  homePlate: 'Pentagon arrow',
  plus: 'Plus',
  heart: 'Heart',
  cloud: 'Cloud',
  wedgeRectCallout: 'Rectangular callout',
  wedgeRoundRectCallout: 'Rounded callout',
  donut: 'Donut',
  blockArc: 'Block arc',
  can: 'Can',
  cube: 'Cube',
  bracketPair: 'Bracket pair',
  bracePair: 'Brace pair'
};

/** The gallery's sections; every kind is in exactly one (`insert.test.ts`). */
export const SHAPE_GROUPS: readonly { title: string; kinds: readonly ShapeKind[] }[] = [
  { title: 'Rectangles', kinds: ['rect', 'roundRect'] },
  { title: 'Basic shapes', kinds: ['ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'plus', 'heart', 'cloud', 'donut', 'blockArc', 'can', 'cube'] },
  { title: 'Arrows', kinds: ['rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'chevron', 'homePlate'] },
  { title: 'Stars', kinds: ['star5', 'star6'] },
  { title: 'Callouts', kinds: ['wedgeRectCallout', 'wedgeRoundRectCallout', 'bracketPair', 'bracePair'] }
];

/** Every kind the gallery shows, in its order: what a test holds against the renderer's list. */
export const GALLERY_KINDS: readonly ShapeKind[] = SHAPE_GROUPS.flatMap((g) => g.kinds);

/** A shape as a tile: its outline in the renderer's geometry, at the proportions it is first drawn. */
export function ShapeIcon({ kind, size = 26 }: { kind: ShapeKind; size?: number }) {
  const d = defaultSize(kind);
  const k = 20 / Math.max(d.w, d.h);
  const w = d.w * k;
  const h = d.h * k;
  const p = shapePath(kind, w, h);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ overflow: 'visible' }}>
      <g transform={`translate(${(24 - w) / 2} ${(24 - h) / 2})`}>
        <path d={p.d} fill="currentColor" fillOpacity={0.16} fillRule={p.evenOdd ? 'evenodd' : undefined} stroke={p.stroke ? 'none' : 'currentColor'} strokeWidth={1.4} strokeLinejoin="round" />
        {p.stroke && <path d={p.stroke} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />}
      </g>
    </svg>
  );
}

interface ShapePick {
  tool: Tool;
  label: string;
  /** What a press from the keyboard does: places it in the middle at once. */
  now: () => void;
}

export function ShapesButton({ ctx, id }: { ctx: SlidesContext; id: string }) {
  const o = useOpen(340);
  const armed = useArmed(ctx.model);
  const disabled = !ctx.can.edit || !ctx.slideId;
  const t = { model: ctx.model, selection: ctx.selection };

  const choose = (p: ShapePick) => (e: React.MouseEvent) => {
    o.close();
    // `detail` is 0 for a click the keyboard made.
    if (e.detail === 0) p.now();
    else arm(ctx.model, p.tool);
  };

  const tile = (p: ShapePick, icon: React.ReactNode) => (
    <button key={p.label} type="button" className="sl-shape-tile" title={p.label} aria-label={p.label} aria-pressed={sameTool(armed, p.tool)} onMouseDown={keepSelection} onClick={choose(p)}>
      {icon}
    </button>
  );

  const draw: ShapePick[] = [
    { tool: { kind: 'text' }, label: 'Text box', now: () => void insertTextBoxAt(t) },
    { tool: { kind: 'line', arrow: false }, label: 'Line', now: () => void insertLine(t, false) },
    { tool: { kind: 'line', arrow: true }, label: 'Arrow', now: () => void insertLine(t, true) }
  ];
  const drawIcons = [<Icon key="t" icon={textTIcon} size={20} />, <Icon key="l" icon={lineSegmentIcon} size={20} />, <Icon key="a" icon={arrowUpRightIcon} size={20} />];

  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id={id}
        className="oa-rb-tl"
        title="Shapes"
        aria-haspopup="dialog"
        aria-expanded={o.open}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={shapesIcon} size={16} />
        Shapes
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} align={o.align} role="dialog" label="Shapes" className="sl-shapes">
        <div className="sl-shape-group" role="group" aria-label="Draw">
          <span className="sl-shape-title">Draw</span>
          <div className="sl-shape-grid">{draw.map((p, i) => tile(p, drawIcons[i]))}</div>
        </div>
        {SHAPE_GROUPS.map((g) => (
          <div key={g.title} className="sl-shape-group" role="group" aria-label={g.title}>
            <span className="sl-shape-title">{g.title}</span>
            <div className="sl-shape-grid">
              {g.kinds.map((kind) => tile({ tool: { kind: 'shape', shape: kind }, label: SHAPE_NAMES[kind], now: () => void insertShape(t, kind) }, <ShapeIcon kind={kind} />))}
            </div>
          </div>
        ))}
      </Popover>
    </span>
  );
}
