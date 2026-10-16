/**
 * What a text box being typed in adds to the slide text schema (model/schema.ts): the binding to
 * its Yjs fragment, the deck's one undo history, other people's carets, and the cascade drawn as
 * decorations.
 *
 * ── One history ─────────────────────────────────────────────────────────────
 * The binding is y-tiptap's `ySyncPlugin` alone, not Tiptap's Collaboration extension, which brings
 * an undo manager of its own and a Ctrl+Z bound to it. The binding's transactions carry the
 * `ySyncPluginKey` origin, which the model's undo manager tracks, so typing and the canvas's steps
 * are one stack and Ctrl+Z here calls `model.undo()`: undoing past the typing moves the shape the
 * person moved before they typed, as PowerPoint does.
 *
 * ── Carets ──────────────────────────────────────────────────────────────────
 * A caret is a position in one fragment, and the awareness field `cursor` is shared by every box
 * and the notes. Each editor draws only the carets of people whose `slides.text` names its own
 * fragment (presence.ts), so a caret in another box is not resolved against this one. They are
 * drawn beside the text, not in it (core/carets), inside the scaled slide.
 *
 * ── The look ────────────────────────────────────────────────────────────────
 * A paragraph's size, font, colour, spacing and indents come from the cascade, not from the
 * schema's `renderHTML`, which draws only what the paragraph says itself. They are drawn here as
 * node decorations, with the renderer's own CSS (render/paint.ts), and the bullets and numbers as
 * widgets before each paragraph, so the box being typed in looks as it does when it is not.
 */

import { Extension, type AnyExtension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPlugin } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { caretsPlugin } from '../../core/carets';
import type { ThemeJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import { slideTextExtensions } from '../model/schema';
import { bulletLabels, type ResolvedStyle } from '../model/styles';
import { bulletCss, cssText, paragraphCss } from '../render/paint';
import { shiftEditorLevels } from './format';
import { textKeyOf } from './presence';

export interface BindingOptions {
  fragment: Y.XmlFragment;
  model: SlideModel;
  /** A paragraph's style from its own attributes, through the cascade. */
  styleOf: (attrs: Record<string, unknown> | undefined) => ResolvedStyle;
  theme: ThemeJSON;
  /** Other people's carets: null on a local file and in a version. */
  awareness: Awareness | null;
  /**
   * `slide/element` or `slide/notes`: whose carets this editor draws (presence.ts). Null in a table
   * cell, which nobody names: there it is whoever's caret is in the cell's own text.
   */
  textKey: string | null;
  /** Escape: leave the box. */
  onEscape: () => void;
  /** Draw the cascade (a text box), or leave the paragraphs plain (the notes). */
  cascade: boolean;
}

const lookKey = new PluginKey<DecorationSet>('slideTextLook');

/** The paragraphs' cascade and their bullets, as decorations. */
export function lookDecorations(state: EditorState, styleOf: BindingOptions['styleOf'], theme: ThemeJSON): DecorationSet {
  const paras: { attrs: Record<string, unknown>; empty: boolean; pos: number; size: number }[] = [];
  state.doc.forEach((node, pos) => {
    if (node.type.name === 'paragraph') paras.push({ attrs: node.attrs, empty: node.content.size === 0, pos, size: node.nodeSize });
  });
  const labels = bulletLabels(paras, styleOf, true);
  const decos: Decoration[] = [];
  paras.forEach((p, i) => {
    const s = styleOf(p.attrs);
    decos.push(Decoration.node(p.pos, p.pos + p.size, { style: cssText(paragraphCss(s, theme, i === 0)) }));
    const label = labels[i];
    if (label) {
      const css = cssText(bulletCss(label, s, theme));
      decos.push(
        Decoration.widget(
          p.pos + 1,
          () => {
            const span = document.createElement('span');
            span.className = 'sl-bullet';
            span.setAttribute('contenteditable', 'false');
            span.setAttribute('aria-hidden', 'true');
            span.style.cssText = css;
            span.textContent = label.text;
            return span;
          },
          { side: -1, key: `b:${label.text}:${css}`, ignoreSelection: true }
        )
      );
    }
  });
  return DecorationSet.create(state.doc, decos);
}

export function slideBinding(o: BindingOptions): AnyExtension {
  return Extension.create({
    name: 'slideBinding',
    // Above StarterKit's keys, so Tab and Escape are ours.
    priority: 1000,
    addProseMirrorPlugins() {
      const plugins: Plugin[] = [ySyncPlugin(o.fragment)];
      if (o.awareness) {
        const key = o.textKey;
        plugins.push(caretsPlugin({ awareness: o.awareness, accept: key === null ? null : (state) => textKeyOf(state) === key }));
      }
      if (o.cascade) {
        plugins.push(
          new Plugin({
            key: lookKey,
            state: {
              init: (_, state) => lookDecorations(state, o.styleOf, o.theme),
              apply: (tr, old, _before, state) => (tr.docChanged ? lookDecorations(state, o.styleOf, o.theme) : old)
            },
            props: { decorations: (state) => lookKey.getState(state) }
          })
        );
      }
      return plugins;
    },
    addKeyboardShortcuts() {
      return {
        'Mod-z': () => {
          o.model.undo();
          return true;
        },
        'Mod-y': () => {
          o.model.redo();
          return true;
        },
        'Shift-Mod-z': () => {
          o.model.redo();
          return true;
        },
        Escape: () => {
          o.onEscape();
          return true;
        },
        Tab: () => {
          if (o.cascade) shiftEditorLevels(this.editor, 1);
          return o.cascade;
        },
        'Shift-Tab': () => {
          if (o.cascade) shiftEditorLevels(this.editor, -1);
          return o.cascade;
        }
      };
    }
  });
}

/** The extensions of a box or the notes being typed in. */
export function editorExtensions(o: BindingOptions): AnyExtension[] {
  return [...slideTextExtensions(), slideBinding(o)];
}
