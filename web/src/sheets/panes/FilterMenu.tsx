/**
 * The menu a filter button opens: sort the column, keep the values that are ticked, or keep what a
 * condition says. It sits at the button, over the page, and changes the filter for everybody: the
 * rows it hides are hidden in every browser that has the workbook open, as in Excel.
 *
 * The values list shows what the column holds among the rows the other columns let through, with
 * how many rows each value has. Ticking is a draft until OK, and OK on an untouched list does
 * nothing, so opening the menu on a column that carries a condition and closing it leaves the
 * condition alone.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select, TextField } from '../../core/controls';
import { inPortalledPopup } from '../../core/popupScope';
import { Icon } from '../../core/icons';
import { DUR } from '../../motion';
import { usePresence } from '../../motion/presence';
import type { Comparison, FilterCriterion } from '../model';
import { setCriterion, setValuesFilter, sortFilterColumn } from '../modules/dataActions';
import { funnelXIcon, sortAscendingIcon, sortDescendingIcon } from '../modules/formatIcons';
import { Check, type ToolProps } from './parts';

const MENU_W = 288;
const SHOWN = 500;

interface Cond {
  id: string;
  label: string;
  make: (a: string, b: string) => FilterCriterion;
  /** How many values it needs. */
  needs: 0 | 1 | 2;
  /** For a column of numbers or of text, whichever it suits first. */
  text?: boolean;
}

const numberOrText = (s: string): number | string => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : s.trim();
};

const compare = (op: Comparison, label: string): Cond => ({ id: op, label, needs: op === 'between' || op === 'notBetween' ? 2 : 1, make: (a, b) => ({ kind: 'condition', op, a: numberOrText(a), ...(op === 'between' || op === 'notBetween' ? { b: numberOrText(b) } : {}) }) });
const textual = (op: 'contains' | 'notContains' | 'begins' | 'ends', label: string): Cond => ({ id: op, label, needs: 1, text: true, make: (a) => ({ kind: 'text', op, text: a }) });

const CONDITIONS: Cond[] = [
  compare('eq', 'Equals'),
  compare('ne', 'Does not equal'),
  compare('gt', 'Greater than'),
  compare('ge', 'Greater than or equal to'),
  compare('lt', 'Less than'),
  compare('le', 'Less than or equal to'),
  compare('between', 'Between'),
  compare('notBetween', 'Not between'),
  textual('contains', 'Contains'),
  textual('notContains', 'Does not contain'),
  textual('begins', 'Begins with'),
  textual('ends', 'Ends with'),
  { id: 'blank', label: 'Is blank', needs: 0, make: () => ({ kind: 'blank' }) },
  { id: 'notBlank', label: 'Is not blank', needs: 0, make: () => ({ kind: 'blank', not: true }) }
];

/** Which condition a stored criterion is, and what was typed for it. */
function condFrom(c: FilterCriterion | null): { id: string; a: string; b: string } | null {
  if (!c || c.kind === 'values') return null;
  if (c.kind === 'condition') return { id: c.op, a: String(c.a), b: c.b === undefined ? '' : String(c.b) };
  if (c.kind === 'text') return { id: c.op, a: c.text, b: '' };
  return { id: c.not ? 'notBlank' : 'blank', a: '', b: '' };
}

/** The menu's place: under the header cell, kept on screen. */
function placeFor(ctx: ToolProps['ctx'], headerRow: number, col: number): { left: number; top: number } {
  const L = ctx.session.layout();
  const scroller = document.querySelector(`[data-sg-editor="${ctx.session.id}"]`)?.closest('.sg-root')?.querySelector('.sg-scroller');
  if (!L || !scroller) return { left: 24, top: 220 };
  const at = scroller.getBoundingClientRect();
  const cell = L.cellBox(headerRow, col);
  // Its left edge on the cell's, as Excel's is; moved left only where it would run off the page.
  const left = Math.max(8, Math.min(window.innerWidth - MENU_W - 8, at.left + cell.x));
  return { left, top: at.top + cell.y + cell.h + 4 };
}

export default function FilterMenu({ ctx, onClose, col }: ToolProps & { col: number }) {
  const filter = ctx.data.filter();
  const features = ctx.data.features();
  const now = useMemo(() => ctx.model.filterCriterion(ctx.sheetId, col), [ctx, col]);
  const items = useMemo(() => features?.columnValues(col) ?? [], [features, col]);
  const header = filter ? ctx.data.cell(filter.headerRow, col)?.text || `column ${col + 1}` : '';
  const numeric = items.length > 0 && items.filter((i) => typeof i.value === 'number').length * 2 >= items.length;

  const root = useRef<HTMLDivElement>(null);
  // Leaving fades, as every menu does: it stays for the length of its exit, then tells its owner.
  const [shown, setShown] = useState(true);
  const { state } = usePresence(shown);
  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setShown(false);
    setTimeout(() => onClose(), DUR.fast);
  }, [onClose]);
  const [at, setAt] = useState(() => placeFor(ctx, filter?.headerRow ?? 0, col));
  const [query, setQuery] = useState('');
  const hiddenNow = useMemo(() => (now?.kind === 'values' ? new Set(now.hidden) : new Set<string>()), [now]);
  const [ticked, setTicked] = useState(() => new Set(items.filter((i) => !hiddenNow.has(i.text)).map((i) => i.text)));
  const [touched, setTouched] = useState(false);
  const start = condFrom(now);
  const [open, setOpen] = useState(start !== null);
  const [condId, setCondId] = useState(start?.id ?? (numeric ? 'gt' : 'contains'));
  const [a, setA] = useState(start?.a ?? '');
  const [b, setB] = useState(start?.b ?? '');

  // Nothing to show: the filter went (another person turned it off), or this column is not in it.
  const gone = !filter || !features || !filter.cols.includes(col);
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  // Kept on screen once its height is known.
  useLayoutEffect(() => {
    const h = root.current?.getBoundingClientRect().height ?? 0;
    setAt((p) => (p.top + h > window.innerHeight - 8 ? { ...p, top: Math.max(8, window.innerHeight - 8 - h) } : p));
  }, [open, items.length]);

  // A press outside closes it; the press that opened it (the filter button's) is not outside.
  useEffect(() => {
    const opened = performance.now();
    const away = (e: PointerEvent) => {
      if (e.timeStamp < opened) return;
      if (root.current && !root.current.contains(e.target as Node) && !inPortalledPopup(e.target)) leave();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        leave();
        ctx.actions.focusGrid();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [ctx, leave]);

  if (gone) return null;

  const q = query.trim().toLowerCase();
  const visible = items.filter((i) => !q || (i.text === '' ? '(blanks)' : i.text).toLowerCase().includes(q));
  const allVisibleTicked = visible.length > 0 && visible.every((i) => ticked.has(i.text));
  const toggleAll = (on: boolean) => {
    setTouched(true);
    setTicked((p) => {
      const next = new Set(p);
      for (const i of visible) (on ? next.add(i.text) : next.delete(i.text));
      return next;
    });
  };
  const toggle = (text: string, on: boolean) => {
    setTouched(true);
    setTicked((p) => {
      const next = new Set(p);
      if (on) next.add(text);
      else next.delete(text);
      return next;
    });
  };

  const done = () => {
    leave();
    ctx.actions.focusGrid();
  };

  const ok = () => {
    if (touched) {
      // Values that the other filters hide are not in the list, and stay as they were.
      const listed = new Set(items.map((i) => i.text));
      setValuesFilter(ctx, col, ticked, [...listed], [...hiddenNow].filter((v) => !listed.has(v)));
    }
    done();
  };

  const conds = [...CONDITIONS].sort((x, y) => Number(!!x.text === numeric) - Number(!!y.text === numeric));
  const cond = CONDITIONS.find((c) => c.id === condId) ?? CONDITIONS[0]!;
  const canApply = cond.needs === 0 || (a.trim() !== '' && (cond.needs === 1 || b.trim() !== ''));

  return createPortal(
    <div data-app="sheets" style={{ display: 'contents' }}>
      <div
        ref={root}
        className="sx-menu oa-rise"
        data-state={state}
        role="dialog"
        aria-label={`Filter ${header}`}
        style={{ left: at.left, top: at.top }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault();
            ok();
          }
        }}
      >
        <button type="button" className="oa-menu-item" onClick={() => (sortFilterColumn(ctx, col, false), done())} disabled={!ctx.can.edit}>
          <Icon icon={sortAscendingIcon} size={16} />
          <span className="oa-menu-label">Sort A to Z</span>
        </button>
        <button type="button" className="oa-menu-item" onClick={() => (sortFilterColumn(ctx, col, true), done())} disabled={!ctx.can.edit}>
          <Icon icon={sortDescendingIcon} size={16} />
          <span className="oa-menu-label">Sort Z to A</span>
        </button>
        <button
          type="button"
          className="oa-menu-item"
          disabled={!ctx.can.edit || !now}
          onClick={() => {
            setCriterion(ctx, col, null);
            done();
          }}
        >
          <Icon icon={funnelXIcon} size={16} />
          <span className="oa-menu-label">Clear filter from {header}</span>
        </button>
        <div className="oa-menu-rule" />

        <button type="button" className="oa-menu-item" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="oa-menu-gap" />
          <span className="oa-menu-label">{numeric ? 'Number filters' : 'Text filters'}</span>
          <span className="sx-dim">{open ? 'Hide' : 'Show'}</span>
        </button>
        {open && (
          <div className="sx-menu-cond">
            <Select label="Keep rows where the value" size="sm" value={cond.id} options={conds.map((c) => ({ value: c.id, label: c.label }))} onChange={setCondId} />
            {cond.needs >= 1 && <TextField aria-label="Value" size="sm" value={a} onChange={(e) => setA(e.target.value)} />}
            {cond.needs === 2 && <TextField aria-label="Second value" size="sm" value={b} onChange={(e) => setB(e.target.value)} />}
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!ctx.can.edit || !canApply}
                onClick={() => {
                  setCriterion(ctx, col, cond.make(a, b));
                  done();
                }}
              >
                Apply condition
              </Button>
            </div>
          </div>
        )}
        <div className="oa-menu-rule" />

        <TextField aria-label="Search the values" placeholder="Search" size="sm" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <div className="sx-list sx-menu-values" role="group" aria-label="Values">
          <Check checked={allVisibleTicked} onChange={toggleAll} disabled={visible.length === 0}>
            {q ? 'Select all results' : 'Select all'}
          </Check>
          {visible.slice(0, SHOWN).map((i) => (
            <Check key={i.text} checked={ticked.has(i.text)} onChange={(on) => toggle(i.text, on)}>
              <span className="sx-menu-row">
                <span>{i.text === '' ? '(Blanks)' : i.text}</span>
                <span className="sx-menu-count">{i.count.toLocaleString('en-GB')}</span>
              </span>
            </Check>
          ))}
          {visible.length > SHOWN && <p className="sx-note" style={{ padding: '6px 12px' }}>{(visible.length - SHOWN).toLocaleString('en-GB')} more. Search to narrow them.</p>}
          {visible.length === 0 && <p className="sx-note" style={{ padding: '6px 12px' }}>Nothing matches.</p>}
        </div>
        <div className="sx-menu-foot">
          <Button size="sm" variant="ghost" onClick={done}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!ctx.can.edit} onClick={ok}>
            OK
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
