/**
 * Where a shape is and what it is: `a:xfrm`, the group transform, and the preset geometries.
 *
 * A pptx shape inside a group is placed in the group's own coordinate space (`chOff` and `chExt`),
 * which the group maps to the slide with its `off` and `ext`, its flips and its rotation. The deck
 * keeps every child in slide coordinates, so a position is carried through each group it is in,
 * innermost first. Everything here is in EMU until the very end.
 */

import type { ShapeKind } from '../../slides/model/deck';
import { child, type XNode } from '../xml';
import { int, pick } from './part';

export interface RawXfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, 0 to 360. */
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

export interface GroupXf {
  x: number;
  y: number;
  w: number;
  h: number;
  chX: number;
  chY: number;
  chW: number;
  chH: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

const norm = (deg: number): number => ((deg % 360) + 360) % 360;

/** An `a:xfrm` or `p:xfrm`; null when it has no extent (a placeholder that inherits its place has none). */
export function readXfrm(n: XNode | null | undefined): RawXfrm | null {
  if (!n) return null;
  const off = child(n, 'a:off');
  const ext = child(n, 'a:ext');
  if (!off || !ext) return null;
  return {
    x: int(off, 'x', 0),
    y: int(off, 'y', 0),
    w: Math.max(0, int(ext, 'cx', 0)),
    h: Math.max(0, int(ext, 'cy', 0)),
    rot: norm(int(n, 'rot', 0) / 60_000),
    flipH: n.attrs.flipH === '1' || n.attrs.flipH === 'true',
    flipV: n.attrs.flipV === '1' || n.attrs.flipV === 'true'
  };
}

/** A group's transform from its `grpSpPr/xfrm`. A group with no usable one maps its children to themselves. */
export function readGroupXf(n: XNode | null | undefined): GroupXf | null {
  if (!n) return null;
  const off = child(n, 'a:off');
  const ext = child(n, 'a:ext');
  if (!off || !ext) return null;
  const chOff = child(n, 'a:chOff');
  const chExt = child(n, 'a:chExt');
  const g: GroupXf = {
    x: int(off, 'x', 0),
    y: int(off, 'y', 0),
    w: Math.max(0, int(ext, 'cx', 0)),
    h: Math.max(0, int(ext, 'cy', 0)),
    chX: chOff ? int(chOff, 'x', 0) : int(off, 'x', 0),
    chY: chOff ? int(chOff, 'y', 0) : int(off, 'y', 0),
    chW: chExt ? Math.max(0, int(chExt, 'cx', 0)) : Math.max(0, int(ext, 'cx', 0)),
    chH: chExt ? Math.max(0, int(chExt, 'cy', 0)) : Math.max(0, int(ext, 'cy', 0)),
    rot: norm(int(n, 'rot', 0) / 60_000),
    flipH: n.attrs.flipH === '1' || n.attrs.flipH === 'true',
    flipV: n.attrs.flipV === '1' || n.attrs.flipV === 'true'
  };
  return g;
}

function through(r: RawXfrm, g: GroupXf): RawXfrm {
  const sx = g.chW > 0 ? g.w / g.chW : 1;
  const sy = g.chH > 0 ? g.h / g.chH : 1;
  let cx = g.x + (r.x + r.w / 2 - g.chX) * sx;
  let cy = g.y + (r.y + r.h / 2 - g.chY) * sy;
  const w = r.w * sx;
  const h = r.h * sy;
  let { flipH, flipV, rot } = r;
  const gcx = g.x + g.w / 2;
  const gcy = g.y + g.h / 2;
  if (g.flipH) {
    cx = 2 * gcx - cx;
    flipH = !flipH;
    rot = -rot;
  }
  if (g.flipV) {
    cy = 2 * gcy - cy;
    flipV = !flipV;
    rot = -rot;
  }
  if (g.rot) {
    const t = (g.rot * Math.PI) / 180;
    const dx = cx - gcx;
    const dy = cy - gcy;
    cx = gcx + dx * Math.cos(t) - dy * Math.sin(t);
    cy = gcy + dx * Math.sin(t) + dy * Math.cos(t);
    rot += g.rot;
  }
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot: norm(rot), flipH, flipV };
}

/** `r` carried through the groups it is in, innermost first. */
export function throughGroups(r: RawXfrm, stack: readonly GroupXf[]): RawXfrm {
  let out = r;
  for (const g of stack) out = through(out, g);
  return out;
}

// ── preset geometries ───────────────────────────────────────────────────────

/** The preset names the deck draws itself. */
const SAME: readonly ShapeKind[] = [
  'rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
  'star5', 'star6', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'chevron', 'homePlate', 'plus', 'heart',
  'cloud', 'wedgeRectCallout', 'wedgeRoundRectCallout', 'donut', 'blockArc', 'can', 'cube', 'bracketPair', 'bracePair'
];

/** Presets the deck has no form for, drawn as the nearest it has. Not worth a warning: the box and the text are right. */
const NEAREST: Record<string, ShapeKind> = {
  textBox: 'rect',
  flowChartProcess: 'rect',
  flowChartPredefinedProcess: 'rect',
  flowChartInternalStorage: 'rect',
  flowChartDocument: 'rect',
  flowChartMultidocument: 'rect',
  flowChartManualInput: 'rect',
  flowChartManualOperation: 'trapezoid',
  flowChartDecision: 'diamond',
  flowChartTerminator: 'roundRect',
  flowChartAlternateProcess: 'roundRect',
  flowChartConnector: 'ellipse',
  flowChartSummingJunction: 'ellipse',
  flowChartOr: 'ellipse',
  flowChartPreparation: 'hexagon',
  flowChartData: 'parallelogram',
  flowChartDelay: 'roundRect',
  flowChartMerge: 'triangle',
  flowChartExtract: 'triangle',
  snip1Rect: 'rect',
  snip2SameRect: 'rect',
  snip2DiagRect: 'rect',
  snipRoundRect: 'roundRect',
  round1Rect: 'roundRect',
  round2SameRect: 'roundRect',
  round2DiagRect: 'roundRect',
  plaque: 'rect',
  frame: 'rect',
  bevel: 'rect',
  foldedCorner: 'rect',
  halfFrame: 'rect',
  corner: 'rect',
  decagon: 'octagon',
  dodecagon: 'octagon',
  heptagon: 'hexagon',
  star4: 'star5',
  star7: 'star5',
  star8: 'star6',
  star10: 'star6',
  star12: 'star6',
  star16: 'star6',
  star24: 'star6',
  star32: 'star6',
  mathPlus: 'plus',
  cross: 'plus',
  pie: 'ellipse',
  pieWedge: 'ellipse',
  chord: 'ellipse',
  smileyFace: 'ellipse',
  noSmoking: 'donut',
  bentArrow: 'rightArrow',
  curvedRightArrow: 'rightArrow',
  curvedLeftArrow: 'leftArrow',
  curvedUpArrow: 'upArrow',
  curvedDownArrow: 'downArrow',
  uturnArrow: 'rightArrow',
  circularArrow: 'rightArrow',
  stripedRightArrow: 'rightArrow',
  notchedRightArrow: 'rightArrow',
  rightArrowCallout: 'rightArrow',
  leftArrowCallout: 'leftArrow',
  upArrowCallout: 'upArrow',
  downArrowCallout: 'downArrow',
  upDownArrow: 'upArrow',
  quadArrow: 'plus',
  leftRightUpArrow: 'plus',
  leftUpArrow: 'leftArrow',
  bentUpArrow: 'upArrow',
  rightBrace: 'bracePair',
  leftBrace: 'bracePair',
  rightBracket: 'bracketPair',
  leftBracket: 'bracketPair',
  wedgeEllipseCallout: 'wedgeRoundRectCallout',
  cloudCallout: 'cloud',
  borderCallout1: 'wedgeRectCallout',
  borderCallout2: 'wedgeRectCallout',
  borderCallout3: 'wedgeRectCallout',
  callout1: 'wedgeRectCallout',
  callout2: 'wedgeRectCallout',
  callout3: 'wedgeRectCallout',
  accentCallout1: 'wedgeRectCallout',
  accentBorderCallout1: 'wedgeRectCallout'
};

/** Presets that are a line, not a shape. */
export const LINE_PRESETS = new Set(['line', 'straightConnector1']);
/** Connectors that bend or curve, drawn as the straight line between their ends. */
export const BENT_PRESETS = /^(?:bent|curved)Connector\d$/;

export type Geometry = { kind: ShapeKind; exact: boolean; adjust?: number } | { line: true; bent: boolean } | { custom: true } | { unknown: true };

/** What a shape's geometry element says it is. */
export function geometryOf(spPr: XNode | null | undefined): Geometry {
  if (!spPr) return { kind: 'rect', exact: true };
  if (child(spPr, 'a:custGeom')) return { custom: true };
  const prst = child(spPr, 'a:prstGeom');
  if (!prst) return { kind: 'rect', exact: true };
  const name = prst.attrs.prst ?? 'rect';
  if (LINE_PRESETS.has(name)) return { line: true, bent: false };
  if (BENT_PRESETS.test(name)) return { line: true, bent: true };
  if ((SAME as readonly string[]).includes(name)) return { kind: name as ShapeKind, exact: true };
  const near = pick(NEAREST, name);
  if (near) return { kind: near, exact: false, ...(name === 'flowChartTerminator' ? { adjust: 0.5 } : {}) };
  return { unknown: true };
}

/** `adj` of a rounded rectangle, as a fraction of the shorter side, 0 to 0.5. */
export function adjustOf(spPr: XNode | null | undefined): number | undefined {
  const av = child(child(spPr, 'a:prstGeom'), 'a:avLst');
  if (!av) return undefined;
  for (const gd of av.children) {
    if (typeof gd === 'string' || gd.name !== 'a:gd') continue;
    if (gd.attrs.name !== 'adj' && gd.attrs.name !== 'adj1') continue;
    const m = /^val\s+(-?\d+)/.exec(gd.attrs.fmla ?? '');
    if (!m) continue;
    return Math.round(Math.min(0.5, Math.max(0, Number(m[1]) / 100_000)) * 10000) / 10000;
  }
  return undefined;
}
