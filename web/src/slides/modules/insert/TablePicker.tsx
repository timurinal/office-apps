/**
 * Table: a grid of squares up to 10 columns by 8 rows. Moving over it says how large the table
 * would be and pressing a square makes it; the arrow keys move over the squares and Enter makes it.
 * The first cell has the caret when the table is in.
 */

import { useRef, useState } from 'react';
import type React from 'react';
import { caretDownIcon, Icon } from '../../../core/icons';
import { Popover } from '../../../core/ui';
import type { SlidesContext } from '../types';
import { TABLE_MAX } from './defaults';
import { tableIcon } from './icons';
import { keepSelection, useOpen } from './menus';
import { insertTable } from './place';
import { enterCell } from './tables';
import './shapes.css';

interface At {
  r: number;
  c: number;
}

export function TableButton({ ctx, id }: { ctx: SlidesContext; id: string }) {
  const o = useOpen(250);
  const [at, setAt] = useState<At | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const disabled = !ctx.can.edit || !ctx.slideId;

  const make = (rows: number, cols: number): void => {
    o.close();
    setAt(null);
    const made = insertTable({ model: ctx.model, selection: ctx.selection }, rows, cols);
    if (made && ctx.slideId) enterCell(ctx.model, ctx.slideId, made, 0, 0);
  };

  const move = (e: React.KeyboardEvent) => {
    const from = at ?? { r: 1, c: 1 };
    const to = { ...from };
    if (e.key === 'ArrowRight') to.c = Math.min(TABLE_MAX.cols, from.c + 1);
    else if (e.key === 'ArrowLeft') to.c = Math.max(1, from.c - 1);
    else if (e.key === 'ArrowDown') to.r = Math.min(TABLE_MAX.rows, from.r + 1);
    else if (e.key === 'ArrowUp') to.r = Math.max(1, from.r - 1);
    else return;
    e.preventDefault();
    setAt(to);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-r="${to.r}"][data-c="${to.c}"]`)?.focus());
  };

  const cells: React.ReactNode[] = [];
  for (let r = 1; r <= TABLE_MAX.rows; r++) {
    for (let c = 1; c <= TABLE_MAX.cols; c++) {
      const on = !!at && r <= at.r && c <= at.c;
      cells.push(
        <button
          key={`${r}.${c}`}
          type="button"
          className="sl-table-cell"
          data-r={r}
          data-c={c}
          data-on={on ? '' : undefined}
          tabIndex={(at ?? { r: 1, c: 1 }).r === r && (at ?? { r: 1, c: 1 }).c === c ? 0 : -1}
          aria-label={`${r} ${r === 1 ? 'row' : 'rows'} by ${c} ${c === 1 ? 'column' : 'columns'}`}
          onMouseDown={keepSelection}
          onMouseEnter={() => setAt({ r, c })}
          onFocus={() => setAt({ r, c })}
          onClick={() => make(r, c)}
        />
      );
    }
  }

  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id={id}
        className="oa-rb-tl"
        aria-haspopup="dialog"
        aria-expanded={o.open}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={tableIcon} size={16} />
        Table
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={() => (o.close(), setAt(null))} align={o.align} role="dialog" label="Table" className="sl-table-pop">
        <div ref={grid} className="sl-table-grid" role="group" aria-label="Table size" onKeyDown={move} onMouseLeave={() => setAt(null)}>
          {cells}
        </div>
        <div className="sl-table-size" aria-live="polite">
          {at ? `${at.r} × ${at.c} table` : 'Table'}
        </div>
      </Popover>
    </span>
  );
}
