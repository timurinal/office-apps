/**
 * The completion list under a formula being typed: functions and defined names that begin
 * with the word at the caret. Both fields show it, the cell editor's under the cell and the
 * formula bar's under the bar, and only the one that has the caret does.
 *
 * Rows take the press, not the focus: a mouse down that moved focus would blur the field and end
 * the edit before the click landed.
 */

import { useId } from 'react';
import { type GridSession, type Suggestions } from './session';

export function useSuggestId(): string {
  return `sg-sug-${useId().replace(/:/g, '')}`;
}

export function SuggestList({ session, list, id }: { session: GridSession; list: Suggestions; id: string }) {
  const lit = session.edit?.suggest.index ?? 0;
  return (
    <ul id={id} role="listbox" aria-label="Functions and names" className="sg-suggest oa-rise" data-sg-keep="">
      {list.items.map((it, i) => (
        <li
          key={it.label}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === lit}
          data-lit={i === lit ? 'true' : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            session.acceptSuggestion(it.label, it.kind === 'function');
          }}
        >
          <span className="sg-sug-label">{it.label}</span>
          {it.detail && <span className="sg-sug-detail">{it.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

