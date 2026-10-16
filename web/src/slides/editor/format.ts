/**
 * Character and paragraph formatting, for the ribbon, the Format pane and the keys: on the text
 * being typed in when a box has the caret (through its Tiptap editor, so it is the binding's
 * change and one undo entry with the typing around it), and on the whole text of every chosen
 * shape when none has (one step for all of them, textFormat.ts).
 *
 * What the controls show is the text's own value where it has one and the cascade's where it does
 * not, so an untouched title shows the theme's heading font and size.
 */

import type { Editor } from '@tiptap/core';
import type { Bullet, ElementJSON, ShapeElement, TextDoc } from '../model/deck';
import type { SlideModel } from '../model/model';
import { emptyText, paraAttrs, MAX_LEVEL, type Align } from '../model/schema';
import { paragraphStyle, type ResolvedStyle } from '../model/styles';
import type { SelectionStore } from './selection';
import {
  anyStyle,
  bulletToggle,
  hasMark,
  resolvedParagraphs,
  setMark,
  setParagraphs,
  setStyle,
  shiftLevels,
  styleOf,
  type MarkName,
  type ParaPatch,
  type StyleAttrs
} from './textFormat';

export type { MarkName, ParaPatch, StyleAttrs } from './textFormat';

export interface TextFormat {
  /** There is text to format: a box with the caret, or a chosen shape. */
  available: () => boolean;
  /** A box has the caret. */
  editing: () => boolean;
  mark: (name: MarkName) => boolean;
  /** The family showing, or '' when it differs. */
  fontFamily: () => string;
  /** pt, or null when it differs. */
  fontSize: () => number | null;
  /** The text's own colour, or null for the cascade's (or a mix). */
  color: () => string | null;
  align: () => Align | null;
  bullet: () => Bullet['kind'] | null;
  lineHeight: () => number | null;
  toggleMark: (name: MarkName) => void;
  setStyle: (attrs: StyleAttrs) => void;
  setParagraphs: (patch: ParaPatch) => void;
  toggleBullets: (kind: 'char' | 'number') => void;
  /** One level deeper or shallower. */
  indent: (by: 1 | -1) => void;
}

export interface FormatDeps {
  model: () => SlideModel;
  selection: SelectionStore;
  /** The text editor with the caret, if any. */
  editor: () => Editor | null;
}

interface Target {
  id: string;
  doc: TextDoc;
  styleAt: (level: number) => ResolvedStyle;
}

/** Every shape among the chosen elements, a group's shapes included. */
function shapesIn(els: readonly (ElementJSON | null)[]): ShapeElement[] {
  const out: ShapeElement[] = [];
  const walk = (e: ElementJSON) => {
    if (e.type === 'shape') out.push(e);
    else if (e.type === 'group') e.children.forEach(walk);
  };
  for (const e of els) if (e) walk(e);
  return out;
}

/** Every paragraph between the selection's ends, one level deeper or shallower: Tab in a box. */
export function shiftEditorLevels(editor: Editor, by: 1 | -1): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph') return true;
        const level = paraAttrs(node.attrs).level;
        const next = Math.max(0, Math.min(MAX_LEVEL, level + by));
        if (next !== level) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: next || null });
          changed = true;
        }
        return false;
      });
      return changed;
    })
    .run();
}

export function createTextFormat(deps: FormatDeps): TextFormat {
  const live = (): Editor | null => {
    const e = deps.editor();
    return e && !e.isDestroyed ? e : null;
  };

  const targets = (): { slide: string; list: Target[] } | null => {
    const s = deps.selection.get();
    if (!s.slide || !s.els.length) return null;
    const model = deps.model();
    const slide = s.slide;
    const shapes = shapesIn(s.els.map((id) => model.element(slide, id)));
    if (!shapes.length) return null;
    return {
      slide,
      list: shapes.map((sh) => ({ id: sh.id!, doc: sh.text ?? emptyText(), styleAt: (level: number) => model.styleAt(slide, sh.id!, level) }))
    };
  };

  /** The caret's paragraph style in the box being typed in. */
  const caretStyle = (e: Editor): ResolvedStyle | null => {
    const s = deps.selection.get();
    if (!s.slide || !s.editing) return null;
    const model = deps.model();
    const slide = s.slide;
    const el = s.editing;
    return paragraphStyle((level) => model.styleAt(slide, el, level), e.getAttributes('paragraph'));
  };

  const write = (fn: (t: Target) => TextDoc): void => {
    const t = targets();
    if (!t) return;
    deps.model().setTexts(
      t.slide,
      t.list.map((x) => ({ id: x.id, text: fn(x) }))
    );
  };

  const runStyle = (key: keyof StyleAttrs): { value: string | number | null; mixed: boolean; target: Target | null } => {
    const t = targets();
    if (!t) return { value: null, mixed: false, target: null };
    if (!t.list.some((x) => anyStyle(x.doc, key))) return { value: null, mixed: false, target: t.list[0]! };
    const values = t.list.map((x) => styleOf(x.doc, key));
    const same = values.every((v) => v === values[0]) ? values[0]! : null;
    return { value: same, mixed: same === null, target: t.list[0]! };
  };

  const paragraphs = () => {
    const t = targets();
    if (!t) return null;
    const all = t.list.map((x) => resolvedParagraphs(x.doc, x.styleAt));
    const same = <K extends keyof (typeof all)[number]>(k: K) => (all.every((a) => a[k] === all[0]![k]) ? all[0]![k] : null);
    return { align: same('align'), bullet: same('bullet'), lineHeight: same('lineHeight') };
  };

  return {
    available: () => live() !== null || targets() !== null,
    editing: () => live() !== null,

    mark: (name) => {
      const e = live();
      if (e) return e.isActive(name);
      const t = targets();
      return !!t && t.list.every((x) => hasMark(x.doc, name));
    },

    fontFamily: () => {
      const e = live();
      if (e) return (e.getAttributes('textStyle').fontFamily as string | undefined) ?? caretStyle(e)?.fontFamily ?? '';
      const r = runStyle('fontFamily');
      if (r.mixed) return '';
      return (r.value as string | null) ?? r.target?.styleAt(0).fontFamily ?? '';
    },

    fontSize: () => {
      const e = live();
      if (e) return (e.getAttributes('textStyle').fontSize as number | undefined) ?? caretStyle(e)?.fontSize ?? null;
      const r = runStyle('fontSize');
      if (r.mixed) return null;
      return (r.value as number | null) ?? r.target?.styleAt(0).fontSize ?? null;
    },

    color: () => {
      const e = live();
      if (e) return (e.getAttributes('textStyle').color as string | undefined) ?? null;
      const r = runStyle('color');
      return typeof r.value === 'string' ? r.value : null;
    },

    align: () => {
      const e = live();
      if (e) return caretStyle(e)?.align ?? null;
      return paragraphs()?.align ?? null;
    },

    bullet: () => {
      const e = live();
      if (e) return caretStyle(e)?.bullet.kind ?? null;
      return paragraphs()?.bullet ?? null;
    },

    lineHeight: () => {
      const e = live();
      if (e) return caretStyle(e)?.lineHeight ?? null;
      return paragraphs()?.lineHeight ?? null;
    },

    toggleMark: (name) => {
      const e = live();
      if (e) {
        e.chain().focus().toggleMark(name).run();
        return;
      }
      const t = targets();
      if (!t) return;
      const on = !t.list.every((x) => hasMark(x.doc, name));
      write((x) => setMark(x.doc, name, on));
    },

    setStyle: (attrs) => {
      const e = live();
      if (e) {
        e.chain().focus().setMark('textStyle', attrs).run();
        return;
      }
      write((x) => setStyle(x.doc, attrs));
    },

    setParagraphs: (patch) => {
      const e = live();
      if (e) {
        e.chain().focus().updateAttributes('paragraph', patch).run();
        return;
      }
      write((x) => setParagraphs(x.doc, patch));
    },

    toggleBullets: (kind) => {
      const e = live();
      if (e) {
        const s = caretStyle(e);
        const sel = deps.selection.get();
        const inherited = sel.slide && sel.editing ? deps.model().styleAt(sel.slide, sel.editing, paraAttrs(e.getAttributes('paragraph')).level).bullet.kind : 'none';
        e.chain().focus().updateAttributes('paragraph', bulletToggle(kind, s?.bullet.kind ?? null, inherited)).run();
        return;
      }
      const t = targets();
      if (!t) return;
      const current = paragraphs()?.bullet ?? null;
      write((x) => setParagraphs(x.doc, bulletToggle(kind, current, x.styleAt(0).bullet.kind)));
    },

    indent: (by) => {
      const e = live();
      if (e) {
        shiftEditorLevels(e, by);
        return;
      }
      write((x) => shiftLevels(x.doc, by));
    }
  };
}
