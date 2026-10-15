/**
 * A text field for a cell's content that can colour the references in a formula.
 *
 * A textarea cannot colour part of its text, so a coloured field is a pair: the textarea on
 * top with its text transparent (the caret, the selection and the IME stay the platform's), and
 * under it a mirror with the same text in the same box, its references in colour. Without a
 * formula the mirror is hidden and the textarea shows its own text, so ordinary typing has no
 * second copy to disagree with.
 *
 * In the cell editor the mirror also sizes the field: the box grows with what is typed, to the
 * right and then down, without measuring anything in script. The formula bar's is fixed in a
 * row, scrolls sideways, and keeps the mirror's scroll in step with the textarea's.
 */

import { useLayoutEffect, useRef } from 'react';
import type React from 'react';
import { REF_COLORS, type RefToken } from './refs';

export interface FormulaFieldProps {
  value: string;
  selStart: number;
  selEnd: number;
  /** This field holds the caret, so the session's selection is applied to it. */
  active: boolean;
  refs: readonly RefToken[];
  /** The cell editor grows and wraps; the bar is one row. */
  grow: boolean;
  readOnly?: boolean;
  label: string;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  onInput(value: string, selStart: number, selEnd: number): void;
  /** `value` is the text the textarea has now, which the session may already have moved past. */
  onSelect(selStart: number, selEnd: number, value: string): void;
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  onFocus?(e: React.FocusEvent<HTMLTextAreaElement>): void;
  onBlur?(e: React.FocusEvent<HTMLTextAreaElement>): void;
  /** For a combobox: the id of the list this field controls and the option that is lit. */
  listId?: string;
  activeOption?: string;
}

function segments(text: string, refs: readonly RefToken[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let at = 0;
  refs.forEach((t, i) => {
    if (t.start < at) return;
    if (t.start > at) out.push(text.slice(at, t.start));
    out.push(
      <span key={i} style={{ color: REF_COLORS[t.color % REF_COLORS.length]!.ink }}>
        {text.slice(t.start, t.end)}
      </span>
    );
    at = t.end;
  });
  out.push(text.slice(at));
  return out;
}

export function FormulaField(p: FormulaFieldProps) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const mirror = useRef<HTMLDivElement | null>(null);
  const colored = p.refs.length > 0;

  // The session's caret, when it moved for a reason the textarea does not know: an address
  // was written at it, a completion was taken, F4 changed a reference.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el || !p.active) return;
    if (el.selectionStart !== p.selStart || el.selectionEnd !== p.selEnd) el.setSelectionRange(p.selStart, p.selEnd);
  }, [p.value, p.selStart, p.selEnd, p.active]);

  const syncScroll = () => {
    const el = ta.current;
    const m = mirror.current;
    if (el && m && !p.grow) {
      m.scrollLeft = el.scrollLeft;
      m.scrollTop = el.scrollTop;
    }
  };
  useLayoutEffect(syncScroll);

  const report = (el: HTMLTextAreaElement) => p.onInput(el.value, el.selectionStart, el.selectionEnd);

  return (
    <div className="sg-field" data-grow={p.grow ? 'true' : undefined}>
      <div ref={mirror} className="sg-mirror" data-shown={colored ? 'true' : undefined} aria-hidden="true">
        {colored ? segments(p.value, p.refs) : p.value}
        {'​'}
      </div>
      <textarea
        ref={(el) => {
          ta.current = el;
          if (typeof p.inputRef === 'function') p.inputRef(el);
          else if (p.inputRef) (p.inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        }}
        className="sg-ta"
        data-colored={colored ? 'true' : undefined}
        value={p.value}
        rows={1}
        wrap={p.grow ? 'soft' : 'off'}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        readOnly={p.readOnly}
        aria-label={p.label}
        role={p.listId ? 'combobox' : undefined}
        aria-controls={p.listId}
        aria-expanded={p.listId ? true : undefined}
        aria-activedescendant={p.activeOption}
        aria-autocomplete={p.listId ? 'list' : undefined}
        onChange={(e) => report(e.currentTarget)}
        onSelect={(e) => p.onSelect(e.currentTarget.selectionStart, e.currentTarget.selectionEnd, e.currentTarget.value)}
        onScroll={syncScroll}
        onKeyDown={p.onKeyDown}
        onFocus={p.onFocus}
        onBlur={p.onBlur}
      />
    </div>
  );
}
