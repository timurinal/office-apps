/**
 * Small builders for the pieces of a deck written by hand: a layout's placeholders, a template's
 * slides. They return the plain values `deck.ts` describes and add no meaning of their own; they
 * only spare the nesting (a paragraph is a node in a doc) and keep ids deterministic.
 *
 * Pure, no DOM: a layout is built in a Web Worker and in the Worker as readily as on a page.
 */

import type {
  Bullet,
  Color,
  ElementJSON,
  Fill,
  LineElement,
  Line,
  Placeholder,
  ShapeElement,
  ShapeKind,
  TextBox,
  TextDoc,
  TextNode
} from '../model/deck';

// ── text ────────────────────────────────────────────────────────────────────

/** A piece of a paragraph: plain text, or a run a helper made (`bold('Q4')`). */
export type Run = string | TextNode;

export interface ParaAttrs {
  align?: 'left' | 'center' | 'right' | 'justify';
  level?: number;
  bullet?: Bullet;
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
}

export const bold = (text: string): TextNode => ({ type: 'text', text, marks: [{ type: 'bold' }] });
/** A run in a colour: the full stop of a Violet title, a figure in the accent. */
export const tinted = (text: string, color: Color): TextNode => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { color } }] });

const nodes = (runs: Run | Run[]): TextNode[] =>
  (Array.isArray(runs) ? runs : [runs]).filter((r) => r !== '').map((r) => (typeof r === 'string' ? { type: 'text', text: r } : r));

/** A paragraph. Only what differs from the inherited style is written, and an empty one has no content. */
export function para(runs: Run | Run[] = [], attrs: ParaAttrs = {}): TextNode {
  const content = nodes(runs);
  const set = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
  return { type: 'paragraph', ...(Object.keys(set).length ? { attrs: set } : {}), ...(content.length ? { content } : {}) };
}

/** A text body. A string is one paragraph. */
export const doc = (...paras: (string | TextNode)[]): TextDoc => ({
  type: 'doc',
  content: paras.length ? paras.map((p) => (typeof p === 'string' ? para(p) : p)) : [para()]
});

/** The text of a doc, paragraphs joined by a newline. */
export function plainText(d: TextDoc | undefined): string {
  const text = (n: TextNode): string => (n.text ?? '') + (n.content ?? []).map(text).join('');
  return d ? d.content.map(text).join('\n') : '';
}

// ── elements ────────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A text body's frame: no inset at the sides, so type sits on the margin, and shrink to fit. */
export const FLUSH: TextBox = { anchor: 'top', insets: { l: 0, t: 0, r: 0, b: 0 }, autofit: 'shrink', wrap: true };

/** A placeholder: a shape with a `ph` whose `text` is the prompt an empty one shows. */
export function placeholder(
  ph: Placeholder,
  box: Box,
  prompt: TextDoc | string,
  options: { name: string; textBox?: TextBox; fill?: Fill } = { name: ph.type }
): ShapeElement {
  return {
    type: 'shape',
    shape: 'rect',
    ...box,
    name: options.name,
    ph,
    ...(options.fill ? { fill: options.fill } : {}),
    text: typeof prompt === 'string' ? doc(prompt) : prompt,
    textBox: options.textBox ?? FLUSH
  };
}

/** A shape to draw: a decoration on a layout, a card on a slide. Text, when it has any, sits inside it. */
export function shape(
  kind: ShapeKind,
  box: Box,
  fill: Color | null,
  options: { name?: string; adjust?: number; line?: Line; text?: TextDoc; textBox?: TextBox; alt?: string } = {}
): ShapeElement {
  return {
    type: 'shape',
    shape: kind,
    ...box,
    ...(options.name ? { name: options.name } : {}),
    ...(options.alt !== undefined ? { alt: options.alt } : {}),
    ...(options.adjust !== undefined ? { adjust: options.adjust } : {}),
    fill: fill ? { kind: 'solid', color: fill } : { kind: 'none' },
    ...(options.line ? { line: options.line } : {}),
    ...(options.text ? { text: options.text } : {}),
    ...(options.textBox ? { textBox: options.textBox } : {})
  };
}

/** A text box: a rectangle with no fill and no line. */
export function textBox(box: Box, text: TextDoc, options: { name?: string; textBox?: TextBox } = {}): ShapeElement {
  return shape('rect', box, null, { name: options.name ?? 'Text', text, textBox: options.textBox ?? FLUSH });
}

/** A horizontal rule from (x, y), `w` long. */
export const rule = (x: number, y: number, w: number, color: Color, width = 3, name = 'Rule'): LineElement => ({
  type: 'line',
  x,
  y,
  w,
  h: 0,
  name,
  line: { color, width }
});

/** Gives each element `e1`, `e2`, ... in order, unless it has an id already. Ids are only unique in their slide. */
export const withIds = <T extends ElementJSON>(elements: T[]): T[] => elements.map((e, i) => (e.id ? e : { ...e, id: `e${i + 1}` }));
