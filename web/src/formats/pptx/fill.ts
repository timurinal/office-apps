/**
 * Fills and lines: `a:solidFill`, `a:gradFill`, `a:blipFill`, `a:pattFill` and `a:ln`, plus the
 * numbered references into the theme's format scheme (`p:style`'s `fillRef` and `lnRef`,
 * a background's `bgRef`).
 */

import type { Color, Fill, Line } from '../../slides/model/deck';
import { plural } from '../types';
import { child, elements, type XNode } from '../xml';
import { colorIn, type ReadColor } from './color';
import { relImage, type PartCtx } from './ctx';
import { attr, int, pick } from './part';
import { toLen, type Space } from './units';

const FILL_NAMES = new Set(['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill']);

/** The fill element among a shape properties element's children. */
export const fillElement = (n: XNode | null | undefined): XNode | null => (n ? (elements(n).find((c) => FILL_NAMES.has(c.name)) ?? null) : null);

function solid(c: ReadColor | null): Fill | undefined {
  if (!c) return undefined;
  return c.alpha !== undefined ? { kind: 'solid', color: c.color, alpha: c.alpha } : { kind: 'solid', color: c.color };
}

/** One fill element. Undefined where the fill says "whatever is behind" (a group fill) or cannot be read. */
export function readFillNode(n: XNode | null | undefined, pc: PartCtx): Fill | undefined {
  if (!n) return undefined;
  switch (n.name) {
    case 'a:noFill':
      return { kind: 'none' };
    case 'a:solidFill':
      return solid(colorIn(n, pc.color));
    case 'a:gradFill': {
      const stops: { at: number; color: Color }[] = [];
      for (const gs of elements(child(n, 'a:gsLst') ?? n)) {
        if (gs.name !== 'a:gs') continue;
        const c = colorIn(gs, pc.color);
        const at = Number(gs.attrs.pos);
        if (c && Number.isFinite(at)) stops.push({ at: Math.min(1, Math.max(0, at / 100_000)), color: c.color });
      }
      if (stops.length === 0) return undefined;
      if (stops.length === 1) return { kind: 'solid', color: stops[0]!.color };
      stops.sort((a, b) => a.at - b.at);
      const lin = child(n, 'a:lin');
      if (!lin && child(n, 'a:path')) pc.deck.warnings.add('gradient-path', (k) => `${plural(k, 'gradient')} that spread from a point or a rectangle ${k === 1 ? 'is drawn as a straight gradient' : 'are drawn as straight gradients'}.`);
      const deg = lin ? int(lin, 'ang', 0) / 60_000 : 90;
      return { kind: 'gradient', angle: Math.round((((deg % 360) + 360) % 360) * 100) / 100, stops };
    }
    case 'a:blipFill': {
      const asset = relImage(pc, child(n, 'a:blip')?.attrs['r:embed']);
      if (!asset) return { kind: 'none' };
      return { kind: 'image', asset, fit: child(n, 'a:tile') ? 'cover' : 'stretch' };
    }
    case 'a:pattFill': {
      pc.deck.warnings.add('pattern-fill', (k) => `${plural(k, 'pattern fill')} ${k === 1 ? 'is' : 'are'} drawn as a solid colour.`);
      return solid(colorIn(child(n, 'a:fgClr'), pc.color));
    }
    default:
      return undefined;
  }
}

/** The fill in a shape's, background's or cell's properties, if it states one. */
export const readFill = (props: XNode | null | undefined, pc: PartCtx): Fill | undefined => readFillNode(fillElement(props), pc);

// ── the theme's format scheme ───────────────────────────────────────────────

/** A numbered fill style of the theme (1 to 3), with `phClr` standing for `color`. */
export function themeFill(idx: number, color: ReadColor | null, pc: PartCtx, background = false): Fill | undefined {
  const list = background ? pc.theme.bgFills : pc.theme.fills;
  const n = list[idx - (background ? 1001 : 1)];
  if (!n) return solid(color);
  return readFillNode(n, { ...pc, color: { ...pc.color, phClr: color } });
}

/** `fillRef` / `bgRef`: an index into the format scheme and the colour it is drawn in. */
export function readFillRef(ref: XNode | null | undefined, pc: PartCtx, background = false): Fill | undefined {
  if (!ref) return undefined;
  const idx = int(ref, 'idx', 0);
  const color = colorIn(ref, pc.color);
  if (idx === 0) return { kind: 'none' };
  // 1001 and up is the background list; a plain index into it is a mistake some writers make.
  return themeFill(background && idx < 1000 ? idx + 1000 : idx, color, pc, background);
}

// ── lines ───────────────────────────────────────────────────────────────────

const DASHES: Record<string, NonNullable<Line['dash']>> = {
  solid: 'solid',
  dash: 'dash',
  sysDash: 'dash',
  lgDash: 'dash',
  dot: 'dot',
  sysDot: 'dot',
  dashDot: 'dashDot',
  lgDashDot: 'dashDot',
  sysDashDot: 'dashDot',
  sysDashDotDot: 'dashDot',
  lgDashDotDot: 'dashDot'
};

const ENDS: Record<string, NonNullable<Line['head']>> = {
  none: 'none',
  triangle: 'triangle',
  stealth: 'triangle',
  arrow: 'arrow',
  diamond: 'oval',
  oval: 'oval'
};

const DEFAULT_LINE_EMU = 9525;

/** A line's width in px: 400 is the most the deck holds. */
const lineWidth = (space: Space, emu: number): number => Math.min(400, toLen(space, emu));

/**
 * An `a:ln`. `base` is what the shape's style already says (colour, width), which this lays its
 * own parts over. A line with no fill and no style is "no line": width 0.
 */
export function readLine(ln: XNode | null | undefined, pc: PartCtx, base?: Line): Line | undefined {
  if (!ln) return base;
  const fill = fillElement(ln);
  const width = ln.attrs.w !== undefined ? lineWidth(pc.deck.space, int(ln, 'w', DEFAULT_LINE_EMU)) : undefined;
  let color: Color | undefined = base?.color;
  let none = false;
  if (fill?.name === 'a:noFill') none = true;
  else if (fill?.name === 'a:solidFill') {
    const c = colorIn(fill, pc.color);
    if (c) color = c.color;
  } else if (fill?.name === 'a:gradFill') {
    const f = readFillNode(fill, pc);
    if (f?.kind === 'gradient') color = f.stops[0]!.color;
  }
  if (none) return { color: color ?? '#000000', width: 0 };
  if (!color) return base ? { ...base, ...(width !== undefined ? { width } : {}) } : undefined;
  const out: Line = { color, width: width ?? base?.width ?? lineWidth(pc.deck.space, DEFAULT_LINE_EMU) };
  const dash = pick(DASHES, attr(child(ln, 'a:prstDash'), 'val'));
  if (dash && dash !== 'solid') out.dash = dash;
  else if (base?.dash) out.dash = base.dash;
  const head = pick(ENDS, attr(child(ln, 'a:headEnd'), 'type'));
  const tail = pick(ENDS, attr(child(ln, 'a:tailEnd'), 'type'));
  if (head && head !== 'none') out.head = head;
  if (tail && tail !== 'none') out.tail = tail;
  return out;
}

/** The line a `lnRef` names: the theme's line style `idx`, in the reference's colour. */
export function readLineRef(ref: XNode | null | undefined, pc: PartCtx): Line | undefined {
  if (!ref) return undefined;
  const idx = int(ref, 'idx', 0);
  if (idx === 0) return { color: '#000000', width: 0 };
  const color = colorIn(ref, pc.color);
  const style = pc.theme.lines[idx - 1];
  const base: Line | undefined = color ? { color: color.color, width: lineWidth(pc.deck.space, style ? int(style, 'w', DEFAULT_LINE_EMU) : DEFAULT_LINE_EMU) } : undefined;
  return style ? readLine(style, { ...pc, color: { ...pc.color, phClr: color } }, base) : base;
}
