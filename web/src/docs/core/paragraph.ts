/**
 * Paragraph formatting: the named styles, line and paragraph spacing, and indent.
 *
 * ── The styles ──────────────────────────────────────────────────────────────
 * Word's names: Normal, No spacing, Title, Subtitle, Heading 1 to 6, Quote and Code.
 * They are not one mechanism, because the base list already has the nodes and a converter
 * has to read what is there:
 *
 *   Heading 1 to 6       a `heading` node with its level
 *   Title, Subtitle,
 *   No spacing           a `paragraph` with `paraStyle`
 *   Quote                a `blockquote` around the paragraphs
 *   Code                 a `codeBlock`
 *   Normal               a `paragraph` with nothing
 *
 * Applying a style changes the block's kind and keeps what the person set by hand on it
 * (alignment, indent). Spacing is the style's, so it is cleared: "No spacing" with a
 * 12pt gap above would not be.
 *
 * ── The rest ────────────────────────────────────────────────────────────────
 * `lineHeight`, `spaceBefore`, `spaceAfter` and `indent` are attributes of the paragraph
 * and the heading (not a mark: spacing belongs to a block, as in Word). Each is checked
 * on the way in and on the way out (sanitize.ts), because each is rendered as inline CSS.
 */

import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { INDENT_MAX, INDENT_PT, safeIndent, safeLineHeight, safeSpace } from './sanitize';

export type StyleId =
  | 'normal'
  | 'nospacing'
  | 'title'
  | 'subtitle'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'code';

export const NAMED_PARAGRAPHS = ['title', 'subtitle', 'nospacing'] as const;
export type ParaStyle = (typeof NAMED_PARAGRAPHS)[number];

const isParaStyle = (v: unknown): v is ParaStyle => (NAMED_PARAGRAPHS as readonly unknown[]).includes(v);

/** Word's line spacing list, as multiples of the font size. */
export const LINE_HEIGHTS: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];

/** Word's "add space before / after paragraph" is 12pt. */
export const SPACE_STEP = 12;

/** Paragraph blocks the attributes below apply to. */
const BLOCKS = ['paragraph', 'heading'];

const styleOf = (el: HTMLElement): CSSStyleDeclaration => el.style;

/** `115%`, `1.15` and Word's `1.15` alike; `normal` and lengths are not a multiple. */
function parseLineHeight(raw: string): number | null {
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim());
  if (pct) return safeLineHeight(Number(pct[1]) / 100);
  return safeLineHeight(raw.trim());
}

/** A margin in pt or px, as points. */
function parseSpace(raw: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(raw.trim());
  if (!m) return null;
  const pt = m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1]);
  return safeSpace(Math.round(pt * 2) / 2);
}

export const paragraphFormat = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          paraStyle: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute('data-style');
              return isParaStyle(v) ? v : null;
            },
            renderHTML: (attrs: Record<string, unknown>) => (isParaStyle(attrs.paraStyle) ? { 'data-style': attrs.paraStyle } : {})
          }
        }
      },
      {
        types: BLOCKS,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => parseLineHeight(styleOf(el).lineHeight),
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = safeLineHeight(attrs.lineHeight);
              return v === null ? {} : { style: `line-height: ${v}` };
            }
          },
          spaceBefore: {
            default: null,
            parseHTML: (el: HTMLElement) => parseSpace(styleOf(el).marginTop),
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = safeSpace(attrs.spaceBefore);
              return v === null ? {} : { style: `margin-top: ${v}pt` };
            }
          },
          spaceAfter: {
            default: null,
            parseHTML: (el: HTMLElement) => parseSpace(styleOf(el).marginBottom),
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = safeSpace(attrs.spaceAfter);
              return v === null ? {} : { style: `margin-bottom: ${v}pt` };
            }
          },
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const m = /^(\d+(?:\.\d+)?)pt$/.exec(styleOf(el).marginLeft.trim());
              return m ? safeIndent(Math.round(Number(m[1]) / INDENT_PT)) ?? 0 : 0;
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = safeIndent(attrs.indent) ?? 0;
              return v === 0 ? {} : { style: `margin-left: ${v * INDENT_PT}pt` };
            }
          }
        }
      }
    ];
  }
});

// ── which style is this ─────────────────────────────────────────────────────

/** The style of the block the selection starts in. */
export function styleAt(state: EditorState): StyleId {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'codeBlock') return 'code';
    if (n.type.name === 'blockquote') return 'quote';
  }
  const block = $from.parent;
  if (block.type.name === 'heading') return `h${Math.min(6, Math.max(1, Number(block.attrs.level) || 1))}` as StyleId;
  if (block.type.name === 'paragraph' && isParaStyle(block.attrs.paraStyle)) return block.attrs.paraStyle;
  return 'normal';
}

// ── applying one ────────────────────────────────────────────────────────────

/** What a block keeps when its style changes: the person's own alignment and indent. */
const kept = (node: PMNode): Record<string, unknown> => ({
  ...(node.attrs.textAlign ? { textAlign: node.attrs.textAlign } : {}),
  indent: node.attrs.indent ?? 0
});

/**
 * Give every textblock the selection touches the style `id` (Normal, No spacing, Title,
 * Subtitle, Heading 1 to 6). Quote and Code are wrappers and have their own commands.
 */
export function setBlockStyle(tr: Transaction, state: EditorState, id: Exclude<StyleId, 'quote' | 'code'>): boolean {
  const { paragraph, heading } = state.schema.nodes;
  if (!paragraph || !heading) return false;
  const found: Array<{ pos: number; node: PMNode }> = [];
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (node.isTextblock && !found.some((f) => f.pos === pos)) found.push({ pos, node });
      return !node.isTextblock;
    });
  }
  if (found.length === 0) return false;
  for (const { pos, node } of found) {
    if (id.startsWith('h')) {
      tr.setNodeMarkup(pos, heading, { ...kept(node), level: Number(id.slice(1)) });
    } else {
      tr.setNodeMarkup(pos, paragraph, { ...kept(node), paraStyle: id === 'normal' ? null : id });
    }
  }
  return true;
}

/** Apply any style from the gallery. */
export function applyStyle(editor: Editor, id: StyleId): void {
  const chain = editor.chain().focus();
  const inQuote = editor.isActive('blockquote');
  const inCode = editor.isActive('codeBlock');

  if (id === 'quote') {
    if (inQuote) chain.lift('blockquote');
    else chain.command(({ tr, state }) => (inCode ? setBlockStyle(tr, state, 'normal') : true)).wrapIn('blockquote');
  } else if (id === 'code') {
    chain.toggleCodeBlock();
  } else {
    if (inQuote) chain.lift('blockquote');
    // A code block's text is plain; setting a style on it makes it a paragraph first.
    chain.command(({ tr, state }) => setBlockStyle(tr, state, id));
  }
  chain.run();
}

// ── spacing and indent ──────────────────────────────────────────────────────

type BlockAttr = 'lineHeight' | 'spaceBefore' | 'spaceAfter' | 'indent';

/** Set one attribute on every paragraph and heading the selection touches. */
function setBlockAttr(tr: Transaction, state: EditorState, attr: BlockAttr, value: (node: PMNode) => unknown): boolean {
  let changed = false;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!BLOCKS.includes(node.type.name)) return true;
      const next = value(node);
      if (node.attrs[attr] !== next) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: next });
        changed = true;
      }
      return false;
    });
  }
  return changed;
}

/** `null` is the document's own line height. */
export const setLineHeight = (editor: Editor, v: number | null): boolean =>
  editor.chain().focus().command(({ tr, state }) => setBlockAttr(tr, state, 'lineHeight', () => (v === null ? null : safeLineHeight(v)))).run();

export const setSpace = (editor: Editor, which: 'spaceBefore' | 'spaceAfter', pt: number | null): boolean =>
  editor.chain().focus().command(({ tr, state }) => setBlockAttr(tr, state, which, () => (pt === null ? null : safeSpace(pt)))).run();

/** Whether the paragraph the selection starts in has space `which` set. */
export const hasSpace = (state: EditorState, which: 'spaceBefore' | 'spaceAfter'): boolean => {
  const b = state.selection.$from.parent;
  return BLOCKS.includes(b.type.name) && typeof b.attrs[which] === 'number' && b.attrs[which] > 0;
};

export const lineHeightAt = (state: EditorState): number | null => {
  const b = state.selection.$from.parent;
  return BLOCKS.includes(b.type.name) ? safeLineHeight(b.attrs.lineHeight) : null;
};

export const indentAt = (state: EditorState): number => {
  const b = state.selection.$from.parent;
  return BLOCKS.includes(b.type.name) ? (safeIndent(b.attrs.indent) ?? 0) : 0;
};

/**
 * Indent or outdent. In a list it moves the item a level, in a table it does nothing
 * (Tab belongs to the cells), and anywhere else it steps the paragraph's indent.
 */
export function indent(editor: Editor, direction: 1 | -1): boolean {
  if (editor.isActive('listItem') || editor.isActive('taskItem')) {
    const name = editor.isActive('taskItem') ? 'taskItem' : 'listItem';
    return direction === 1 ? editor.chain().focus().sinkListItem(name).run() : editor.chain().focus().liftListItem(name).run();
  }
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) =>
      setBlockAttr(tr, state, 'indent', (n) => Math.min(INDENT_MAX, Math.max(0, (safeIndent(n.attrs.indent) ?? 0) + direction)))
    )
    .run();
}

/** Whether outdent would do anything. */
export const canOutdent = (editor: Editor): boolean =>
  editor.isActive('listItem') || editor.isActive('taskItem') ? editor.can().liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem') : indentAt(editor.state) > 0;
