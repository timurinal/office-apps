/**
 * The arrow on a cell with a validation list, and the list it opens. The arrow is drawn only
 * on the selected cell, as the board draws the dropdown; Alt+Down opens the same list from
 * the keyboard. A choice leaves as a `choose` intent: the model decides what a value in the
 * list means, and whether it still is one.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { caretDownIcon, Icon } from '../../core/icons';
import type { GridSession } from './session';
import type { GridView } from './view';
import type { Cellpos, GridData } from './types';
import { cellsIn } from './selection';

export function ChoiceDropdown(p: {
  session: GridSession;
  data: GridData;
  view: GridView;
  zoom: number;
  open: boolean;
  readOnly: boolean;
  onOpen(open: boolean): void;
  onChoose(at: Cellpos, value: string): void;
  focusGrid(): void;
}) {
  const { session, data, view, zoom, open, onOpen } = p;
  const at = session.sel.active;
  const cell = data.cell(at.row, at.col);
  const single = cellsIn(session.rect()) === 1 || session.merges().at(at.row, at.col) !== null;
  const shown = !!cell?.hasList && single && !session.edit;
  const choices = shown ? data.listChoices(at.row, at.col) : null;

  const arrow = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const where = useRef(at);
  where.current = at;
  const [lit, setLit] = useState(0);

  const box = (below: boolean) => () => {
    const L = view.current();
    if (!L) return null;
    const { row, col } = where.current;
    const m = session.merges().at(row, col);
    const b = m ? L.rectBox(m) : L.cellBox(row, col);
    const w = Math.min(b.w, 18 * zoom);
    return below ? { x: b.x, y: b.y + b.h, w: Math.max(b.w, 120), h: 0 } : { x: b.x + b.w - w, y: b.y, w, h: b.h };
  };

  useLayoutEffect(() => {
    const a = arrow.current;
    const h = holder.current;
    if (a) view.anchors.set(a, box(false));
    if (h) view.anchors.set(h, box(true));
    view.invalidate('size');
    return () => {
      if (a) view.anchors.delete(a);
      if (h) view.anchors.delete(h);
    };
    // The anchors read the active cell through a ref; they are registered once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, shown, open]);

  // A new cell or a closed list starts the list from its current value.
  useEffect(() => {
    if (!open || !choices) return;
    const now = data.editText(at.row, at.col);
    setLit(Math.max(0, choices.indexOf(now)));
    list.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !shown) onOpen(false);
  }, [open, shown, onOpen]);

  // Outside presses close it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !(holder.current?.contains(e.target) || arrow.current?.contains(e.target))) onOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open, onOpen]);

  if (!shown || !choices) return null;

  const close = () => {
    onOpen(false);
    p.focusGrid();
  };
  const choose = (value: string) => {
    p.onChoose(at, value);
    close();
  };

  return (
    <>
      <div ref={arrow} className="sg-anchor" aria-hidden={open ? undefined : true}>
        <button
          type="button"
          className="sg-arrow"
          tabIndex={-1}
          aria-label="Show choices"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={p.readOnly}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpen(!open)}
        >
          <Icon icon={caretDownIcon} size={Math.max(8, 11 * zoom)} />
        </button>
      </div>
      <div ref={holder} className="sg-anchor sg-anchor-list">
        {open && (
          <ul
            ref={list}
            role="listbox"
            tabIndex={-1}
            aria-label="Choices"
            aria-activedescendant={`${session.id}-choice-${lit}`}
            className="sg-choices oa-rise"
            style={{ minWidth: 'var(--cw)' }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setLit((lit + 1) % choices.length);
              else if (e.key === 'ArrowUp') setLit((lit - 1 + choices.length) % choices.length);
              else if (e.key === 'Enter') choose(choices[lit]!);
              else if (e.key === 'Escape' || e.key === 'Tab') close();
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {choices.map((c, i) => (
              <li
                key={c}
                id={`${session.id}-choice-${i}`}
                role="option"
                aria-selected={i === lit}
                data-lit={i === lit ? 'true' : undefined}
                onMouseEnter={() => setLit(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
              >
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
