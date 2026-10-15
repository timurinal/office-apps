/**
 * The outline of every preset shape, as SVG path data in the shape's own box (0,0 to w,h).
 *
 * PowerPoint's presets are formulas over the box and a few adjust values; these follow the
 * default adjusts, and `roundRect` takes the deck's `adjust` (the corner as a fraction of the
 * shorter side, 0 to 0.5). The pptx reader and writer name shapes with the same `ShapeKind`, so a
 * star here is the star PowerPoint draws, near enough to sit where it did.
 *
 * Some presets have parts drawn differently from their body: a can's lid and a cube's faces are
 * shaded (`shades`), and a bracket pair is filled as a rectangle but stroked as two brackets
 * (`stroke`). The text box of a shape is its whole box; the presets that inset their text in
 * PowerPoint are not inset here.
 *
 * Pure: no DOM.
 */

import type { ShapeKind } from '../model/deck';

export interface ShapePath {
  /** What is filled. */
  d: string;
  /** What is stroked, when it differs from `d`. */
  stroke?: string;
  /** Faces drawn over the fill in a darker or lighter tone. */
  shades?: { d: string; tone: 'darker' | 'lighter' }[];
  /** Fill with the even-odd rule: a donut's hole. */
  evenOdd?: boolean;
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);
const poly = (pts: readonly (readonly [number, number])[]): string => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' L')} Z`;

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${r2(cx - rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx + rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx - rx)} ${r2(cy)} Z`;
}

function roundRect(w: number, h: number, r: number): string {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  if (k === 0) return poly([[0, 0], [w, 0], [w, h], [0, h]]);
  return (
    `M${r2(k)} 0 H${r2(w - k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(w)} ${r2(k)} V${r2(h - k)} ` +
    `A${r2(k)} ${r2(k)} 0 0 1 ${r2(w - k)} ${r2(h)} H${r2(k)} A${r2(k)} ${r2(k)} 0 0 1 0 ${r2(h - k)} V${r2(k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(k)} 0 Z`
  );
}

/** A star of `n` points, inner radius as a fraction of the outer. */
function star(w: number, h: number, n: number, inner: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const k = i % 2 === 0 ? 1 : inner;
    pts.push([w / 2 + (Math.cos(a) * w * k) / 2, h / 2 + (Math.sin(a) * h * k) / 2]);
  }
  return poly(pts);
}

/** A right-pointing arrow in a w-by-h box, as points, for the others to turn. */
function arrowPts(w: number, h: number): [number, number][] {
  const head = Math.min(w, h * 0.5 * 2) * 0.5;
  const hl = Math.min(head, w);
  const t = h * 0.25;
  return [
    [0, h / 2 - t],
    [w - hl, h / 2 - t],
    [w - hl, 0],
    [w, h / 2],
    [w - hl, h],
    [w - hl, h / 2 + t],
    [0, h / 2 + t]
  ];
}

/** A normalised path (0..1 both ways) scaled to the box. Used for the curved presets. */
function scaled(cmds: readonly (string | number)[], w: number, h: number): string {
  let out = '';
  let axis = 0;
  for (const c of cmds) {
    if (typeof c === 'string') {
      out += c;
      axis = 0;
    } else {
      out += `${r2(c * (axis % 2 === 0 ? w : h))} `;
      axis += 1;
    }
  }
  return out.trim();
}

const HEART = [
  'M', 0.5, 0.25,
  'C', 0.5, 0.1, 0.32, 0, 0.2, 0,
  'C', 0.06, 0, 0, 0.14, 0, 0.27,
  'C', 0, 0.55, 0.35, 0.72, 0.5, 1,
  'C', 0.65, 0.72, 1, 0.55, 1, 0.27,
  'C', 1, 0.14, 0.94, 0, 0.8, 0,
  'C', 0.68, 0, 0.5, 0.1, 0.5, 0.25,
  'Z'
];

const CLOUD = [
  'M', 0.15, 0.78,
  'C', 0.03, 0.78, 0, 0.62, 0.08, 0.55,
  'C', 0, 0.42, 0.1, 0.28, 0.22, 0.32,
  'C', 0.25, 0.14, 0.45, 0.08, 0.55, 0.2,
  'C', 0.62, 0.06, 0.82, 0.08, 0.84, 0.26,
  'C', 0.98, 0.28, 1, 0.46, 0.93, 0.55,
  'C', 1, 0.68, 0.92, 0.84, 0.78, 0.82,
  'C', 0.72, 0.96, 0.52, 0.98, 0.45, 0.86,
  'C', 0.36, 0.96, 0.18, 0.94, 0.15, 0.78,
  'Z'
];

/** The default corner of a rounded rectangle, PowerPoint's 16667. */
export const ROUND_RECT_DEFAULT = 0.16667;

export function shapePath(kind: ShapeKind | string, w: number, h: number, adjust?: number): ShapePath {
  const W = Math.max(0, Number.isFinite(w) ? w : 0);
  const H = Math.max(0, Number.isFinite(h) ? h : 0);
  const ss = Math.min(W, H);
  switch (kind) {
    case 'roundRect': {
      const a = typeof adjust === 'number' && Number.isFinite(adjust) ? Math.min(0.5, Math.max(0, adjust)) : ROUND_RECT_DEFAULT;
      return { d: roundRect(W, H, a * ss) };
    }
    case 'ellipse':
      return { d: ellipse(W / 2, H / 2, W / 2, H / 2) };
    case 'triangle':
      return { d: poly([[W / 2, 0], [W, H], [0, H]]) };
    case 'rtTriangle':
      return { d: poly([[0, 0], [W, H], [0, H]]) };
    case 'diamond':
      return { d: poly([[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]) };
    case 'parallelogram': {
      const x = ss * 0.25;
      return { d: poly([[x, 0], [W, 0], [W - x, H], [0, H]]) };
    }
    case 'trapezoid': {
      const x = ss * 0.25;
      return { d: poly([[x, 0], [W - x, 0], [W, H], [0, H]]) };
    }
    case 'pentagon':
      return { d: poly([[W / 2, 0], [W, H * 0.382], [W * 0.809, H], [W * 0.191, H], [0, H * 0.382]]) };
    case 'hexagon': {
      const x = ss * 0.25;
      return { d: poly([[x, 0], [W - x, 0], [W, H / 2], [W - x, H], [x, H], [0, H / 2]]) };
    }
    case 'octagon': {
      const x = ss * 0.29289;
      return { d: poly([[x, 0], [W - x, 0], [W, x], [W, H - x], [W - x, H], [x, H], [0, H - x], [0, x]]) };
    }
    case 'star5':
      return { d: star(W, H, 5, 0.382) };
    case 'star6':
      return { d: star(W, H, 6, 0.577) };
    case 'rightArrow':
      return { d: poly(arrowPts(W, H)) };
    case 'leftArrow':
      return { d: poly(arrowPts(W, H).map(([x, y]) => [W - x, y])) };
    case 'downArrow':
      return { d: poly(arrowPts(H, W).map(([x, y]) => [y, x])) };
    case 'upArrow':
      return { d: poly(arrowPts(H, W).map(([x, y]) => [y, H - x])) };
    case 'leftRightArrow': {
      const hl = Math.min(ss * 0.5, W / 2);
      const t = H * 0.25;
      return { d: poly([[0, H / 2], [hl, 0], [hl, H / 2 - t], [W - hl, H / 2 - t], [W - hl, 0], [W, H / 2], [W - hl, H], [W - hl, H / 2 + t], [hl, H / 2 + t], [hl, H]]) };
    }
    case 'chevron': {
      const x = Math.min(ss * 0.5, W);
      return { d: poly([[0, 0], [W - x, 0], [W, H / 2], [W - x, H], [0, H], [x, H / 2]]) };
    }
    case 'homePlate': {
      const x = Math.min(ss * 0.5, W);
      return { d: poly([[0, 0], [W - x, 0], [W, H / 2], [W - x, H], [0, H]]) };
    }
    case 'plus': {
      const x = ss * 0.25;
      return { d: poly([[x, 0], [W - x, 0], [W - x, x], [W, x], [W, H - x], [W - x, H - x], [W - x, H], [x, H], [x, H - x], [0, H - x], [0, x], [x, x]]) };
    }
    case 'heart':
      return { d: scaled(HEART, W, H) };
    case 'cloud':
      return { d: scaled(CLOUD, W, H) };
    case 'wedgeRectCallout':
      return { d: poly([[0, 0], [W, 0], [W, H], [W * 0.4167, H], [W * 0.2917, H * 1.125], [W * 0.1667, H], [0, H]]) };
    case 'wedgeRoundRectCallout': {
      const k = Math.min(ss * 0.16667, W / 2, H / 2);
      return {
        d:
          `M${r2(k)} 0 H${r2(W - k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(W)} ${r2(k)} V${r2(H - k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(W - k)} ${r2(H)} ` +
          `H${r2(W * 0.4167)} L${r2(W * 0.2917)} ${r2(H * 1.125)} L${r2(W * 0.1667)} ${r2(H)} H${r2(k)} A${r2(k)} ${r2(k)} 0 0 1 0 ${r2(H - k)} V${r2(k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(k)} 0 Z`
      };
    }
    case 'donut': {
      const t = ss * 0.25;
      return { d: `${ellipse(W / 2, H / 2, W / 2, H / 2)} ${ellipse(W / 2, H / 2, Math.max(0, W / 2 - t), Math.max(0, H / 2 - t))}`, evenOdd: true };
    }
    case 'blockArc': {
      // The upper half of a ring, as PowerPoint's default (180 to 0 degrees).
      const t = ss * 0.25;
      const rx = W / 2;
      const ry = H / 2;
      const ix = Math.max(0, rx - t);
      const iy = Math.max(0, ry - t);
      return {
        d: `M0 ${r2(ry)} A${r2(rx)} ${r2(ry)} 0 0 1 ${r2(W)} ${r2(ry)} L${r2(W / 2 + ix)} ${r2(ry)} A${r2(ix)} ${r2(iy)} 0 0 0 ${r2(W / 2 - ix)} ${r2(ry)} Z`
      };
    }
    case 'can': {
      const ry = Math.min(ss * 0.25, H / 2) / 2;
      const body = `M0 ${r2(ry)} A${r2(W / 2)} ${r2(ry)} 0 0 1 ${r2(W)} ${r2(ry)} V${r2(H - ry)} A${r2(W / 2)} ${r2(ry)} 0 0 1 0 ${r2(H - ry)} Z`;
      const lid = ellipse(W / 2, ry, W / 2, ry);
      return { d: body, stroke: `${body} ${lid}`, shades: [{ d: lid, tone: 'lighter' }] };
    }
    case 'cube': {
      const k = Math.min(ss * 0.25, W, H);
      const outline = poly([[0, k], [k, 0], [W, 0], [W, H - k], [W - k, H], [0, H]]);
      const top = poly([[0, k], [k, 0], [W, 0], [W - k, k]]);
      const side = poly([[W - k, k], [W, 0], [W, H - k], [W - k, H]]);
      return { d: outline, stroke: `${outline} ${poly([[0, k], [W - k, k], [W - k, H]])}`, shades: [{ d: top, tone: 'lighter' }, { d: side, tone: 'darker' }] };
    }
    case 'bracketPair': {
      const k = Math.min(ss * 0.16667, W / 2, H / 2);
      const left = `M${r2(k)} ${r2(H)} A${r2(k)} ${r2(k)} 0 0 1 0 ${r2(H - k)} V${r2(k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(k)} 0`;
      const right = `M${r2(W - k)} 0 A${r2(k)} ${r2(k)} 0 0 1 ${r2(W)} ${r2(k)} V${r2(H - k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(W - k)} ${r2(H)}`;
      return { d: roundRect(W, H, k), stroke: `${left} ${right}` };
    }
    case 'bracePair': {
      const k = Math.min(ss * 0.08333, W / 4, H / 4);
      const m = H / 2;
      const left =
        `M${r2(2 * k)} ${r2(H)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(k)} ${r2(H - k)} V${r2(m + k)} A${r2(k)} ${r2(k)} 0 0 0 0 ${r2(m)} ` +
        `A${r2(k)} ${r2(k)} 0 0 0 ${r2(k)} ${r2(m - k)} V${r2(k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(2 * k)} 0`;
      const right =
        `M${r2(W - 2 * k)} 0 A${r2(k)} ${r2(k)} 0 0 1 ${r2(W - k)} ${r2(k)} V${r2(m - k)} A${r2(k)} ${r2(k)} 0 0 0 ${r2(W)} ${r2(m)} ` +
        `A${r2(k)} ${r2(k)} 0 0 0 ${r2(W - k)} ${r2(m + k)} V${r2(H - k)} A${r2(k)} ${r2(k)} 0 0 1 ${r2(W - 2 * k)} ${r2(H)}`;
      return { d: roundRect(W, H, k), stroke: `${left} ${right}` };
    }
    case 'rect':
    default:
      return { d: poly([[0, 0], [W, 0], [W, H], [0, H]]) };
  }
}

/** The SVG dash pattern of a line of width `w`: PowerPoint's dashes scale with the line. */
export function dashArray(dash: string | undefined, w: number): string | undefined {
  const k = Math.max(1, w);
  switch (dash) {
    case 'dash':
      return `${4 * k} ${3 * k}`;
    case 'dot':
      return `${k} ${k}`;
    case 'dashDot':
      return `${4 * k} ${3 * k} ${k} ${3 * k}`;
    default:
      return undefined;
  }
}

/** A line element's two ends in its box: `flipH` and `flipV` pick the diagonal. */
export function lineEnds(w: number, h: number, flipH?: boolean, flipV?: boolean): { x1: number; y1: number; x2: number; y2: number } {
  return { x1: flipH ? w : 0, y1: flipV ? h : 0, x2: flipH ? 0 : w, y2: flipV ? 0 : h };
}

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid',
  'pentagon', 'hexagon', 'octagon', 'star5', 'star6', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow',
  'leftRightArrow', 'chevron', 'homePlate', 'plus', 'heart', 'cloud', 'wedgeRectCallout', 'wedgeRoundRectCallout',
  'donut', 'blockArc', 'can', 'cube', 'bracketPair', 'bracePair'
];
