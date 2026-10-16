/**
 * The right-click menu, and the menu a menu key opens: one component for Sheets, Slides and Docs.
 *
 * What it does that the ribbon's popover does not:
 *
 *   rows        an icon, a shortcut hint, a tick (`checked`), a rule, a disabled row, a danger row, and
 *               a submenu (`submenu`, drawn with a ▸) that opens on hover or Right and closes on Left or
 *               Escape. A `custom` row holds anything else (the sheet tab menu's colour swatches).
 *   keyboard    Up, Down, Home, End; Tab does the same, so the keyboard cannot leave the menu; Right opens
 *               a submenu and Left or Escape closes it; Enter and Space choose; a letter types ahead.
 *   focus       the menu takes the keyboard when it opens, and gives it back when it is closed by Escape
 *               or by a choice: to where it was, or to `returnFocus` (the canvas, the grid). A press
 *               outside, a scroll, a resize and the window losing focus close it and take nothing back.
 *   placement   `placement.ts`: at the pointer, flipped up and left where there is no room, with a height
 *               to scroll in where the window is shorter than the menu; a submenu beside its row.
 *   drawing     in a portal on <body> and `position: fixed`, so no ancestor's overflow, transform or
 *               backdrop-filter can clip or move it; it wears the app and theme it was opened from
 *               (popupScope.ts). It rises with `oa-rise` (a submenu fades) and leaves by opacity; reduced
 *               motion keeps the opacity (styles.css).
 *
 * What goes in it is the caller's: `items`. An editor does not build them by hand but asks its modules
 * (`ContextGroup`s, below), which is how a feature adds a row to a menu without touching a shared file.
 *
 * React events from a portal bubble through the React tree to the component that rendered it, so a press
 * in the menu would reach the canvas or the chart under it. The menu's wrapper stops them.
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../motion/presence';
import { caretRightIcon, checkIcon, Icon, type PhIcon } from './icons';
import { placeAtPoint, placeBeside, type Box, type Placed } from './placement';
import { scopeOf } from './popupScope';
import { createTypeahead, isTypeaheadKey } from './typeahead';
import './popup.css';

// ── what a menu is made of ──────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface ContextItem {
  /** Only needed where two rows share a label. */
  id?: string;
  label: string;
  icon?: PhIcon;
  /** As the row shows it: `Ctrl+C`. */
  shortcut?: string;
  disabled?: boolean;
  /** A tick in the icon's place; makes the row a checkbox for a screen reader. */
  checked?: boolean;
  danger?: boolean;
  /** A rule above this row. */
  separated?: boolean;
  onSelect?: () => void;
  /** Opens beside the row on hover or Right. A row with one runs nothing of its own. */
  submenu?: readonly ContextEntry[];
}

export interface ContextRule {
  separator: true;
}

/** A row of the caller's own making. `close` shuts the menu the way a choice does. */
export interface ContextCustom {
  id: string;
  custom: (api: { close: () => void }) => React.ReactNode;
}

export type ContextEntry = ContextItem | ContextRule | ContextCustom;

const isRule = (e: ContextEntry): e is ContextRule => 'separator' in e;
const isCustom = (e: ContextEntry): e is ContextCustom => 'custom' in e;
const isItem = (e: ContextEntry): e is ContextItem => !isRule(e) && !isCustom(e);

/**
 * The entries a menu draws: `separated` turned into a rule, a rule never first, last or doubled, and
 * a row whose submenu came out empty left out (nothing to open).
 */
export function tidy(entries: readonly ContextEntry[]): ContextEntry[] {
  const out: ContextEntry[] = [];
  const rule = () => {
    const last = out[out.length - 1];
    if (last && !isRule(last)) out.push({ separator: true });
  };
  for (const e of entries) {
    if (isRule(e)) {
      rule();
      continue;
    }
    if (isItem(e)) {
      if (e.submenu && tidy(e.submenu).filter((x) => !isRule(x)).length === 0) continue;
      if (e.separated) rule();
    }
    out.push(e);
  }
  while (out.length && isRule(out[out.length - 1]!)) out.pop();
  return out;
}

/** A run of rows a module adds to a menu, placed among the others by `order`, as a ribbon group is. */
export interface ContextGroup {
  /** Unique within the menu: `cells.clipboard`. */
  id: string;
  /** Lower is higher in the menu. Core uses round numbers so a module can slot in between. */
  order: number;
  items: readonly ContextEntry[];
}

/** What a module offers for a target: `contextItems(target, ctx)`. Empty when it has nothing to add. */
export type ContextHook<T, C> = (target: T, ctx: C) => readonly ContextGroup[];

/** The groups of every module in `order` (ties keep module order), a rule between one and the next. */
export function joinGroups(groups: readonly ContextGroup[]): ContextEntry[] {
  const sorted = groups.map((g, i) => ({ g, i })).sort((a, b) => a.g.order - b.g.order || a.i - b.i);
  const out: ContextEntry[] = [];
  for (const { g } of sorted) {
    const items = tidy(g.items);
    if (!items.length) continue;
    if (out.length) out.push({ separator: true });
    out.push(...items);
  }
  return out;
}

export function duplicateGroupIds(groups: readonly ContextGroup[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const g of groups) (seen.has(g.id) ? dup : seen).add(g.id);
  return [...dup];
}

// ── the menu ────────────────────────────────────────────────────────────────

type CloseReason = 'select' | 'escape' | 'outside' | 'away';

interface MenuApi {
  state: 'open' | 'closed';
  close: (reason: CloseReason) => void;
  choose: (item: ContextItem) => void;
}

const MenuContext = createContext<MenuApi | null>(null);

/** The pointer must not be taken for having left while it crosses to a submenu. */
const LEAVE_MS = 140;

type Anchor = { kind: 'point'; at: Point } | { kind: 'row'; rect: Box };

interface PanelProps {
  entries: readonly ContextEntry[];
  label: string;
  depth: number;
  anchor: Anchor;
  /** Take the keyboard on opening: the first row. */
  focusFirst: boolean;
  /** A submenu closes itself: Left, Escape. */
  onBack?: () => void;
  /** The pointer is over this panel, so the parent must not close it. */
  onEnter?: () => void;
}

function Panel({ entries, label, depth, anchor, focusFirst, onBack, onEnter }: PanelProps) {
  const menu = useContext(MenuContext)!;
  const el = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<number, HTMLButtonElement>());
  const [pos, setPos] = useState<Placed | null>(null);
  const [sub, setSub] = useState<{ index: number; rect: Box; focus: boolean } | null>(null);
  const typeahead = useRef(createTypeahead());
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(leaving.current), []);

  // Placed once its size is known: hidden off-screen for the first frame.
  useLayoutEffect(() => {
    const p = el.current;
    if (!p) return;
    const size = { w: p.offsetWidth, h: p.scrollHeight };
    const vp = { width: window.innerWidth, height: window.innerHeight };
    setPos(anchor.kind === 'point' ? placeAtPoint(anchor.at, size, vp) : placeBeside(anchor.rect, size, vp));
  }, [anchor, entries.length]);

  const focusable = (): HTMLButtonElement[] => [...el.current!.children].filter((c): c is HTMLButtonElement => c.matches('button[data-row]:not(:disabled)'));

  useEffect(() => {
    if (focusFirst) focusable()[0]?.focus();
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSub = (index: number, row: HTMLElement, focus: boolean) => {
    clearTimeout(leaving.current);
    setSub((s) => (s && s.index === index && !focus ? s : { index, rect: row.getBoundingClientRect(), focus }));
  };

  const closeSub = (refocus: boolean) => {
    const at = sub?.index;
    setSub(null);
    if (refocus && at !== undefined) rows.current.get(at)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = focusable();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (to: number) => {
      const target = items[((to % items.length) + items.length) % items.length];
      if (!target) return;
      e.preventDefault();
      setSub(null);
      target.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        go(at + 1);
        break;
      case 'ArrowUp':
        go(at < 0 ? items.length - 1 : at - 1);
        break;
      case 'Tab':
        // The keyboard stays in the menu.
        go(e.shiftKey ? (at < 0 ? items.length - 1 : at - 1) : at + 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(items.length - 1);
        break;
      case 'ArrowRight': {
        const row = document.activeElement as HTMLElement | null;
        const index = row?.dataset.row === undefined ? -1 : Number(row.dataset.row);
        const entry = entries[index];
        if (row && entry && isItem(entry) && entry.submenu && !entry.disabled) {
          e.preventDefault();
          e.stopPropagation();
          openSub(index, row, true);
        }
        break;
      }
      case 'ArrowLeft':
        if (onBack) {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (onBack) onBack();
        else menu.close('escape');
        break;
      default:
        if (isTypeaheadKey(e)) {
          const labels = items.map((b) => b.textContent ?? '');
          const to = typeahead.current.type(e.key, labels, at);
          if (to >= 0) {
            e.preventDefault();
            items[to]?.focus();
          }
        }
    }
  };

  const children: React.ReactNode[] = [];
  entries.forEach((entry, i) => {
    if (isRule(entry)) {
      children.push(<div key={`rule${i}`} role="separator" className="oa-menu-rule" />);
      return;
    }
    if (isCustom(entry)) {
      children.push(
        <div key={entry.id} className="oa-ctx-custom">
          {entry.custom({ close: () => menu.close('select') })}
        </div>
      );
      return;
    }
    const open = sub?.index === i;
    const hasSub = entry.submenu !== undefined;
    const checkable = entry.checked !== undefined;
    children.push(
      <button
        key={entry.id ?? entry.label}
        ref={(b) => {
          if (b) rows.current.set(i, b);
          else rows.current.delete(i);
        }}
        type="button"
        role={checkable ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={checkable ? entry.checked : undefined}
        aria-haspopup={hasSub ? 'menu' : undefined}
        aria-expanded={hasSub ? open : undefined}
        data-row={i}
        data-tone={entry.danger ? 'danger' : undefined}
        data-checked={entry.checked ? 'true' : undefined}
        disabled={entry.disabled}
        tabIndex={-1}
        className="oa-menu-item"
        onClick={(e) => {
          if (hasSub) openSub(i, e.currentTarget, true);
          else menu.choose(entry);
        }}
        onPointerEnter={(e) => {
          clearTimeout(leaving.current);
          if (hasSub && !entry.disabled) openSub(i, e.currentTarget, false);
          else if (sub) leaving.current = setTimeout(() => setSub(null), LEAVE_MS);
        }}
      >
        {entry.checked && !entry.icon ? <Icon icon={checkIcon} size={16} className="oa-menu-check" /> : entry.icon ? <Icon icon={entry.icon} size={16} /> : <span className="oa-menu-gap" />}
        <span className="oa-menu-label">{entry.label}</span>
        {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
        {hasSub && <Icon icon={caretRightIcon} size={12} className="oa-menu-sub" />}
      </button>
    );
  });

  const subEntry = sub ? entries[sub.index] : undefined;
  return (
    <>
      <div
        ref={el}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        data-state={menu.state}
        data-depth={depth}
        className={depth === 0 ? 'oa-pop-panel oa-ctx oa-rise' : 'oa-pop-panel oa-ctx oa-fade'}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight, ...(pos ? {} : { visibility: 'hidden' as const }) }}
        onKeyDown={onKeyDown}
        onPointerEnter={() => onEnter?.()}
      >
        {children}
      </div>
      {sub && subEntry && isItem(subEntry) && subEntry.submenu && (
        <Panel
          key={sub.index}
          entries={tidy(subEntry.submenu)}
          label={subEntry.label}
          depth={depth + 1}
          anchor={{ kind: 'row', rect: sub.rect }}
          focusFirst={sub.focus}
          onBack={() => closeSub(true)}
          onEnter={() => clearTimeout(leaving.current)}
        />
      )}
    </>
  );
}

export interface ContextMenuProps {
  /** Where it opens, in window pixels. Null is closed; it is kept on screen for the length of its exit. */
  at: Point | null;
  items: readonly ContextEntry[];
  /** The menu's accessible name: "Cells", "Shape". */
  label: string;
  /** Called when it should go, for any reason. */
  onClose: () => void;
  /** The element it came from, whose app colour and theme it wears. Without one, the editor's shell's. */
  from?: Element | null;
  /** Where the keyboard goes when a choice or Escape closes it. Without it, to where it was. */
  returnFocus?: () => void;
}

export function ContextMenu(props: ContextMenuProps) {
  const open = props.at !== null;
  const { present, state } = usePresence(open);
  const kept = useRef<{ at: Point; items: readonly ContextEntry[]; label: string; from: Element | null } | null>(null);
  const previous = useRef<Element | null>(null);
  const opened = useRef(0);
  if (props.at && props.at !== kept.current?.at) {
    // A menu opened again is a new menu, even while the last is still leaving: it takes the keyboard afresh.
    opened.current += 1;
    // Where the keyboard is as it opens; the press that asked for the menu has already put it there.
    const now = document.activeElement;
    if (!(now instanceof Element && now.closest('.oa-ctx-root'))) previous.current = now;
  }
  if (props.at) kept.current = { at: props.at, items: props.items, label: props.label, from: props.from ?? null };
  if (!present || !kept.current) return null;
  return <MenuRoot key={opened.current} {...kept.current} state={state} previous={previous} onClose={props.onClose} returnFocus={props.returnFocus} />;
}

function MenuRoot({
  at,
  items,
  label,
  from,
  state,
  previous,
  onClose,
  returnFocus
}: {
  at: Point;
  items: readonly ContextEntry[];
  label: string;
  from: Element | null;
  state: 'open' | 'closed';
  previous: React.RefObject<Element | null>;
  onClose: () => void;
  returnFocus: (() => void) | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, returnFocus });
  latest.current = { onClose, returnFocus };

  const close = useCallback((reason: CloseReason) => {
    if (reason === 'select' || reason === 'escape') {
      const { returnFocus: back } = latest.current;
      if (back) back();
      else if (previous.current instanceof HTMLElement && previous.current.isConnected) previous.current.focus({ preventScroll: true });
    }
    latest.current.onClose();
  }, []);

  const api = useMemo<MenuApi>(
    () => ({
      state,
      close,
      choose: (item) => {
        if (item.disabled) return;
        close('select');
        item.onSelect?.();
      }
    }),
    [state, close]
  );

  useEffect(() => {
    if (state !== 'open') return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close('outside');
    };
    // Escape with the keyboard somewhere else (a press took it away): the menu still goes.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || root.current?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      close('escape');
    };
    // A scroll anywhere but in the menu itself, which may be long, closes it.
    const away = (e: Event) => {
      if (e.type === 'wheel' && root.current?.contains(e.target as Node)) return;
      close('away');
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('wheel', away, { passive: true });
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('wheel', away);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, [state, close]);

  const anchor = useMemo<Anchor>(() => ({ kind: 'point', at: { x: at.x, y: at.y } }), [at]);
  const scope = useMemo(() => scopeOf(from), [from, at]);
  const entries = tidy(items);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <MenuContext.Provider value={api}>
      <div
        ref={root}
        className="oa-ctx-root"
        {...scope}
        // Events from a portal bubble to whatever rendered it: a press here must not start a drag there.
        onPointerDown={stop}
        onPointerUp={stop}
        onMouseDown={stop}
        onMouseUp={stop}
        onClick={stop}
        onDoubleClick={stop}
        onKeyDown={stop}
        onKeyUp={stop}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Panel entries={entries} label={label} depth={0} anchor={anchor} focusFirst />
      </div>
    </MenuContext.Provider>,
    document.body
  );
}
