/**
 * The find and replace bar: a glass strip at the top right of the page, under the banner.
 *
 * It owns no state of its own about the search. The query, the flags and the matches are
 * the plugin's (find.ts), and everything here is a message to it, so the highlights, the
 * count and the bar cannot disagree. Enter goes to the next match and Shift+Enter to the
 * one before; Escape closes the bar and puts the caret where the match was.
 */

import type { Editor } from '@tiptap/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Chip, IconButton, TextField } from '../../core/controls';
import { caretDownIcon, caretUpIcon, xIcon } from '../../core/icons';
import { usePresence } from '../../motion/presence';
import { closeFind, findKey, findState, openFind, replaceAll, replaceCurrent, setFind, stepFind } from './find';
import { useEditorTick, viewOf } from './hooks';

/** Where the bar goes: under the banner, left of the pane on the right when one is open. */
function useBarPlace(root: HTMLElement | null, active: boolean): { top: number; right: number } {
  const [at, setAt] = useState({ top: 150, right: 24 });
  useLayoutEffect(() => {
    if (!root || !active) return;
    const place = () => {
      const banner = root.querySelector('.oa-banner');
      const pane = root.querySelector('.oa-pane[data-side="right"]');
      const top = banner ? banner.getBoundingClientRect().bottom + 8 : 150;
      const right = pane ? window.innerWidth - pane.getBoundingClientRect().left + 8 : 24;
      setAt((p) => (p.top === top && p.right === right ? p : { top, right }));
    };
    place();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    const banner = root.querySelector('.oa-banner');
    if (banner) ro?.observe(banner);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [root, active]);
  return at;
}

export function FindBar({ editor, root, canEdit }: { editor: Editor; root: HTMLElement | null; canEdit: boolean }) {
  // Only the search's own messages and, while it is open, changes to the text: a closed bar
  // costs a keystroke nothing.
  useEditorTick(editor, true, { docs: findState(editor).open ? 'frame' : 'never', selection: false, also: (tr) => tr.getMeta(findKey) !== undefined });
  const s = findState(editor);
  const { present, state } = usePresence(s.open);
  const input = useRef<HTMLInputElement>(null);
  const at = useBarPlace(root, present);
  // What is typed in a field is kept here and sent to the search, not read back from it: the
  // search's state reaches this component a frame later, and a controlled field that is told
  // the old text between two keystrokes drops the second one.
  const [query, setQuery] = useState(s.query);
  const [replace, setReplace] = useState(s.replace);
  useEffect(() => setQuery(s.query), [s.query]);
  useEffect(() => setReplace(s.replace), [s.replace]);
  const dom = viewOf(editor)?.dom ?? null;

  // A second Ctrl+F in the page asks the bar that is already open for the caret.
  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    // The element is kept: by the time this cleans up the editor may be destroyed, and a
    // destroyed editor has no view to ask. A new view is a new element, so it is a dependency.
    if (!dom) return;
    dom.addEventListener('oa-find-focus', focus);
    return () => dom.removeEventListener('oa-find-focus', focus);
  }, [dom]);

  // Escape closes the bar from the page and from a button that was disabled under the
  // pointer (Replace all, when there is nothing left), where the focus has fallen to the
  // body and the bar's own handler never hears it.
  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as Node | null;
      if (target === document.body || target === document.documentElement || (dom && dom.contains(target))) {
        closeFind(editor);
        editor.commands.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [s.open, editor, dom]);

  // The first one: the field takes the caret as the bar appears.
  useEffect(() => {
    if (s.open) input.current?.focus();
    // Only when it opens, not each time a match is found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.open]);

  if (!root || !present) return null;

  const close = () => {
    closeFind(editor);
    editor.commands.focus();
  };
  const count = !s.query ? '' : s.matches.length === 0 ? 'No matches' : `${s.current + 1} of ${s.matches.length}`;

  return createPortal(
    <div
      className="oa-findbar glass oa-rise"
      role="search"
      aria-label="Find and replace"
      data-state={state}
      style={{ top: at.top, right: at.right }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="oa-findbar-row">
        <TextField
          aria-label="Find"
          size="sm"
          placeholder="Find"
          inputRef={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFind(editor, { query: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              stepFind(editor, e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="oa-findbar-count" role="status" aria-live="polite">
          {count}
        </span>
        <IconButton icon={caretUpIcon} label="Previous match" size="sm" disabled={s.matches.length === 0} onClick={() => stepFind(editor, -1)} />
        <IconButton icon={caretDownIcon} label="Next match" size="sm" disabled={s.matches.length === 0} onClick={() => stepFind(editor, 1)} />
        <IconButton icon={xIcon} label="Close find" size="sm" onClick={close} />
      </div>

      {s.showReplace && canEdit && (
        <div className="oa-findbar-row">
          <TextField
            aria-label="Replace with"
            size="sm"
            placeholder="Replace with"
            value={replace}
            onChange={(e) => {
              setReplace(e.target.value);
              setFind(editor, { replace: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceCurrent(editor);
              }
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={s.matches.length === 0}
            onClick={() => {
              replaceCurrent(editor);
              input.current?.focus();
            }}
          >
            Replace
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={s.matches.length === 0}
            onClick={() => {
              replaceAll(editor);
              // The button is disabled now that nothing is left; the caret stays in the bar.
              input.current?.focus();
            }}
          >
            Replace all
          </Button>
        </div>
      )}

      <div className="oa-findbar-opts">
        <Chip pressed={s.matchCase} onClick={() => setFind(editor, { matchCase: !s.matchCase })}>
          Match case
        </Chip>
        <Chip pressed={s.wholeWord} onClick={() => setFind(editor, { wholeWord: !s.wholeWord })}>
          Whole word
        </Chip>
        <span style={{ flex: 1 }} />
        {canEdit && !s.showReplace && (
          <Button size="sm" variant="ghost" onClick={() => openFind(editor, { replace: true })}>
            Replace
          </Button>
        )}
      </div>
    </div>,
    root
  );
}
