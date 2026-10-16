/**
 * The File menu's rows, in sections. The rows come from the modules' `fileItems`
 * (docs/modules/types.ts), so Download, Print and "Save as template" appear the
 * moment a module contributes them.
 *
 * A row with a `submenu` ("Download a copy", "Save as") draws a ▸ and opens its choices beside it,
 * in the context menu's own panel (`HostedSubmenu`): on hover, with the same grace for a pointer
 * crossing to it, on Right and Enter with the keyboard on its first choice, and on a tap (never on a
 * touch, which has no hover). Left or
 * Escape closes it and the keyboard goes back to the row. A choice closes the whole menu: the
 * popover that holds this closes on any click inside it.
 *
 * The menu takes the keyboard when it was opened with the keyboard, and gives it back to the File
 * tab when it is closed with Escape or a choice.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HostedSubmenu, type ContextEntry } from '../ContextMenu';
import { caretRightIcon, Icon } from '../icons';
import type { Box } from '../placement';
import { fileSections } from './registry';
import type { FileItem } from './types';

/** The pointer must not be taken for having left while it crosses to the submenu (ContextMenu's grace). */
const LEAVE_MS = 140;

interface Open {
  id: string;
  rect: Box;
  /** The keyboard goes to its first choice. */
  focus: boolean;
}

export function FileMenu<C>({ items, ctx }: { items: readonly FileItem<C>[]; ctx: C }) {
  const sections = fileSections(items, ctx);
  const flat = sections.flatMap((s) => s.items);
  const root = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => () => clearTimeout(leaving.current), []);

  // The submenu is fixed to the window where its row was; a resize leaves it nowhere.
  useEffect(() => {
    if (!open) return;
    const away = () => setOpen(null);
    window.addEventListener('resize', away);
    return () => window.removeEventListener('resize', away);
  }, [open]);

  // The File tab this menu hangs from, which the keyboard comes back to.
  const tab = useCallback((): HTMLElement | null => root.current?.closest('.oa-pop-wrap')?.querySelector<HTMLElement>(':scope > button') ?? null, []);
  const focusable = (): HTMLButtonElement[] => [...(root.current?.querySelectorAll<HTMLButtonElement>('button[data-file-row]:not(:disabled)') ?? [])];

  // Opened with the keyboard (the tab still has it): the first row.
  useLayoutEffect(() => {
    if (document.activeElement === tab()) focusable()[0]?.focus({ preventScroll: true });
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSub = (item: FileItem<C>, row: HTMLElement, focus: boolean) => {
    clearTimeout(leaving.current);
    setOpen((o) => (o && o.id === item.id && !focus ? o : { id: item.id, rect: row.getBoundingClientRect(), focus }));
  };

  const closeSub = (refocus: boolean) => {
    const at = open?.id;
    setOpen(null);
    if (refocus && at !== undefined) rows.current.get(at)?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = focusable();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (to: number) => {
      const target = list[((to % list.length) + list.length) % list.length];
      if (!target) return;
      e.preventDefault();
      setOpen(null);
      target.focus({ preventScroll: true });
    };
    switch (e.key) {
      case 'ArrowDown':
        go(at + 1);
        break;
      case 'ArrowUp':
        go(at < 0 ? list.length - 1 : at - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(list.length - 1);
        break;
      case 'ArrowRight':
      case 'Enter': {
        const row = document.activeElement as HTMLButtonElement | null;
        const item = row?.dataset.fileRow === undefined ? undefined : flat.find((i) => i.id === row.dataset.fileRow);
        if (row && item?.submenu && !row.disabled) {
          e.preventDefault();
          openSub(item, row, true);
        }
        break;
      }
      case 'Escape':
        // The popover closes on this key itself; the keyboard goes back to the tab first.
        tab()?.focus({ preventScroll: true });
        break;
    }
  };

  const shown = open ? flat.find((i) => i.id === open.id) : undefined;
  const entries: ContextEntry[] =
    shown?.submenu?.map((c) => ({
      id: c.id,
      label: c.label,
      ...(c.icon ? { icon: c.icon } : {}),
      ...(c.shortcut ? { shortcut: c.shortcut } : {}),
      disabled: c.disabled?.(ctx) ?? false,
      onSelect: () => c.run(ctx)
    })) ?? [];

  return (
    <div ref={root} role="none" onKeyDown={onKeyDown}>
      {sections.map((s, i) => (
        <div key={s.section} role="group" aria-label={s.section}>
          {i > 0 && <div className="oa-menu-rule" />}
          {s.items.map((item) => {
            const sub = item.submenu !== undefined;
            return (
              <button
                key={item.id}
                ref={(b) => {
                  if (b) rows.current.set(item.id, b);
                  else rows.current.delete(item.id);
                }}
                type="button"
                role="menuitem"
                className="oa-menu-item"
                data-file-row={item.id}
                data-tone={item.danger ? 'danger' : undefined}
                aria-haspopup={sub ? 'menu' : undefined}
                aria-expanded={sub ? open?.id === item.id : undefined}
                disabled={item.disabled?.(ctx) ?? false}
                onClick={(e) => {
                  if (item.submenu) {
                    // Opens its choices; the menu stays.
                    e.stopPropagation();
                    openSub(item, e.currentTarget, true);
                    return;
                  }
                  // The keyboard goes back to the tab before the row runs, so a row that moves it keeps what it did.
                  if (document.activeElement && root.current?.contains(document.activeElement)) tab()?.focus({ preventScroll: true });
                  item.run(ctx);
                }}
                onPointerEnter={(e) => {
                  // A finger does not hover: its tap opens the submenu. One opened at the touch would be
                  // over the row by the time the tap's own click arrives, and take it.
                  if (e.pointerType === 'touch') return;
                  clearTimeout(leaving.current);
                  if (sub && !e.currentTarget.disabled) openSub(item, e.currentTarget, false);
                  else if (open) leaving.current = setTimeout(() => setOpen(null), LEAVE_MS);
                }}
              >
                {item.icon ? <Icon icon={item.icon} size={16} /> : <span className="oa-menu-gap" />}
                <span className="oa-menu-label">{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
                {sub && <Icon icon={caretRightIcon} size={12} className="oa-menu-sub" />}
              </button>
            );
          })}
        </div>
      ))}
      {open && shown?.submenu && (
        <HostedSubmenu
          key={open.id}
          entries={entries}
          label={shown.label}
          rect={open.rect}
          from={rows.current.get(open.id) ?? null}
          focus={open.focus}
          onBack={() => closeSub(true)}
          onEnter={() => clearTimeout(leaving.current)}
          onChoose={() => {
            setOpen(null);
            tab()?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
