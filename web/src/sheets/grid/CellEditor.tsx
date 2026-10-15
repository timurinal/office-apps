/**
 * The editor over the active cell. It is always mounted, hidden while nothing is edited, so
 * that a typed key can move focus into it in the keydown handler itself: the browser then
 * delivers that very key to the textarea, IME composition included. Mounting it on the key
 * would mean either losing the first character or typing it twice.
 *
 * It follows its cell through the view's anchors, on every frame, so it stays on the cell
 * when the sheet scrolls under it. It looks like the cell (the same font, size and weight at
 * the same zoom) and grows as the text does.
 */

import { useLayoutEffect, useRef } from 'react';
import type React from 'react';
import { FormulaField } from './FormulaField';
import { PAD_X } from './paint';
import { SuggestList, useSuggestId } from './Suggest';
import type { GridSession } from './session';
import { fontFor } from './text';
import type { GridView } from './view';
import type { GridData } from './types';

export function CellEditor(p: {
  session: GridSession;
  data: GridData;
  view: GridView;
  /** A factor: 1 is 100%. */
  zoom: number;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const { session, data, view, zoom } = p;
  const edit = session.edit;
  const at = edit?.at ?? session.sel.active;
  const wrapper = useRef<HTMLDivElement>(null);
  const where = useRef(at);
  where.current = at;
  const listId = useSuggestId();

  useLayoutEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    view.anchors.set(el, () => {
      const L = view.current();
      if (!L) return null;
      const { row, col } = where.current;
      const m = session.merges().at(row, col);
      return m ? L.rectBox(m) : L.cellBox(row, col);
    });
    view.invalidate('size');
    return () => {
      view.anchors.delete(el);
    };
  }, [view, session]);

  // Moving to another cell moves the editor with it, on the next frame.
  useLayoutEffect(() => view.invalidate('select'), [at.row, at.col, view]);

  const style = data.cell(at.row, at.col)?.style ?? {};
  const f = fontFor(style, undefined, zoom);
  const suggest = edit && edit.focus === 'cell' ? session.suggestions() : null;
  const lit = suggest ? `${listId}-${Math.min(edit!.suggest.index, suggest.items.length - 1)}` : undefined;

  return (
    <div
      ref={wrapper}
      className="sg-editor"
      data-open={edit ? 'true' : 'false'}
      data-sg-editor={session.id}
      data-sg-keep=""
      style={{
        fontFamily: f.css.slice(f.css.indexOf('px ') + 3),
        fontSize: `${f.px}px`,
        fontWeight: style.bold ? 600 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        ['--pad-x' as string]: `${PAD_X * zoom}px`,
        ['--pad-y' as string]: `${3 * zoom}px`
      }}
    >
      <FormulaField
        grow
        value={edit?.text ?? ''}
        selStart={edit?.selStart ?? 0}
        selEnd={edit?.selEnd ?? 0}
        active={edit?.focus === 'cell'}
        refs={edit ? session.refs() : []}
        readOnly={session.readOnly()}
        label="Cell editor"
        inputRef={p.inputRef}
        listId={suggest ? listId : undefined}
        activeOption={lit}
        onInput={(v, a, b) => session.input(v, a, b, 'cell')}
        onSelect={(a, b, v) => session.select(a, b, 'cell', v)}
        onFocus={() => session.focusField('cell')}
        onKeyDown={(e) => {
          if (session.editKeyDown({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, composing: e.nativeEvent.isComposing })) {
            e.preventDefault();
          }
        }}
        onBlur={(e) => {
          if (!session.edit) return;
          const next = e.relatedTarget as Element | null;
          if (next?.closest(`[data-sg-bar="${session.id}"]`)) {
            session.focusField('bar');
            return;
          }
          // The window losing focus is not the edit ending.
          if (!document.hasFocus() || next?.closest('[data-sg-keep]')) return;
          session.commit('none');
        }}
      />
      {suggest && <SuggestList session={session} list={suggest} id={listId} />}
    </div>
  );
}
