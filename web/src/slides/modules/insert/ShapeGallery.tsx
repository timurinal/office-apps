/**
 * Shapes: the gallery of every preset the deck can hold, drawn from the renderer's own outlines
 * (`render/geometry.ts`), so a tile is the shape a slide will show. Choosing one arms the drawing
 * tool (tool.ts): the next click on the slide places it, a drag draws it. A keyboard cannot drag, so
 * a press that came from the keyboard places it in the middle of the slide at once.
 *
 * The gallery also carries the text box and the line and arrow, which are drawn the same way.
 *
 * Home's Drawing group shows the shapes that are used most as two rows of small tiles with a button for the
 * rest (`HomeShapes`), while the strip has room, and the Shapes button when it has not (`useRibbonFit`). The
 * tiles arm the same tools the gallery's do.
 */

import type React from 'react';
import { caretDownIcon, Icon } from '../../../core/icons';
import { useRibbonFit } from '../../../core/shell/Ribbon';
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

/** What a tile in the gallery or on the strip arms, and what a press from the keyboard does instead. */
function useShapePicks(ctx: SlidesContext) {
  const armed = useArmed(ctx.model);
  const t = { model: ctx.model, selection: ctx.selection };
  const shape = (kind: ShapeKind): ShapePick => ({ tool: { kind: 'shape', shape: kind }, label: SHAPE_NAMES[kind], now: () => void insertShape(t, kind) });
  const text: ShapePick = { tool: { kind: 'text' }, label: 'Text box', now: () => void insertTextBoxAt(t) };
  const line: ShapePick = { tool: { kind: 'line', arrow: false }, label: 'Line', now: () => void insertLine(t, false) };
  const arrow: ShapePick = { tool: { kind: 'line', arrow: true }, label: 'Arrow', now: () => void insertLine(t, true) };
  /** `detail` is 0 for a click the keyboard made. */
  const choose = (p: ShapePick, after?: () => void) => (e: React.MouseEvent) => {
    after?.();
    if (e.detail === 0) p.now();
    else arm(ctx.model, p.tool);
  };
  return { armed, shape, text, line, arrow, choose };
}

/** The full gallery, in the popover under the Shapes button, and under the arrow beside the tiles on Home. */
function GalleryPanel({ ctx, open, onClose, align }: { ctx: SlidesContext; open: boolean; onClose: () => void; align: 'left' | 'right' }) {
  const { armed, shape, text, line, arrow, choose } = useShapePicks(ctx);
  const tile = (p: ShapePick, icon: React.ReactNode) => (
    <button key={p.label} type="button" className="sl-shape-tile" title={p.label} aria-label={p.label} aria-pressed={sameTool(armed, p.tool)} onMouseDown={keepSelection} onClick={choose(p, onClose)}>
      {icon}
    </button>
  );
  const draw = [
    { pick: text, icon: <Icon key="t" icon={textTIcon} size={20} /> },
    { pick: line, icon: <Icon key="l" icon={lineSegmentIcon} size={20} /> },
    { pick: arrow, icon: <Icon key="a" icon={arrowUpRightIcon} size={20} /> }
  ];
  return (
    <Popover open={open} onClose={onClose} align={align} role="dialog" label="Shapes" className="sl-shapes">
      <div className="sl-shape-group" role="group" aria-label="Draw">
        <span className="sl-shape-title">Draw</span>
        <div className="sl-shape-grid">{draw.map((d) => tile(d.pick, d.icon))}</div>
      </div>
      {SHAPE_GROUPS.map((g) => (
        <div key={g.title} className="sl-shape-group" role="group" aria-label={g.title}>
          <span className="sl-shape-title">{g.title}</span>
          <div className="sl-shape-grid">{g.kinds.map((kind) => tile(shape(kind), <ShapeIcon kind={kind} />))}</div>
        </div>
      ))}
    </Popover>
  );
}

export function ShapesButton({ ctx, id }: { ctx: SlidesContext; id: string }) {
  const o = useOpen(340);
  const disabled = !ctx.can.edit || !ctx.slideId;
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
      <GalleryPanel ctx={ctx} open={o.open} onClose={o.close} align={o.align} />
    </span>
  );
}

/**
 * The shapes the Home tab keeps in reach, in order, as two rows: a rectangle and a rounded one, an oval, a triangle and a
 * diamond over a line, an arrow, a block arrow, a star and a callout. Each is one the gallery has, and `line` and
 * `arrow` are its Draw group's.
 */
export const HOME_SHAPES: readonly (ShapeKind | 'line' | 'arrow')[] = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'line', 'arrow', 'rightArrow', 'star5', 'wedgeRoundRectCallout'];

/** Two rows of `HOME_SHAPES` as small tiles, and a button for the rest of the gallery. `id` is the button's, as the Shapes button's. */
function ShapesStrip({ ctx, id }: { ctx: SlidesContext; id: string }) {
  const o = useOpen(340);
  const { armed, shape, line, arrow, choose } = useShapePicks(ctx);
  const disabled = !ctx.can.edit || !ctx.slideId;
  return (
    <span className="oa-pop-wrap sl-shapes-inline" role="group" aria-label="Shapes">
      <span className="sl-shapes-grid">
        {HOME_SHAPES.map((kind) => {
          const p = kind === 'line' ? line : kind === 'arrow' ? arrow : shape(kind);
          return (
            <button
              key={kind}
              type="button"
              data-rb-item
              data-id={`${id}.${kind}`}
              className="sl-shape-mini"
              title={p.label}
              aria-label={p.label}
              aria-pressed={sameTool(armed, p.tool)}
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={choose(p)}
            >
              {kind === 'line' ? <Icon icon={lineSegmentIcon} size={16} /> : kind === 'arrow' ? <Icon icon={arrowUpRightIcon} size={16} /> : <ShapeIcon kind={kind} size={16} />}
            </button>
          );
        })}
      </span>
      <button
        type="button"
        data-rb-item
        data-id={id}
        className="oa-rb-chev"
        title="More shapes"
        aria-label="More shapes"
        aria-haspopup="dialog"
        aria-expanded={o.open}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={caretDownIcon} size={11} />
      </button>
      <GalleryPanel ctx={ctx} open={o.open} onClose={o.close} align={o.align} />
    </span>
  );
}

/** Home's Drawing group: the gallery of the shapes used most while the strip has room for it, and the Shapes button when it has not. */
export function HomeShapes({ ctx }: { ctx: SlidesContext }) {
  const { collapsed } = useRibbonFit();
  return collapsed ? <ShapesButton ctx={ctx} id="home.shapes" /> : <ShapesStrip ctx={ctx} id="home.shapes" />;
}
