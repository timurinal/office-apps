/**
 * The slide text schema: what a text box, a table cell and the speaker notes hold.
 *
 * deck.ts states it; this is it, as Tiptap extensions that run without a page, so the model,
 * the converters and the templates build the same schema the editor does (`slideSchema()`), and
 * a text body the editor would refuse is refused here first.
 *
 *   doc        paragraph+
 *   paragraph  align · level 0..8 · bullet · spaceBefore · spaceAfter (pt) · lineHeight (multiple) ·
 *              indent · bulletIndent (px)
 *   text, hardBreak
 *   marks      bold, italic, underline, strike, link { href }, textStyle { color, fontSize, fontFamily },
 *              highlight { color }, sup, sub
 *
 * PowerPoint's model, not Docs': a bullet is a property of a paragraph, never a list node, so a
 * pptx paragraph is one node both ways. An attribute left `null` inherits (placeholder, layout,
 * master, theme: model/styles.ts).
 *
 * ── Drawing ─────────────────────────────────────────────────────────────────
 * `renderHTML` is what the text editor draws while a box is being typed in, inside the slide's
 * own coordinate space (logical px, 1 pt = 2 px), and it reads every value through safe.ts:
 * another person's client wrote it. Theme colours become `var(--th-…)` (color.ts `cssColorVar`),
 * because a mark has no theme to hand; the editor puts the theme's variables on its root. What a
 * paragraph inherits (its size, its font, its bullet) the editor draws from the cascade, not here.
 *
 * Pure: no DOM at import, so a Web Worker and the Worker can build the schema.
 */

import { Extension, Mark, getSchema, mergeAttributes, type AnyExtension } from '@tiptap/core';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { isSafeHref } from '../../docs/core/links';
import { stackFor } from '../../docs/core/fonts';
import { cssColorVar } from './color';
import { PX_PER_PT, type Bullet, type TextDoc, type TextNode } from './deck';
import { num, safeBullet, safeColor, safeFamily, safePt } from './safe';

export const MAX_LEVEL = 8;
export const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type Align = (typeof ALIGNS)[number];

/** PowerPoint's single spacing is about 1.2 times the size; a stored multiple is of that. */
export const LINE_FACTOR = 1.2;

const isAlign = (v: unknown): v is Align => typeof v === 'string' && (ALIGNS as readonly string[]).includes(v);

/** A paragraph's own attributes, read safely. Null is "inherit". */
export interface ParaAttrs {
  align: Align | null;
  level: number;
  bullet: Bullet | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineHeight: number | null;
  indent: number | null;
  bulletIndent: number | null;
}

export function paraAttrs(attrs: Record<string, unknown> | undefined): ParaAttrs {
  const a = attrs ?? {};
  const level = num(a.level, 0, MAX_LEVEL);
  return {
    align: isAlign(a.align) ? a.align : null,
    level: level === null ? 0 : Math.round(level),
    bullet: safeBullet(a.bullet),
    spaceBefore: num(a.spaceBefore, 0, 400),
    spaceAfter: num(a.spaceAfter, 0, 400),
    lineHeight: num(a.lineHeight, 0.5, 5),
    indent: num(a.indent, 0, 1920),
    bulletIndent: num(a.bulletIndent, 0, 1920)
  };
}

/** The inline CSS of a paragraph's own attributes, in slide px. Shared by the editor and the renderer. */
export function paraCss(p: ParaAttrs): string {
  const out: string[] = [];
  if (p.align) out.push(`text-align: ${p.align}`);
  if (p.spaceBefore !== null) out.push(`margin-top: ${p.spaceBefore * PX_PER_PT}px`);
  if (p.spaceAfter !== null) out.push(`margin-bottom: ${p.spaceAfter * PX_PER_PT}px`);
  if (p.lineHeight !== null) out.push(`line-height: ${Math.round(p.lineHeight * LINE_FACTOR * 1000) / 1000}`);
  return out.join('; ');
}

const paragraphAttrs = Extension.create({
  name: 'slideParagraph',
  addGlobalAttributes() {
    const attr = (name: keyof ParaAttrs, fallback: unknown = null) => ({
      default: fallback,
      keepOnSplit: true,
      // Drawn together, as one style, by `level` below.
      renderHTML: () => ({}),
      parseHTML: (el: HTMLElement) => {
        if (name === 'align') return isAlign(el.style.textAlign) ? el.style.textAlign : null;
        return fallback;
      }
    });
    return [
      {
        types: ['paragraph'],
        attributes: {
          align: attr('align'),
          bullet: attr('bullet'),
          spaceBefore: attr('spaceBefore'),
          spaceAfter: attr('spaceAfter'),
          lineHeight: attr('lineHeight'),
          indent: attr('indent'),
          bulletIndent: attr('bulletIndent'),
          level: {
            // Null is level 0, so a plain paragraph stores no attribute at all.
            default: null,
            keepOnSplit: true,
            parseHTML: (el: HTMLElement) => Math.min(MAX_LEVEL, Math.max(0, Math.round(Number(el.getAttribute('data-level')) || 0))) || null,
            // `renderHTML` is handed every attribute of the node, so the paragraph's whole style is drawn here.
            renderHTML: (attrs: Record<string, unknown>) => {
              const p = paraAttrs(attrs);
              const style = paraCss(p);
              return { 'data-level': String(p.level), ...(style ? { style } : {}) };
            }
          }
        }
      }
    ];
  }
});

/** `rgb(1, 2, 3)` from a pasted style, as `#010203`. */
function cssToHex(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
}

const textStyle = Mark.create({
  name: 'textStyle',
  addAttributes() {
    return {
      color: { default: null, renderHTML: () => ({}), parseHTML: (el: HTMLElement) => cssToHex(el.style.color) },
      fontSize: {
        default: null,
        renderHTML: () => ({}),
        parseHTML: (el: HTMLElement) => {
          const m = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(el.style.fontSize.trim());
          return m ? safePt(m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1])) : null;
        }
      },
      fontFamily: {
        default: null,
        renderHTML: () => ({}),
        parseHTML: (el: HTMLElement) => safeFamily(el.style.fontFamily.split(',')[0]?.replace(/["']/g, '') ?? '')
      }
    };
  },
  parseHTML() {
    return [{ tag: 'span', getAttrs: (el) => ((el as HTMLElement).hasAttribute('style') ? {} : false) }];
  },
  renderHTML({ mark }) {
    const style: string[] = [];
    const color = cssColorVar(safeColor(mark.attrs.color));
    const size = safePt(mark.attrs.fontSize);
    const family = safeFamily(mark.attrs.fontFamily);
    const stack = family ? stackFor(family) : null;
    if (color) style.push(`color: ${color}`);
    if (size !== null) style.push(`font-size: ${size * PX_PER_PT}px`);
    if (stack) style.push(`font-family: ${stack}`);
    return ['span', style.length ? { style: style.join('; ') } : {}, 0];
  }
});

const highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return { color: { default: null, renderHTML: () => ({}), parseHTML: (el: HTMLElement) => cssToHex(el.style.backgroundColor) } };
  },
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    const color = cssColorVar(safeColor(mark.attrs.color)) ?? '#fff59d';
    return ['mark', mergeAttributes(HTMLAttributes, { style: `background-color: ${color}; color: inherit` }), 0];
  }
});

const sup = Mark.create({
  name: 'sup',
  excludes: 'sub',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0]
});

const sub = Mark.create({
  name: 'sub',
  excludes: 'sup',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0]
});

/**
 * The schema's extensions, with nothing that needs a page or a room: the editor adds its binding,
 * its keys and its decorations on top (editor/textExtensions.ts).
 */
export function slideTextExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      undoRedo: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: true,
        isAllowedUri: (url) => isSafeHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
      }
    }),
    paragraphAttrs,
    textStyle,
    highlight,
    sup,
    sub
  ];
}

let schema: Schema | null = null;

/** The slide text schema. Built once. */
export function slideSchema(): Schema {
  schema ??= getSchema(slideTextExtensions());
  return schema;
}

export class TextInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextInvalid';
  }
}

/** A copy without the links the schema would refuse to draw: they are dropped, not kept as dead marks. */
function clean(node: TextNode): TextNode {
  const out: TextNode = { type: node.type };
  if (node.attrs && Object.keys(node.attrs).length) out.attrs = node.attrs;
  if (typeof node.text === 'string') out.text = node.text;
  if (node.marks) {
    const marks = node.marks.filter((m) => m.type !== 'link' || isSafeHref(String(m.attrs?.href ?? '')));
    if (marks.length) out.marks = marks;
  }
  if (node.content) out.content = node.content.map(clean);
  return out;
}

/**
 * A text body as a checked ProseMirror node. Throws `TextInvalid` for one the schema refuses: a
 * node it does not know, or one in the wrong place.
 */
export function textNode(json: TextDoc): PMNode {
  try {
    const node = slideSchema().nodeFromJSON(clean(json as TextNode));
    node.check();
    return node;
  } catch (e) {
    throw new TextInvalid(e instanceof Error ? e.message : String(e));
  }
}

/** One empty paragraph: what a new text box, placeholder or notes body holds. */
export const emptyText = (): TextDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** A text body from lines of plain text, one paragraph each. */
export function plainTextDoc(text: string, attrs?: Record<string, unknown>): TextDoc {
  const lines = text.split(/\r?\n/);
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      ...(attrs ? { attrs } : {}),
      ...(line ? { content: [{ type: 'text', text: line }] } : {})
    }))
  };
}

/** The text of a body, paragraphs joined by newlines. */
export function plainText(doc: TextDoc | null | undefined): string {
  if (!doc?.content) return '';
  const walk = (n: TextNode): string => (n.type === 'hardBreak' ? '\n' : (n.text ?? '') + (n.content ?? []).map(walk).join(''));
  return doc.content.map(walk).join('\n');
}

/** Whether a body has no text at all (only empty paragraphs). */
export const isEmptyText = (doc: TextDoc | null | undefined): boolean => plainText(doc).trim() === '';
