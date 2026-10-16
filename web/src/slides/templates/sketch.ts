/**
 * A drawing of one slide of a template, made from its content, for the card on Home.
 *
 * Office keeps no preview of a document, and a Docs card draws a page of bars from the template's
 * own blocks (`docs/templates/sketch.ts`). A Slides card does the same with a slide: its ground,
 * its shapes, a bar for each line of text where the text would fall, and a block for a table or a
 * chart, all in the deck's own colours, so the card shows what is inside before it is opened.
 *
 * Pure: a deck in, a list of marks out, and a component only draws them. Geometry is in the
 * slide's logical px (1920 wide), so it draws at any size as one `<svg viewBox="0 0 w h">`:
 *
 *   <svg viewBox={`0 0 ${s.w} ${s.h}`}>
 *     <rect width={s.w} height={s.h} fill={s.bg} />
 *     {s.marks.map((m) => m.k === 'ellipse'
 *       ? <ellipse cx={m.x + m.w / 2} cy={m.y + m.h / 2} rx={m.w / 2} ry={m.h / 2} fill={m.fill} />
 *       : <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={m.r} fill={m.fill} />)}
 *   </svg>
 *
 * Colours are `#rrggbb`, already resolved against the deck's theme.
 */

import type { Bullet, DeckJSON, ElementJSON, Fill, LayoutJSON, TextBox } from '../model/deck';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../model/deck';
import { alphaOf, blend, resolveColor } from '../themes/color';
import { FOOTER_TYPES } from '../themes/layouts';
import { LINE_FACTOR, resolveStyle } from '../themes/styles';
import { tonesOf } from '../themes/themes';

export interface SketchMark {
  k: 'rect' | 'ellipse';
  /** Logical px on the slide. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius of a rect, in logical px. */
  r: number;
  fill: string;
}

export interface SlideSketch {
  w: number;
  h: number;
  /** The slide's ground. */
  bg: string;
  /** Back to front. */
  marks: SketchMark[];
}

/** A line of type is drawn as a bar this tall at least: a card is about 125 px wide, and 24 logical px is 1.5 of them. */
const MIN_BAR = 26;
/** Lines a paragraph is drawn as, at most. */
const MAX_LINES = 3;
/** The most marks a sketch holds: a slide of 400 shapes is not a thumbnail. */
const MAX_MARKS = 200;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function fillHex(fill: Fill | undefined, deck: DeckJSON, fallback: string): string {
  if (!fill || fill.kind === 'none') return fallback;
  if (fill.kind === 'solid') {
    const hex = resolveColor(fill.color, deck.theme);
    // A theme colour carries its own alpha; a hex colour's is the fill's.
    const alpha = typeof fill.color === 'string' ? (fill.alpha ?? 1) : alphaOf(fill.color);
    return alpha < 1 ? blend(hex, alpha, fallback) : hex;
  }
  if (fill.kind === 'gradient') return resolveColor(fill.stops[0]?.color ?? '#000000', deck.theme);
  return fallback;
}

class Sketcher {
  readonly marks: SketchMark[] = [];

  constructor(
    private readonly deck: DeckJSON,
    private readonly layout: LayoutJSON | undefined
  ) {}

  private add(mark: SketchMark): void {
    if (this.marks.length < MAX_MARKS) this.marks.push(mark);
  }

  private rect(x: number, y: number, w: number, h: number, fill: string, r = 0, k: SketchMark['k'] = 'rect'): void {
    if (w > 0 && h > 0) this.add({ k, x, y, w, h, r, fill });
  }

  /** Bars where a text body's lines would fall, over `under`, the colour behind the shape. */
  private text(el: ElementJSON, under: string, textBox: TextBox | undefined): void {
    if (!('text' in el) || !el.text) return;
    const insets = textBox?.insets ?? { l: 14.4, t: 7.2, r: 14.4, b: 7.2 };
    const lines: { y: number; x: number; w: number; h: number; color: string; bullet?: { x: number; size: number; color: string } }[] = [];
    let cursor = 0;

    for (const p of el.text.content) {
      const chars = (p.content ?? []).reduce((n, run) => n + (run.text?.length ?? 0), 0);
      const level = Number(p.attrs?.level ?? 0);
      const style = resolveStyle(this.deck.master, this.layout, el.ph?.type, level);
      const px = (style.fontSize ?? 18) * 2;
      const pitch = px * LINE_FACTOR * (Number(p.attrs?.lineHeight) || style.lineHeight || 1);
      const bullet = (p.attrs?.bullet as Bullet | undefined) ?? style.bullet;
      const bulleted = bullet !== undefined && bullet.kind !== 'none';
      const indent = style.indent ?? 0;
      const room = Math.max(60, el.w - insets.l - insets.r - indent);
      const textWidth = chars * px * (style.bold ? 0.58 : 0.52);
      const count = chars === 0 ? 0 : clamp(Math.ceil(textWidth / room), 1, MAX_LINES);
      const ink = resolveColor(style.color ?? tonesOf(this.deck.theme).ink, this.deck.theme);
      // The title is drawn as strong as it is set; running text a little lighter, as small type reads.
      const color = blend(ink, el.ph?.type === 'title' || el.ph?.type === 'ctrTitle' ? 0.92 : 0.6, under);
      cursor += (Number(p.attrs?.spaceBefore ?? style.spaceBefore ?? 0) || 0) * 2;
      for (let i = 0; i < count; i++) {
        const last = i === count - 1;
        const w = last ? clamp(textWidth - room * i, room * 0.2, room * 0.96) : room * 0.96;
        const align = p.attrs?.align ?? style.align ?? 'left';
        const x = el.x + insets.l + indent + (align === 'center' ? (room - w) / 2 : align === 'right' ? room - w : 0);
        const h = clamp(px * 0.5, MIN_BAR, 60);
        lines.push({
          y: cursor + (pitch - h) / 2,
          x,
          w,
          h,
          color,
          ...(i === 0 && bulleted
            ? { bullet: { x: el.x + insets.l + (style.bulletIndent ?? 0), size: Math.max(14, px * 0.3), color: resolveColor(bullet?.kind === 'char' ? (bullet.color ?? ink) : ink, this.deck.theme) } }
            : {})
        });
        cursor += pitch;
      }
    }

    const total = cursor;
    const anchor = textBox?.anchor ?? 'top';
    const top = anchor === 'middle' ? el.y + (el.h - total) / 2 : anchor === 'bottom' ? el.y + el.h - total - insets.b : el.y + insets.t;
    for (const l of lines) {
      if (l.bullet) this.rect(l.bullet.x, top + l.y + (l.h - l.bullet.size) / 2, l.bullet.size, l.bullet.size, l.bullet.color, 0, 'ellipse');
      this.rect(l.x, top + l.y, l.w, l.h, l.color, l.h / 2);
    }
  }

  element(el: ElementJSON, under: string): void {
    const theme = this.deck.theme;
    switch (el.type) {
      case 'shape': {
        const fill = el.fill && el.fill.kind !== 'none' ? fillHex(el.fill, this.deck, under) : null;
        if (fill) {
          const radius = el.shape === 'roundRect' ? (el.adjust ?? 0.1667) * Math.min(el.w, el.h) : 0;
          this.rect(el.x, el.y, el.w, el.h, fill, radius, el.shape === 'ellipse' ? 'ellipse' : 'rect');
        }
        this.text(el, fill ?? under, el.textBox);
        return;
      }
      case 'line':
        this.rect(el.x, el.y - el.line.width / 2, el.w || el.line.width, Math.max(el.line.width, 6), resolveColor(el.line.color, theme));
        return;
      case 'image':
        this.rect(el.x, el.y, el.w, el.h, blend('#808080', 0.25, under), 12);
        return;
      case 'group':
        for (const child of el.children) this.element(child, under);
        return;
      case 'table': {
        const ink = blend(resolveColor(this.deck.master.styles.other.color ?? tonesOf(theme).ink, theme), 0.6, under);
        let y = el.y;
        el.rows.forEach((row, r) => {
          const band = row.cells.find((c) => c.fill && c.fill.kind !== 'none')?.fill;
          const rowFill = band ? fillHex(band, this.deck, under) : under;
          if (band) this.rect(el.x, y, el.w, row.h, rowFill);
          let x = el.x;
          row.cells.forEach((cell, c) => {
            const colW = el.cols[c] ?? 0;
            const chars = cell.text.content.reduce((n, p) => n + (p.content ?? []).reduce((m, run) => m + (run.text?.length ?? 0), 0), 0);
            const w = clamp(chars * 24, 0, colW - 64);
            const header = r === 0 && el.firstRow;
            const on = header ? resolveColor('#ffffff', theme) : ink;
            const right = cell.text.content[0]?.attrs?.align === 'right';
            if (w > 0) this.rect(right ? x + colW - 32 - w : x + 32, y + (row.h - MIN_BAR) / 2, w, MIN_BAR, blend(on, header ? 0.85 : 0.6, rowFill), MIN_BAR / 2);
            x += colW;
          });
          y += row.h;
        });
        return;
      }
      case 'chart': {
        const max = Math.max(1, ...el.series.flatMap((s) => s.values));
        const groups = Math.max(1, el.categories.length);
        const span = el.w / groups;
        const bar = (span * 0.7) / Math.max(1, el.series.length);
        el.series.forEach((s, j) => {
          const color = s.color ? resolveColor(s.color, theme) : theme.colors[(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const)[j % 6]!];
          s.values.forEach((v, i) => {
            const h = (v / max) * el.h * 0.85;
            this.rect(el.x + i * span + span * 0.15 + j * bar, el.y + el.h - h, Math.max(1, bar - 6), h, color, 6);
          });
        });
        return;
      }
    }
  }
}

/** The sketch of slide `index` (0 is the first) of `deck`. */
export function sketchSlide(deck: DeckJSON, index = 0): SlideSketch {
  const slide = deck.slides[clamp(index, 0, Math.max(0, deck.slides.length - 1))];
  const layout = deck.layouts.find((l) => l.id === (slide?.layout ?? 'blank'));
  const ground = resolveColor(tonesOf(deck.theme).ground, deck.theme);
  const bg = fillHex(slide?.bg ?? layout?.bg ?? deck.master.bg, deck, ground);
  const sk = new Sketcher(deck, layout);

  for (const el of deck.master.elements) sk.element(el, bg);
  // The layout's decorations draw on every slide; its placeholders are prompts and do not.
  for (const el of layout?.elements ?? []) if (!el.ph) sk.element(el, bg);
  for (const el of slide?.elements ?? []) {
    if (el.ph && FOOTER_TYPES.includes(el.ph.type)) continue;
    sk.element(el, bg);
  }
  return { w: SLIDE_WIDTH, h: SLIDE_HEIGHT[deck.size], bg, marks: sk.marks };
}
