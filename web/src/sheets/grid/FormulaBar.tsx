/**
 * The formula bar: the banner's fourth row on the Sheets board. A name box with the active
 * address, cancel and enter, `fx`, and the formula itself.
 *
 * It is the second field of the edit the grid started, not a separate editor. Both read and
 * write the grid's `GridSession`, so typing in either shows in the other and the references
 * are coloured in both. Focusing the formula starts an edit of the active cell, as clicking
 * into the bar does in Excel; typing an address in the name box and pressing Enter goes
 * there (`B3`, `B3:D9`, `A:C`, `2:4`).
 *
 * Everything in it is a real control in the tab order: the name box, the two buttons that are
 * enabled while an edit is open, `fx`, and the formula.
 */

import { useRef, useState } from 'react';
import type React from 'react';
import { cellAddress, parseAddress, rectAddress } from './a1';
import { checkIcon, Icon, xIcon } from '../../core/icons';
import { FormulaField } from './FormulaField';
import { cellsIn, sameRect } from './selection';
import { SuggestList, useSuggestId } from './Suggest';
import { useSession, type GridSession } from './session';
import type { GridData } from './types';
import './grid.css';

export interface FormulaBarProps {
  session: GridSession;
  data: GridData;
  /** Refuse edits even where the data allows them; the data's own flag always applies. */
  readOnly?: boolean;
  /** At the right edge: the assistant's Explain. */
  trailing?: React.ReactNode;
  /** What `fx` does. Without it `fx` starts a formula in the cell; the host's Insert function dialog replaces that. */
  onInsertFunction?: () => void;
}

export function FormulaBar({ session, data, readOnly: forced, trailing, onInsertFunction }: FormulaBarProps) {
  useSession(session);
  const readOnly = data.readOnly() || forced === true;
  const edit = session.edit;
  const field = useRef<HTMLTextAreaElement>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const listId = useSuggestId();

  const rect = session.rect();
  const merged = session.merges().at(rect.r1, rect.c1);
  const single = cellsIn(rect) === 1 || (merged !== null && sameRect(merged, rect));
  const address = single ? cellAddress(session.sel.active.row, session.sel.active.col) : rectAddress(rect);
  const idle = data.editText(session.sel.active.row, session.sel.active.col);

  const go = () => {
    const target = parseAddress(typed ?? '', data.rowCount(), data.colCount());
    if (!target) {
      setInvalid(true);
      return;
    }
    if (session.edit) session.commit('none');
    session.selectRect(target);
    setTyped(null);
    setInvalid(false);
    session.focusGrid();
  };

  const suggest = edit && edit.focus === 'bar' ? session.suggestions() : null;
  const lit = suggest ? `${listId}-${Math.min(edit!.suggest.index, suggest.items.length - 1)}` : undefined;
  // Mouse down on a button must not take the focus, or the edit it acts on would end first.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="sg-fbar" role="group" aria-label="Formula bar" data-sg-bar={session.id}>
      <input
        className="sg-name"
        aria-label="Name box"
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoComplete="off"
        value={typed ?? address}
        onFocus={(e) => {
          setTyped(address);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setTyped(e.currentTarget.value);
          setInvalid(false);
        }}
        onBlur={() => {
          setTyped(null);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setTyped(null);
            session.focusGrid();
          }
        }}
      />
      <div className="sg-fbtns">
        <button type="button" className="sg-fbtn" aria-label="Cancel" disabled={!edit} onMouseDown={keepFocus} onClick={() => session.cancel()}>
          <Icon icon={xIcon} size={14} />
        </button>
        <button type="button" className="sg-fbtn" aria-label="Enter" disabled={!edit} onMouseDown={keepFocus} onClick={() => session.commit('none')}>
          <Icon icon={checkIcon} size={14} />
        </button>
        <button
          type="button"
          className="sg-fbtn sg-fbtn-fx"
          aria-label="Insert function"
          disabled={readOnly}
          onMouseDown={keepFocus}
          onClick={() => {
            if (onInsertFunction) {
              onInsertFunction();
              return;
            }
            if (!session.edit) session.beginEdit('fx');
            field.current?.focus();
          }}
        >
          fx
        </button>
      </div>
      <div className="sg-fwrap">
        <FormulaField
          value={edit ? edit.text : idle}
          selStart={edit?.selStart ?? 0}
          selEnd={edit?.selEnd ?? 0}
          active={edit?.focus === 'bar'}
          refs={session.refs()}
          grow={false}
          readOnly={readOnly}
          label="Formula"
          inputRef={field}
          listId={suggest ? listId : undefined}
          activeOption={lit}
          onInput={(v, a, b) => {
            if (!session.edit && !session.beginEdit('bar')) return;
            session.input(v, a, b, 'bar');
          }}
          onSelect={(a, b, v) => session.select(a, b, 'bar', v)}
          onFocus={() => {
            if (session.edit) session.focusField('bar');
            else if (!readOnly) session.beginEdit('bar');
          }}
          onKeyDown={(e) => {
            if (!session.edit) {
              if (e.key === 'Escape') session.focusGrid();
              return;
            }
            if (session.editKeyDown({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, composing: e.nativeEvent.isComposing })) {
              e.preventDefault();
            }
          }}
          onBlur={(e) => {
            if (!session.edit) return;
            const next = e.relatedTarget as Element | null;
            if (next?.closest(`[data-sg-editor="${session.id}"]`)) {
              session.focusField('cell');
              return;
            }
            if (!document.hasFocus() || next?.closest('[data-sg-keep]') || next?.closest(`[data-sg-bar="${session.id}"]`)) return;
            session.commit('none');
          }}
        />
        {suggest && <SuggestList session={session} list={suggest} id={listId} />}
      </div>
      {trailing && <div className="sg-ftrail">{trailing}</div>}
    </div>
  );
}
