/**
 * The speaker notes under the slide, as wide as the slide is on screen.
 *
 * For someone who can edit, a Tiptap editor on the slide's own notes fragment, made again when the
 * slide changes; it shares the deck's undo, and other people's carets in the same notes are drawn.
 * For a reader, the notes as text. The bar on top drags the height, which is remembered here.
 */

import { Editor } from '@tiptap/core';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type { ThemeJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import { plainText } from '../model/schema';
import { paragraphStyle } from '../model/styles';
import { useSlide } from '../useSlideModel';
import { NOTES, textKey } from './presence';
import { editorExtensions } from './textExtensions';

const HEIGHT_KEY = 'oa-slides-notes-height';
export const NOTES_HEIGHT = { min: 40, max: 360, initial: 72 } as const;

const clampHeight = (h: number): number => Math.round(Math.max(NOTES_HEIGHT.min, Math.min(NOTES_HEIGHT.max, h)));

function storedHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return v ? clampHeight(v) : NOTES_HEIGHT.initial;
  } catch {
    return NOTES_HEIGHT.initial;
  }
}

export interface NotesProps {
  model: SlideModel;
  slideId: string;
  editable: boolean;
  theme: ThemeJSON;
  awareness: Awareness | null;
  /** The slide's width on screen, px. */
  width: number;
  /** The caret came into the notes, or left them: what other people are told. */
  onFocusChange: (focused: boolean) => void;
  /** Escape: back to the slide. */
  onExit: () => void;
}

function NotesEditor({ model, slideId, theme, awareness, onExit, onEmpty }: Pick<NotesProps, 'model' | 'slideId' | 'theme' | 'awareness' | 'onExit'> & { onEmpty: (empty: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ onExit, onEmpty });
  latest.current = { onExit, onEmpty };
  useLayoutEffect(() => {
    const fragment = model.ensureNotes(slideId);
    if (!fragment || !host.current) return;
    const plain = model.styleAt(slideId, null, 0);
    const editor = new Editor({
      element: host.current,
      extensions: editorExtensions({
        fragment,
        model,
        styleOf: (attrs) => paragraphStyle(() => plain, attrs),
        theme,
        awareness,
        textKey: textKey(slideId, NOTES),
        onEscape: () => latest.current.onExit(),
        cascade: false
      }),
      injectCSS: false,
      editorProps: { attributes: { class: 'sl-pm', 'aria-label': 'Speaker notes', spellcheck: 'true' } },
      onUpdate: ({ editor: e }) => latest.current.onEmpty(e.isEmpty)
    });
    latest.current.onEmpty(editor.isEmpty);
    return () => {
      editor.destroy();
      model.breakTyping();
      awareness?.setLocalStateField('cursor', null);
    };
    // `theme` is read when the editor is made: the notes draw no theme of their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, slideId, awareness]);
  return <div ref={host} />;
}

export const Notes = memo(function Notes(p: NotesProps) {
  const [height, setHeight] = useState(storedHeight);
  const [empty, setEmpty] = useState(true);
  const drag = useRef<{ pointer: number; y: number; h: number } | null>(null);
  // A reader's notes are read from the slide; an editor's are the editor's own.
  const slide = useSlide(p.editable ? null : p.model, p.slideId);

  const onGrabDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointer: e.pointerId, y: e.clientY, h: height };
  };
  const onGrabMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    setHeight(clampHeight(d.h + d.y - e.clientY));
  };
  const onGrabUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      // Remembering the height is a convenience.
    }
  };

  const readOnlyText = p.editable ? '' : plainText(slide?.notes);
  const showHint = p.editable && empty;

  return (
    <section className="sl-notes" aria-label="Speaker notes" style={{ width: p.width }}>
      <div
        className="sl-notes-grab"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Notes height"
        aria-valuemin={NOTES_HEIGHT.min}
        aria-valuemax={NOTES_HEIGHT.max}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        onPointerCancel={onGrabUp}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          setHeight((h) => clampHeight(h + (e.key === 'ArrowUp' ? 16 : -16)));
        }}
      />
      <div
        className="sl-notes-body"
        style={{ height }}
        onFocus={() => p.onFocusChange(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.onFocusChange(false);
        }}
      >
        {showHint && <span className="sl-notes-hint">Add speaker notes</span>}
        {p.editable ? (
          <NotesEditor key={p.slideId} model={p.model} slideId={p.slideId} theme={p.theme} awareness={p.awareness} onExit={p.onExit} onEmpty={setEmpty} />
        ) : (
          readOnlyText && (
            <div className="sl-notes-static">
              {readOnlyText.split('\n').map((line, i) => (
                <p key={i}>{line || ' '}</p>
              ))}
            </div>
          )
        )}
      </div>
    </section>
  );
});
