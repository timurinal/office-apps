/**
 * Character formatting: font, size, colour, highlight, sub and superscript, clearing it,
 * and the format painter.
 *
 * Font, size and colour live on one mark, `textStyle`, as attributes (that is Tiptap's
 * shape, and a pasted `<span style>` lands in it). Tiptap ships an extension for each,
 * and none of them is used: each writes the attribute into an inline `style` unchecked,
 * and the attributes are shared state that any editor on the document can set. These
 * read the same CSS and write it only when it is exactly what the ribbon would have
 * written (sanitize.ts).
 *
 * Clearing and painting work from a list of the marks this module owns, not from "every
 * mark": a link, or whatever the review module marks a suggestion with, is not formatting
 * and survives a Clear formatting.
 */

import { Extension, type Editor } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import type { Mark as PMMark } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { darkFill, darkInk } from '../../core/darkColors';
import { storageOf } from './storage';
import { canonicalFamily, stackFor } from './fonts';
import { setBlockStyle, styleAt, type StyleId } from './paragraph';
import { firstFamily, safeColor, safeFontSize, toPoints } from './sanitize';

/** The marks that are formatting, and so what clearing and painting handle. */
export const FORMAT_MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'highlight', 'textStyle'] as const;

// ── the attributes ──────────────────────────────────────────────────────────

/** Font, size and colour, as attributes of `textStyle`. */
export const textAttributes = Extension.create({
  name: 'textAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) => canonicalFamily(firstFamily(el.style.fontFamily)),
            renderHTML: (attrs: Record<string, unknown>) => {
              const stack = typeof attrs.fontFamily === 'string' ? stackFor(attrs.fontFamily) : null;
              return stack ? { style: `font-family: ${stack}` } : {};
            }
          },
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => toPoints(el.style.fontSize),
            renderHTML: (attrs: Record<string, unknown>) => {
              const size = safeFontSize(attrs.fontSize);
              return size ? { style: `font-size: ${size}` } : {};
            }
          },
          color: {
            default: null,
            parseHTML: (el: HTMLElement) => safeColor(el.style.color),
            renderHTML: (attrs: Record<string, unknown>) => {
              const color = safeColor(attrs.color);
              // The dark page's variant rides beside the colour as a custom property, found by a class,
              // for the screen's stylesheet alone (doc.css, `@media screen`): the colour as set is what is
              // stored, copied, printed and exported.
              return color ? { class: 'oa-dk-i', style: `color: ${color}; --oa-dk-ink: ${darkInk(color)}` } : {};
            }
          }
        }
      }
    ];
  }
});

/** The pen, with the colour checked on the way in and on the way out. */
export const highlightMark = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => safeColor(el.getAttribute('data-color') ?? el.style.backgroundColor),
        renderHTML: (attrs: Record<string, unknown>) => {
          const color = safeColor(attrs.color);
          return color ? { 'data-color': color, class: 'oa-dk-f', style: `background-color: ${color}; color: inherit; --oa-dk-fill: ${darkFill(color)}` } : {};
        }
      }
    };
  }
}).configure({ multicolor: true });

/** Left stays unset: a paragraph with no alignment is left, and writes nothing. */
export const alignment = TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] });

// Tiptap's own shortcuts for sub and superscript (Ctrl+, and Ctrl+.) stay: Word's, Ctrl+= and
// Ctrl+Shift+=, are the browser's zoom.
export const textMarks = [TextStyle, textAttributes, highlightMark, Subscript, Superscript, alignment];

// ── setting and reading ─────────────────────────────────────────────────────

/** `null` takes the attribute off and, when nothing else is on the mark, the mark with it. */
function setStyleAttr(editor: Editor, attr: 'fontFamily' | 'fontSize' | 'color', value: string | null): boolean {
  const chain = editor.chain().focus().setMark('textStyle', { [attr]: value });
  return value === null ? chain.removeEmptyTextStyle().run() : chain.run();
}

export const setFont = (editor: Editor, name: string | null): boolean => setStyleAttr(editor, 'fontFamily', name);

/** A value that is not one of these is refused and changes nothing: `null` is the only way to clear. */
export function setSize(editor: Editor, points: number | null): boolean {
  const size = points === null ? null : safeFontSize(`${points}pt`);
  return points !== null && size === null ? false : setStyleAttr(editor, 'fontSize', size);
}

export function setTextColor(editor: Editor, color: string | null): boolean {
  const safe = color === null ? null : safeColor(color);
  return color !== null && safe === null ? false : setStyleAttr(editor, 'color', safe);
}

export const setHighlight = (editor: Editor, color: string | null): boolean => {
  if (color === null) return editor.chain().focus().unsetHighlight().run();
  const safe = safeColor(color);
  return safe ? editor.chain().focus().setHighlight({ color: safe }).run() : false;
};

export const fontAt = (editor: Editor): string | null => (editor.getAttributes('textStyle').fontFamily as string | null | undefined) ?? null;
export const sizeAt = (editor: Editor): string | null => (editor.getAttributes('textStyle').fontSize as string | null | undefined) ?? null;
export const colorAt = (editor: Editor): string | null => (editor.getAttributes('textStyle').color as string | null | undefined) ?? null;
export const highlightAt = (editor: Editor): string | null => (editor.getAttributes('highlight').color as string | null | undefined) ?? null;

export type Align = 'left' | 'center' | 'right' | 'justify';

export const alignAt = (editor: Editor): Align => {
  const sel = editor.state.selection as { node?: { type: { name: string }; attrs: Record<string, unknown> } };
  if (sel.node?.type.name === 'image') return (sel.node.attrs.align as Align | null) ?? 'left';
  for (const name of ['paragraph', 'heading'] as const) {
    const a = editor.getAttributes(name).textAlign as Align | null | undefined;
    if (a && editor.isActive(name)) return a;
  }
  return 'left';
};

/** Align the text, or the picture if one is selected. */
export function setAlign(editor: Editor, to: Align): boolean {
  const sel = editor.state.selection as { node?: { type: { name: string } } };
  if (sel.node?.type.name === 'image') {
    return editor.chain().focus().updateAttributes('image', { align: to === 'left' ? null : to }).run();
  }
  return to === 'left' ? editor.chain().focus().unsetTextAlign().run() : editor.chain().focus().setTextAlign(to).run();
}

// ── clearing ────────────────────────────────────────────────────────────────

/** Every textblock the selection touches, except code, which has no formatting to clear. */
function resetBlocks(tr: Transaction, state: EditorState): boolean {
  const { paragraph } = state.schema.nodes;
  if (!paragraph) return false;
  let changed = false;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isTextblock) return true;
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        tr.setNodeMarkup(pos, paragraph, {});
        changed = true;
      }
      return false;
    });
  }
  return changed;
}

/** Back to Normal with no character formatting. Links, and the marks of other modules, stay. */
export function clearFormatting(editor: Editor): boolean {
  const chain = editor.chain().focus();
  for (const name of FORMAT_MARKS) if (editor.schema.marks[name]) chain.unsetMark(name);
  return chain.command(({ tr, state }) => resetBlocks(tr, state) || true).run();
}

// ── the format painter ──────────────────────────────────────────────────────

interface Painted {
  marks: PMMark[];
  style: StyleId;
  block: Record<string, unknown>;
}

interface PainterStorage {
  armed: Painted | null;
}

const painterKey = new PluginKey('oaFormatPainter');

const BLOCK_KEYS = ['textAlign', 'lineHeight', 'spaceBefore', 'spaceAfter', 'indent'] as const;

/** What the painter picks up at the selection: its character marks and its block's look. */
export function captureFormat(state: EditorState): Painted {
  const { $from, empty } = state.selection;
  const at = empty ? (state.storedMarks ?? $from.marks()) : $from.marks();
  const block = $from.parent;
  const attrs: Record<string, unknown> = {};
  for (const k of BLOCK_KEYS) if (block.attrs[k] !== undefined) attrs[k] = block.attrs[k];
  return {
    marks: at.filter((m) => (FORMAT_MARKS as readonly string[]).includes(m.type.name)),
    style: styleAt(state),
    block: attrs
  };
}

/** Put what was captured onto the selection. */
export function pasteFormat(editor: Editor, p: Painted): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      if (from === to) return false;
      if (dispatch) {
        for (const name of FORMAT_MARKS) {
          const type = state.schema.marks[name];
          if (type) tr.removeMark(from, to, type);
        }
        for (const m of p.marks) tr.addMark(from, to, m);
        if (p.style !== 'quote' && p.style !== 'code') setBlockStyle(tr, state, p.style);
        tr.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
          const next = { ...node.attrs };
          for (const k of BLOCK_KEYS) if (k in next) next[k] = p.block[k] ?? (k === 'indent' ? 0 : null);
          tr.setNodeMarkup(pos, undefined, next);
          return false;
        });
      }
      return true;
    })
    .run();
}

/**
 * Arm it with `armFormatPainter(editor)`: the next range the person selects takes the
 * formatting of where it was armed, once. Escape puts it away. The ribbon button is
 * pressed while it is armed (`isPainting`).
 */
export const formatPainter = Extension.create<unknown, PainterStorage>({
  name: 'oaFormatPainter',

  addStorage() {
    return { armed: null };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: painterKey,
        props: {
          handleKeyDown: (_view, event) => {
            if (event.key === 'Escape' && ext.storage.armed) {
              disarm(ext.editor);
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            // The selection a drag makes is settled after the button goes up.
            mouseup: () => {
              if (ext.storage.armed) setTimeout(() => applyArmed(ext.editor), 0);
              return false;
            },
            keyup: (_v, e) => {
              if (ext.storage.armed && e.shiftKey && e.key.startsWith('Arrow')) setTimeout(() => applyArmed(ext.editor), 0);
              return false;
            }
          }
        }
      })
    ];
  }
});

const storage = (editor: Editor): PainterStorage => storageOf<PainterStorage>(editor, 'oaFormatPainter');

/** A transaction the ribbon notices: it reads the selection moving, not meta. */
function nudge(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection).setMeta('addToHistory', false));
}

export function armFormatPainter(editor: Editor): void {
  const s = storage(editor);
  s.armed = captureFormat(editor.state);
  editor.view.dom.classList.add('oa-painting');
  nudge(editor);
}

export function disarm(editor: Editor): void {
  const s = storage(editor);
  if (!s.armed) return;
  s.armed = null;
  editor.view.dom.classList.remove('oa-painting');
  nudge(editor);
}

function applyArmed(editor: Editor): void {
  const s = storage(editor);
  if (!s.armed || editor.isDestroyed || editor.state.selection.empty) return;
  const painted = s.armed;
  pasteFormat(editor, painted);
  disarm(editor);
}

export const isPainting = (editor: Editor): boolean => storage(editor).armed !== null;
