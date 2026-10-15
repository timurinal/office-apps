/**
 * The drawing tool, on the slide. While a button has armed one (tool.ts) this layer takes the
 * pointer: a click places the shape, text box or line at its default size, and a drag draws it
 * corner to corner (a line, end to end). Shift keeps a shape square and turns a line in steps of 15
 * degrees; Escape puts the tool away. The ghost of what a drag would make follows the pointer, and
 * the step is written when it comes up: one element, one undo entry.
 *
 * The press never reaches the canvas, so it cannot start a marquee or move what is chosen.
 */

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { shapePath } from '../../render/geometry';
import type { CanvasFrame, SlidesContext } from '../types';
import { isDrag, rectBetween, snapAngle, type Pt, type Rect } from './defaults';
import { insertLine, insertShape, insertTextBoxAt } from './place';
import { disarm, useArmed, type Tool } from './tool';
import './insert.css';

interface Drag {
  from: Pt;
  to: Pt;
  shift: boolean;
}

/** What a finished press makes, and where. Slide px. */
export function drawTool(c: SlidesContext, tool: Tool, from: Pt, to: Pt, shift: boolean): string | null {
  const t = { model: c.model, selection: c.selection };
  const dragged = isDrag(from, to);
  if (tool.kind === 'line') {
    return dragged ? insertLine(t, tool.arrow, { kind: 'ends', from, to: shift ? snapAngle(from, to) : to }) : insertLine(t, tool.arrow, { kind: 'click', at: from });
  }
  const placement = dragged ? ({ kind: 'drag', rect: rectBetween(from, to, shift && tool.kind === 'shape') } as const) : ({ kind: 'click', at: from } as const);
  return tool.kind === 'text' ? insertTextBoxAt(t, placement) : insertShape(t, tool.shape, placement);
}

/** The outline of what a drag would make, in screen px. */
function Ghost({ tool, drag, scale }: { tool: Tool; drag: Drag; scale: number }) {
  if (!isDrag(drag.from, drag.to)) return null;
  if (tool.kind === 'line') {
    const to = drag.shift ? snapAngle(drag.from, drag.to) : drag.to;
    const x = Math.min(drag.from.x, to.x) * scale;
    const y = Math.min(drag.from.y, to.y) * scale;
    const w = Math.max(1, Math.abs(to.x - drag.from.x) * scale);
    const h = Math.max(1, Math.abs(to.y - drag.from.y) * scale);
    const flipH = drag.from.x > to.x;
    const flipV = drag.from.y > to.y;
    return (
      <svg className="sl-ghost" style={{ left: x, top: y }} width={w} height={h} aria-hidden="true">
        <line x1={flipH ? w : 0} y1={flipV ? h : 0} x2={flipH ? 0 : w} y2={flipV ? 0 : h} stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" />
      </svg>
    );
  }
  const r: Rect = rectBetween(drag.from, drag.to, drag.shift && tool.kind === 'shape');
  const w = r.w * scale;
  const h = r.h * scale;
  const d = tool.kind === 'shape' ? shapePath(tool.shape, w, h).d : `M0 0 H${w} V${h} H0 Z`;
  return (
    <svg className="sl-ghost" style={{ left: r.x * scale, top: r.y * scale }} width={w} height={h} aria-hidden="true">
      <path d={d} fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeWidth={1.5} strokeDasharray={tool.kind === 'text' ? '6 4' : undefined} />
    </svg>
  );
}

export function DrawLayer({ c, frame }: { c: SlidesContext; frame: CanvasFrame }) {
  const tool = useArmed(c.model);
  const root = useRef<HTMLDivElement>(null);
  const press = useRef<{ pointer: number; from: Pt } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const armed = tool !== null && c.can.edit && !!c.slideId;

  // The tool does not outlive the slide it was armed on: leaving Normal view, or the editor, puts it away.
  useEffect(() => () => disarm(), []);

  // Escape puts the tool away. A reader, or a deck with no slide, has no tool to hold.
  useEffect(() => {
    if (!tool) return;
    if (!armed) {
      disarm();
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      disarm();
      c.actions.focusCanvas();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tool, armed, c.actions]);

  if (!tool || !armed) return null;

  const at = (e: React.PointerEvent): Pt => {
    const r = root.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / frame.scale, y: (e.clientY - r.top) / frame.scale };
  };

  return (
    <div
      ref={root}
      className="sl-draw"
      data-tool={tool.kind}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press.current = { pointer: e.pointerId, from: at(e) };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || p.pointer !== e.pointerId) return;
        e.stopPropagation();
        setDrag({ from: p.from, to: at(e), shift: e.shiftKey });
      }}
      onPointerUp={(e) => {
        const p = press.current;
        if (!p || p.pointer !== e.pointerId) return;
        e.stopPropagation();
        press.current = null;
        setDrag(null);
        drawTool(c, tool, p.from, at(e), e.shiftKey);
        disarm();
        // A text box has the caret already; the others give the keyboard back to the slide.
        if (tool.kind !== 'text') c.actions.focusCanvas();
      }}
      onPointerCancel={() => {
        press.current = null;
        setDrag(null);
      }}
    >
      {drag && <Ghost tool={tool} drag={drag} scale={frame.scale} />}
    </div>
  );
}
