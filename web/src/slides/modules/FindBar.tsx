/**
 * The find and replace bar: glass at the top right of the slide area, over the page. The search runs as
 * the person types, and again a moment after the deck changes under it (not on every keystroke made
 * elsewhere, so typing in a box is never behind it). Next and previous go to the slide and select the
 * match in its box (`findShow.ts`), Replace changes the match gone to and moves on, and Replace all is
 * one step over every slide (`findActions.ts`).
 *
 * It is an overlay of the find module, so it is drawn inside the shell and takes the app's colours.
 * Once opened it stays mounted while it plays its exit.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, IconButton, TextField } from '../../core/controls';
import { caretDownIcon, caretUpIcon, xIcon } from '../../core/icons';
import { usePresence } from '../../motion/presence';
import type { SlideModel } from '../model/model';
import { findAll, matchKey, positionOf, replaceAll, replaceOne, replacedText, startOfSlide, stepMatch, type Match } from './findActions';
import { showMatch } from './findShow';
import { closeFind, openFind, setFind, useFind } from './findStore';
import type { SlidesContext } from './types';
import './find.css';

/** How long after the deck changes the search is run again. */
const RESEARCH_MS = 220;

/** The deck's version, a moment after it last changed: what a search that must not be in a keystroke's way follows. */
function useSettledVersion(model: SlideModel): number {
  const [version, setVersion] = useState(model.version);
  useEffect(() => {
    setVersion(model.version);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = model.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setVersion(model.version), RESEARCH_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [model]);
  return version;
}

/** Ctrl+F and Ctrl+H while the caret is in a text box, where the page's own keys are not heard. */
function useTextBoxKeys(ctx: SlidesContext): void {
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Plain typing leaves at once: this is on the path of every keystroke.
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing) return;
      const t = e.target;
      if (!(t instanceof Element) || !t.closest('.sl-page') || !t.closest('[contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        openFind();
      } else if (k === 'h' && latest.current.can.edit) {
        e.preventDefault();
        openFind({ replace: true });
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}

/** The bar, mounted while it is open and for the length of its exit. */
export function FindHost({ ctx }: { ctx: SlidesContext }) {
  useTextBoxKeys(ctx);
  const s = useFind();
  const { present, state } = usePresence(s.open);
  // A deck that is replaced under it (a version looked at) closes it, so it never searches one and acts on another.
  const model = useRef(ctx.model);
  useEffect(() => {
    if (model.current !== ctx.model) {
      model.current = ctx.model;
      closeFind();
    }
  }, [ctx.model]);
  return present ? <Panel ctx={ctx} state={state} /> : null;
}

function Panel({ ctx, state }: { ctx: SlidesContext; state: string }) {
  const s = useFind();
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(ctx);
  latest.current = ctx;
  const cancel = useRef<() => void>(() => undefined);
  const version = useSettledVersion(ctx.model);
  const options = s.options;
  const list = useMemo(() => findAll(ctx.model, options), [ctx.model, version, options]);
  const [current, setCurrent] = useState<Match | null>(null);

  // The caret goes to the field when the bar opens and when it is asked for again.
  useEffect(() => {
    if (s.open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [s.open, s.asked]);

  useEffect(() => () => cancel.current(), []);

  const go = (m: Match) => {
    cancel.current();
    setCurrent(m);
    cancel.current = showMatch(latest.current, m);
  };

  /** The match as the list has it now: the text may have changed under the one gone to. */
  const index = current ? list.findIndex((m) => matchKey(m) === matchKey(current)) : -1;

  const step = (dir: 1 | -1) => {
    const c = latest.current;
    const from = index >= 0 && current ? positionOf(current) : startOfSlide(Math.max(0, c.slideIndex));
    const next = stepMatch(list, from, dir);
    if (next) go(next);
  };

  const close = () => {
    cancel.current();
    closeFind();
    ctx.actions.focusCanvas();
  };

  const replaceCurrent = () => {
    const c = latest.current;
    if (!current || index < 0) {
      step(1);
      return;
    }
    const r = replaceOne(c.model, current, options, s.replacement);
    if (r.outcome !== 'done') {
      c.notify({ text: replacedText(r), tone: 'danger' });
      return;
    }
    // On from where the replacement ends, so a replacement that contains the query is not found again.
    const fresh = findAll(c.model, options);
    const after = { ...positionOf(current), start: current.start + s.replacement.length - 1 };
    const next = stepMatch(fresh, after, 1);
    if (next && fresh.length) go(next);
    else setCurrent(null);
  };

  const replaceEvery = () => {
    const c = latest.current;
    const r = replaceAll(c.model, options, s.replacement);
    c.notify(r.outcome === 'done' ? { text: replacedText(r) } : { text: replacedText(r), tone: 'danger' });
    setCurrent(null);
  };

  const n = list.length.toLocaleString('en-GB');
  const count = options.query === '' ? '' : list.length === 0 ? 'No matches' : index >= 0 ? `${(index + 1).toLocaleString('en-GB')} of ${n}` : `${n} found`;
  const canReplace = ctx.can.edit && s.replace;

  return (
    <div
      className="sl-find glass oa-rise"
      role="search"
      aria-label="Find and replace"
      data-state={state}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'h')) {
          // A field has the keys, so the bar answers its own and the browser's find stays shut.
          e.preventDefault();
          if (e.key.toLowerCase() === 'h' && ctx.can.edit) setFind({ replace: true });
          input.current?.focus();
          input.current?.select();
        }
      }}
    >
      <div className="sl-find-row">
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
        <span className="sl-find-count" role="status" aria-live="polite">
          {count}
        </span>
        <IconButton icon={caretUpIcon} label="Previous match" size="sm" disabled={list.length === 0} onClick={() => step(-1)} />
        <IconButton icon={caretDownIcon} label="Next match" size="sm" disabled={list.length === 0} onClick={() => step(1)} />
        <IconButton icon={xIcon} label="Close find" size="sm" onClick={close} />
      </div>

      {canReplace && (
        <div className="sl-find-row">
          <TextField
            aria-label="Replace with"
            size="sm"
            placeholder="Replace with"
            value={s.replacement}
            onChange={(e) => setFind({ replacement: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceCurrent();
              }
            }}
          />
          <Button size="sm" variant="secondary" disabled={list.length === 0} onClick={replaceCurrent}>
            Replace
          </Button>
          <Button size="sm" variant="secondary" disabled={list.length === 0} onClick={replaceEvery}>
            Replace all
          </Button>
        </div>
      )}

      <div className="sl-find-opts">
        <Chip pressed={options.matchCase} onClick={() => setFind({ options: { matchCase: !options.matchCase } })}>
          Match case
        </Chip>
        <Chip pressed={options.wholeWord} onClick={() => setFind({ options: { wholeWord: !options.wholeWord } })}>
          Whole words
        </Chip>
        <Chip pressed={options.notes} onClick={() => setFind({ options: { notes: !options.notes } })}>
          Notes
        </Chip>
        <span style={{ flex: 1 }} />
        {ctx.can.edit && !s.replace && (
          <Button size="sm" variant="ghost" onClick={() => setFind({ replace: true })}>
            Replace
          </Button>
        )}
      </div>
    </div>
  );
}
