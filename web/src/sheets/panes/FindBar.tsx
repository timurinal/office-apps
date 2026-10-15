/**
 * The find and replace bar: glass under the banner at the right, as Docs' is. The search runs as
 * the person types, a little after, and gives the page back every few thousand cells (findAll), so a
 * search of a big workbook is never in the way of the next key. Next and previous select the cell
 * (on another sheet too), Replace changes the cell found and moves on, and Replace all is one step.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Chip, IconButton, TextField } from '../../core/controls';
import { caretDownIcon, caretUpIcon, xIcon } from '../../core/icons';
import { usePresence } from '../../motion/presence';
import { type Match, findAll, replaceMatches, replacedText, stepMatch } from '../modules/findActions';
import type { SheetsContext } from '../modules/types';
import { closeFind, setFind, useFind } from './findStore';
import { useModelVersion } from './parts';

/** Under the banner, left of the pane on the right when one is open. */
function usePlace(active: boolean): { top: number; right: number } {
  const [at, setAt] = useState({ top: 150, right: 24 });
  useLayoutEffect(() => {
    if (!active) return;
    const place = () => {
      const banner = document.querySelector('.oa-banner');
      const pane = document.querySelector('.oa-pane[data-side="right"]');
      const top = banner ? banner.getBoundingClientRect().bottom + 8 : 150;
      const right = pane ? window.innerWidth - pane.getBoundingClientRect().left + 8 : 24;
      setAt((p) => (p.top === top && p.right === right ? p : { top, right }));
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    const banner = document.querySelector('.oa-banner');
    if (banner) ro?.observe(banner);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [active]);
  return at;
}

/** The bar is mounted while it is open and for the length of its exit, and follows the workbook only then. */
export default function FindBar({ ctx }: { ctx: SheetsContext }) {
  const s = useFind();
  const { present, state } = usePresence(s.open);
  return present ? <Panel ctx={ctx} state={state} /> : null;
}

function Panel({ ctx, state }: { ctx: SheetsContext; state: string }) {
  const s = useFind();
  const at = usePlace(true);
  const input = useRef<HTMLInputElement>(null);
  const version = useModelVersion(ctx.model);
  const [list, setList] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<Match | null>(null);
  // A match on a sheet that is not showing: selected once its sheet is.
  const pending = useRef<Match | null>(null);
  const latest = useRef(ctx);
  latest.current = ctx;
  const sheetOrder = ctx.model.sheets().map((x) => x.id);

  // The search, after a pause in typing and again after the workbook changes under it.
  const options = s.options;
  useEffect(() => {
    if (!s.open) return;
    let stale = false;
    setBusy(true);
    const timer = setTimeout(() => {
      void findAll(latest.current, options, () => stale).then((found) => {
        if (stale || !found) return;
        setList(found);
        setBusy(false);
        setCurrent((c) => (c && found.some((m) => m.sheet === c.sheet && m.row === c.row && m.col === c.col) ? c : null));
      });
    }, 140);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // The version is a dependency: a change anywhere may add or remove a match.
  }, [s.open, options, version, ctx.sheetId]);

  // The caret goes to the field when the bar opens and when it is asked for again.
  useEffect(() => {
    if (s.open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [s.open, s.asked]);

  // A match on another sheet is selected when that sheet has come.
  useEffect(() => {
    const m = pending.current;
    if (m && m.sheet === ctx.sheetId) {
      pending.current = null;
      ctx.session.selectCell({ row: m.row, col: m.col }, false);
    }
  }, [ctx.sheetId, ctx.session, ctx]);

  const go = useCallback((m: Match) => {
    const c = latest.current;
    setCurrent(m);
    if (m.sheet === c.sheetId) c.session.selectCell({ row: m.row, col: m.col }, false);
    else {
      pending.current = m;
      c.showSheet(m.sheet);
    }
  }, []);

  const step = (dir: 1 | -1) => {
    // From the match last gone to, or from the cell the person is on.
    const here = current ?? { sheet: ctx.sheetId, row: ctx.session.sel.active.row, col: ctx.session.sel.active.col };
    const i = stepMatch(list, sheetOrder, here, dir);
    const m = list[i];
    if (m) go(m);
  };

  const close = () => {
    closeFind();
    ctx.actions.focusGrid();
  };

  const replaceOne = () => {
    if (!current) {
      step(1);
      return;
    }
    const idx = list.findIndex((m) => m.sheet === current.sheet && m.row === current.row && m.col === current.col);
    const res = replaceMatches(ctx, [current], options, s.replacement);
    if (res.cells === 0) ctx.notify({ text: replacedText(res) });
    // The list is made again by the search; move on from where this one was.
    const next = list[idx + 1] ?? list[0];
    if (next && next !== current) go(next);
  };

  const replaceEvery = () => {
    const res = replaceMatches(ctx, list, options, s.replacement);
    ctx.notify({ text: replacedText(res) });
    setCurrent(null);
  };

  const index = current ? list.findIndex((m) => m.sheet === current.sheet && m.row === current.row && m.col === current.col) : -1;
  const count = options.query === '' ? '' : busy && list.length === 0 ? 'Searching' : list.length === 0 ? 'No matches' : index >= 0 ? `${index + 1} of ${list.length.toLocaleString('en-GB')}` : `${list.length.toLocaleString('en-GB')} found`;
  const canReplace = ctx.can.edit && s.replace;

  return createPortal(
    <div data-app="sheets" style={{ display: 'contents' }}>
      <div
        className="sx-find glass oa-rise"
        role="search"
        aria-label="Find and replace"
        data-state={state}
        style={{ top: at.top, right: at.right }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h')) {
            // The page's keys do not reach a field, so the bar answers its own: the browser's find stays shut.
            e.preventDefault();
            if (e.key.toLowerCase() === 'h' && ctx.can.edit) setFind({ replace: true });
            input.current?.focus();
            input.current?.select();
          }
        }}
      >
        <div className="sx-find-row">
          <TextField
            aria-label="Find"
            size="sm"
            placeholder="Find"
            inputRef={input}
            value={options.query}
            onChange={(e) => setFind({ options: { query: e.target.value } })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className="sx-find-count" role="status" aria-live="polite">
            {count}
          </span>
          <IconButton icon={caretUpIcon} label="Previous match" size="sm" disabled={list.length === 0} onClick={() => step(-1)} />
          <IconButton icon={caretDownIcon} label="Next match" size="sm" disabled={list.length === 0} onClick={() => step(1)} />
          <IconButton icon={xIcon} label="Close find" size="sm" onClick={close} />
        </div>

        {canReplace && (
          <div className="sx-find-row">
            <TextField
              aria-label="Replace with"
              size="sm"
              placeholder="Replace with"
              value={s.replacement}
              onChange={(e) => setFind({ replacement: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  replaceOne();
                }
              }}
            />
            <Button size="sm" variant="secondary" disabled={list.length === 0} onClick={replaceOne}>
              Replace
            </Button>
            <Button size="sm" variant="secondary" disabled={list.length === 0} onClick={replaceEvery}>
              Replace all
            </Button>
          </div>
        )}

        <div className="sx-find-opts">
          <Chip pressed={options.matchCase} onClick={() => setFind({ options: { matchCase: !options.matchCase } })}>
            Match case
          </Chip>
          <Chip pressed={options.wholeCell} onClick={() => setFind({ options: { wholeCell: !options.wholeCell } })}>
            Whole cell
          </Chip>
          <Chip pressed={options.inFormulas} onClick={() => setFind({ options: { inFormulas: !options.inFormulas } })}>
            Formulas
          </Chip>
          <Chip pressed={options.scope === 'workbook'} onClick={() => setFind({ options: { scope: options.scope === 'workbook' ? 'sheet' : 'workbook' } })}>
            All sheets
          </Chip>
          <span style={{ flex: 1 }} />
          {ctx.can.edit && !s.replace && (
            <Button size="sm" variant="ghost" onClick={() => setFind({ replace: true })}>
              Replace
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
