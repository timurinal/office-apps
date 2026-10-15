/**
 * A shape's text, being typed in: a Tiptap editor bound to the shape's own fragment, drawn where
 * the renderer draws that text (the canvas hides the rendered text of the shape meanwhile), in the
 * slide's coordinates, inside the canvas's scaled layer.
 *
 * It is made when the box is entered and destroyed when it is left, so only one box at a time
 * carries an editor, and a slide of forty boxes costs nothing to show. Leaving ends the undo
 * entry, so the next box's typing is its own.
 */

import { Editor } from '@tiptap/core';
import { memo, useLayoutEffect, useRef } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { ShapeElement, ThemeJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import { themeVars } from '../model/color';
import { paragraphStyle } from '../model/styles';
import { anchorCss, insetsOf } from '../render/paint';
import { shrinkKey, shrinkOf } from '../render/Text';
import { editorExtensions } from './textExtensions';
import { textKey } from './presence';

export type TextStart = 'end' | 'all' | { x: number; y: number };

export interface TextEditorProps {
  model: SlideModel;
  slideId: string;
  el: ShapeElement;
  theme: ThemeJSON;
  awareness: Awareness | null;
  /** Where the caret goes: the end, the whole text selected, or the point clicked (client px). */
  start: TextStart;
  /** A character to type first, over the whole text: what a key pressed on a chosen shape does. */
  type?: string | undefined;
  readOnly: boolean;
  /** The editor, once it is made, and null once it is gone: the ribbon formats through it. */
  onEditor: (editor: Editor | null) => void;
  /** Escape, or the shape is gone. */
  onExit: () => void;
  /** The caret moved or the text changed: the ribbon re-reads what it shows. */
  onActivity: () => void;
}

export const TextEditor = memo(function TextEditor(p: TextEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(p);
  latest.current = p;
  const elId = p.el.id!;

  useLayoutEffect(() => {
    const { model, slideId, readOnly } = latest.current;
    const fragment = readOnly ? model.textFragment(slideId, elId) : model.ensureText(slideId, elId);
    if (!fragment || !host.current) {
      latest.current.onExit();
      return;
    }
    const styleAt = (level: number) => model.styleAt(slideId, elId, level);
    const editor = new Editor({
      element: host.current,
      extensions: editorExtensions({
        fragment,
        model,
        styleOf: (attrs) => paragraphStyle(styleAt, attrs),
        theme: latest.current.theme,
        awareness: latest.current.awareness,
        textKey: textKey(slideId, elId),
        onEscape: () => latest.current.onExit(),
        cascade: true
      }),
      editable: !readOnly,
      injectCSS: false,
      editorProps: { attributes: { class: 'sl-pm', 'aria-label': 'Text', spellcheck: 'true' } },
      onTransaction: () => latest.current.onActivity()
    });
    const start = latest.current.start;
    // The text inside the paragraphs, not the paragraphs: typing over it keeps the first one's level and bullet.
    if (start === 'all') editor.commands.setTextSelection({ from: 1, to: Math.max(1, editor.state.doc.content.size - 1) });
    else if (start === 'end') editor.commands.setTextSelection(editor.state.doc.content.size);
    else {
      const at = editor.view.posAtCoords({ left: start.x, top: start.y });
      editor.commands.setTextSelection(at ? at.pos : editor.state.doc.content.size);
    }
    editor.view.focus();
    const typed = latest.current.type;
    if (typed && !readOnly) editor.commands.insertContent(typed);
    latest.current.onEditor(editor);
    return () => {
      latest.current.onEditor(null);
      editor.destroy();
      model.breakTyping();
      latest.current.awareness?.setLocalStateField('cursor', null);
    };
  }, [elId, p.slideId]);

  const { el, theme } = p;
  const box = el.textBox;
  const insets = insetsOf(box);
  const base = p.model.styleAt(p.slideId, elId, 0);
  // A box that shrinks its text is typed in at the size it was drawn at.
  const k = box?.autofit === 'shrink' ? shrinkOf(el.text, shrinkKey(el.w, el.h, box, base)) : 1;
  const transform = el.rot ? `rotate(${el.rot}deg)` : undefined;
  return (
    <div
      className="sl-edit-box"
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, transform, ...themeVars(theme) }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="sl-frame" style={{ padding: `${insets.t}px ${insets.r}px ${insets.b}px ${insets.l}px`, justifyContent: anchorCss(box?.anchor) }}>
        <div
          ref={host}
          className={box?.wrap === false ? 'sl-text sl-nowrap' : 'sl-text'}
          style={k < 1 ? { width: `${100 / k}%`, transform: `scale(${k})`, transformOrigin: '0 0' } : undefined}
        />
      </div>
    </div>
  );
});
