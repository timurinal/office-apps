/**
 * The right-click menu of one editor: the state of whether it is open and for what, and the asking of
 * its modules what goes in it.
 *
 * An editor keeps one of these. What a click landed on (a cell, a shape, a table in the text) is the
 * `target`; every module's `contextItems(target, ctx)` is asked, the groups they answer with are
 * joined in `order` (ContextMenu.tsx, `joinGroups`), and the menu draws the result. A module adds a
 * row to a menu by answering for the target and not by touching anyone else's file.
 *
 *   const menu = useContextMenu({ ctx, hooks: COLLECTED.context, label: ..., returnFocus: ... });
 *   onContextMenu: if (menu.open(target, { x, y }, element)) event.preventDefault();
 *   {menu.element}
 *
 * `open` answers false when no module has a row for the target, and then draws nothing: the caller
 * leaves the browser's own menu alone, which is what a reader with nothing to do should get.
 * The rows are asked again on every render while the menu is open, so a row that has become
 * disabled (a clipboard that emptied, a selection that moved) shows it.
 */

import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { ContextMenu, joinGroups, type ContextEntry, type ContextHook, type Point } from './ContextMenu';

interface Opening<T> {
  target: T;
  at: Point;
  from: Element | null;
}

export interface ContextMenuHost<T> {
  /** The rows for a target now. */
  entries: (target: T) => ContextEntry[];
  /** Open it. False, and nothing drawn, when there is nothing to show. */
  open: (target: T, at: Point, from?: Element | null) => boolean;
  close: () => void;
  isOpen: boolean;
  /** Render this once, anywhere in the editor. */
  element: React.ReactNode;
}

export function useContextMenu<T, C>(options: {
  ctx: C | null;
  hooks: readonly ContextHook<T, C>[];
  label: (target: T) => string;
  /** Where the keyboard goes after a choice or Escape. Without it, to where it was. */
  returnFocus?: (target: T) => void;
}): ContextMenuHost<T> {
  const [opening, setOpening] = useState<Opening<T> | null>(null);
  const latest = useRef(options);
  latest.current = options;

  const entries = useCallback((target: T): ContextEntry[] => {
    const { ctx, hooks } = latest.current;
    return ctx ? joinGroups(hooks.flatMap((h) => h(target, ctx))) : [];
  }, []);

  const open = useCallback(
    (target: T, at: Point, from?: Element | null): boolean => {
      if (entries(target).length === 0) return false;
      setOpening({ target, at: { x: at.x, y: at.y }, from: from ?? null });
      return true;
    },
    [entries]
  );
  const close = useCallback(() => setOpening(null), []);

  const target = opening?.target;
  const back = options.returnFocus;
  const element = (
    <ContextMenu
      at={opening?.at ?? null}
      items={opening ? entries(opening.target) : []}
      label={opening ? options.label(opening.target) : ''}
      from={opening?.from ?? null}
      onClose={close}
      {...(back && target !== undefined ? { returnFocus: () => back(target) } : {})}
    />
  );
  return { entries, open, close, isOpen: opening !== null, element };
}
