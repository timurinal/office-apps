/**
 * Where a rendered text body put its lines.
 *
 * The renderer lays text out with the browser, so the browser is the only thing that knows where a
 * line broke and how wide it came out. This asks it, one character at a time: a Range over a
 * character answers with the box the character was drawn in (`getClientRects`), and characters on
 * one line share a top. Each run of characters on a line is a segment with the position it started
 * at, the baseline it sat on and the look it had, which is all an SVG `<text>` needs to put the same
 * words in the same places without laying anything out itself.
 *
 * The body is measured with no rotation on it (the caller takes that off the shape it is in), so a
 * segment's position is in the shape's own frame, and the rotation is the shape's `<g>`.
 */

export interface Origin {
  x: number;
  y: number;
}

export interface Segment {
  /** The paragraph it is in; the lines of one paragraph are written together. */
  block: number;
  text: string;
  /** Where it starts, in the frame of the element it is measured against. */
  x: number;
  /** Its baseline. */
  y: number;
  /** The box the text was drawn in, for the bounds and a highlight. */
  box: { x: number; y: number; w: number; h: number };
  /** The whole stack, as the page used it. */
  family: string;
  /** The first family of the stack, unquoted. */
  primary: string;
  size: number;
  weight: number;
  style: 'normal' | 'italic';
  fill: string;
  opacity: number;
  /** `underline`, `line-through`, both or empty. */
  decoration: string;
  highlight: { fill: string; opacity: number } | null;
}

/** Measures every text node under `frame`, relative to `origin` (the top left of the element it is in). */
export type Measurer = (frame: Element, origin: Origin) => Segment[];

// ── colour ──────────────────────────────────────────────────────────────────

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** A computed colour (`rgb()`, `rgba()`, `color(srgb …)` or hex) as `#rrggbb` and an opacity; null where it is not one. */
export function parseColor(text: string): { hex: string; alpha: number } | null {
  const t = text.trim().toLowerCase();
  if (t === 'transparent') return { hex: '#000000', alpha: 0 };
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (m) {
    const h = m[1]!;
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    const alpha = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
    return { hex: `#${full.slice(0, 6)}`, alpha };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
    return { hex: `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`, alpha: Math.min(1, Math.max(0, a)) };
  }
  m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
    return { hex: `#${hex2(Number(m[1]) * 255)}${hex2(Number(m[2]) * 255)}${hex2(Number(m[3]) * 255)}`, alpha: Math.min(1, Math.max(0, a)) };
  }
  return null;
}

// ── metrics ─────────────────────────────────────────────────────────────────

let canvasContext: CanvasRenderingContext2D | null | undefined;
const ratios = new Map<string, number>();

/** How much of a line's text box sits above its baseline, for this font: the font's ascent over its ascent and descent. */
function ascentRatio(font: string): number {
  const hit = ratios.get(font);
  if (hit !== undefined) return hit;
  let ratio = 0.8;
  if (canvasContext === undefined) {
    try {
      canvasContext = document.createElement('canvas').getContext('2d');
    } catch {
      canvasContext = null;
    }
  }
  if (canvasContext) {
    canvasContext.font = font;
    const m = canvasContext.measureText('Hg');
    if (typeof m.fontBoundingBoxAscent === 'number' && typeof m.fontBoundingBoxDescent === 'number' && m.fontBoundingBoxAscent + m.fontBoundingBoxDescent > 0) {
      ratio = m.fontBoundingBoxAscent / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
    }
  }
  ratios.set(font, ratio);
  return ratio;
}

const firstFamily = (stack: string): string => (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');

/** The scale the text was drawn at inside the element: autofit's shrink is a transform on the body. */
function scaleBetween(from: Element, boundary: Element): number {
  let k = 1;
  for (let a: Element | null = from; a && a !== boundary; a = a.parentElement) {
    const t = getComputedStyle(a).transform;
    const m = /^matrix\(([^)]+)\)$/.exec(t);
    if (m) {
      const [x, y] = m[1]!.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) k *= Math.hypot(x!, y!) || 1;
    }
  }
  return k;
}

// ── the measuring ───────────────────────────────────────────────────────────

export const measureText: Measurer = (frame, origin) => {
  const out: Segment[] = [];
  const blocks = new Map<Element, number>();
  const boundary = frame.closest('.sl-el') ?? frame;
  const range = document.createRange();
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data;
    const parent = node.parentElement;
    if (!data || !parent) continue;
    const cs = getComputedStyle(parent);
    const k = scaleBetween(parent, boundary);
    const size = (Number.parseFloat(cs.fontSize) || 16) * k;
    const weight = Number.parseInt(cs.fontWeight, 10) || 400;
    const style = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique' ? 'italic' : 'normal';
    const color = parseColor(cs.color) ?? { hex: '#000000', alpha: 1 };
    const back = parseColor(cs.backgroundColor);
    const ratio = ascentRatio(`${style} ${weight} ${Number.parseFloat(cs.fontSize) || 16}px ${cs.fontFamily}`);
    const decoration = ['underline', 'line-through'].filter((d) => cs.textDecorationLine.includes(d)).join(' ');
    const paragraph = parent.closest('.sl-p') ?? parent.closest('.sl-cell') ?? parent;
    if (!blocks.has(paragraph)) blocks.set(paragraph, blocks.size);
    const block = blocks.get(paragraph)!;

    let run: { text: string; left: number; right: number; top: number; bottom: number } | null = null;
    let prev: DOMRect | null = null;
    const flush = (trim: boolean) => {
      if (!run) return;
      const text = trim ? run.text.replace(/[ \t]+$/, '') : run.text;
      if (text) {
        const h = run.bottom - run.top;
        out.push({
          block,
          text,
          x: run.left - origin.x,
          y: run.top - origin.y + h * ratio,
          box: { x: run.left - origin.x, y: run.top - origin.y, w: run.right - run.left, h },
          family: cs.fontFamily,
          primary: firstFamily(cs.fontFamily),
          size,
          weight,
          style,
          fill: color.hex,
          opacity: color.alpha,
          decoration,
          highlight: back && back.alpha > 0 ? { fill: back.hex, opacity: back.alpha } : null
        });
      }
      run = null;
    };

    let at = 0;
    for (const ch of data) {
      range.setStart(node, at);
      range.setEnd(node, at + ch.length);
      at += ch.length;
      let r: DOMRect | null = null;
      for (const c of Array.from(range.getClientRects())) {
        if (c.width > 0 || c.height > 0) {
          r = c;
          break;
        }
      }
      // A mark that takes no room of its own (a joiner, a combining accent) stays with the character before it.
      if (!r) {
        if (run) run.text += ch;
        continue;
      }
      if (run && prev && r.top > prev.top + prev.height * 0.5) flush(true);
      if (!run) run = { text: '', left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      run.text += ch;
      run.right = Math.max(run.right, r.right);
      prev = r;
    }
    flush(false);
  }
  return out;
};
