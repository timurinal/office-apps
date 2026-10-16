/**
 * The sheet tabs, for the footer: the board's 40px glass bar's left half. Previous and next
 * arrows, a tab for each visible sheet with the active one in the app colour, and a plus.
 *
 * It is a pure view with callbacks. Nothing here knows the model: a rename, a delete or a
 * reorder is a request, and the list it shows is whatever `sheets` says. Three things are
 * optimistic so that they answer in the frame they are asked in: a renamed tab shows its new
 * name, a dropped tab keeps its new place, and a new tab appears; each gives way to the
 * list the model sends back.
 *
 * Reordering is a drag. The others make room with FLIP (transform only); the one under the
 * pointer follows it and is never animated until it is let go, when it settles into its slot.
 *
 * The keyboard has all of it: arrow keys move between tabs and choose, F2 renames, and the
 * menu key or Shift+F10 opens what a right click does.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useIndicator } from '../../core/controls';
import {
  caretLeftIcon,
  caretRightIcon,
  copyIcon,
  eyeIcon,
  eyeSlashIcon,
  Icon,
  pencilSimpleIcon,
  plusIcon,
  trashIcon
} from '../../core/icons';
import { ContextMenu, type ContextEntry, type Point } from '../../core/ContextMenu';
import { animate, DUR, EASE } from '../../motion';
import { useFlipList } from '../../motion/flip';
import './grid.css';

export interface SheetTab {
  id: string;
  name: string;
  /** A CSS colour for the tab's underline. */
  color?: string | null;
  hidden?: boolean;
}

export interface SheetTabsProps {
  sheets: readonly SheetTab[];
  /** The id of the sheet that is showing. */
  active: string;
  /** Every change to the list of sheets is refused. Choosing a tab is not one. */
  readOnly?: boolean;
  onSelect(id: string): void;
  onAdd(): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  /** null for no colour. */
  onColor(id: string, color: string | null): void;
  onHide(id: string): void;
  onUnhide(id: string): void;
  /** `to` is the sheet's index in `sheets` (hidden ones counted) once it has moved. */
  onReorder(id: string, to: number): void;
}

export const TAB_COLORS = ['#d64545', '#e8833a', '#e3b23c', '#43a873', '#0fb3a8', '#3d6cd0', '#796cbf', '#886193', '#75798c'] as const;

/** Excel's limit, and the one a workbook has to meet to be exported. */
export const SHEET_NAME_MAX = 31;

/**
 * Where a sheet lands in the full list when it has been dragged into a place among the visible
 * ones: before the visible sheet that now follows it, or after the last visible one. Hidden
 * sheets stay where they were relative to the rest.
 */
export function reorderTo(all: readonly string[], moved: string, visibleOrder: readonly string[]): number {
  const rest = all.filter((id) => id !== moved);
  const at = visibleOrder.indexOf(moved);
  const after = visibleOrder[at + 1];
  if (after !== undefined) return rest.indexOf(after);
  const before = visibleOrder[at - 1];
  return before === undefined ? rest.length : rest.indexOf(before) + 1;
}

/** `items` with the ones that just left kept for a moment, flagged, so they can fade. */
function useLeavers<T extends { id: string }>(items: readonly T[], ms: number): { item: T; leaving: boolean }[] {
  const previous = useRef(items);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [ghosts, setGhosts] = useState<{ item: T; index: number }[]>([]);

  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = items;
    const ids = new Set(items.map((i) => i.id));
    const left = was.map((item, index) => ({ item, index })).filter((p) => !ids.has(p.item.id));
    if (left.length === 0) return;
    setGhosts((g) => [...g.filter((x) => ids.has(x.item.id) === false), ...left]);
    const t = setTimeout(() => {
      timers.current.delete(t);
      setGhosts((g) => g.filter((x) => !left.some((l) => l.item.id === x.item.id)));
    }, ms);
    timers.current.add(t);
  }, [items, ms]);

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  const out = items.map((item) => ({ item, leaving: false }));
  for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
    if (!items.some((i) => i.id === g.item.id)) out.splice(Math.min(g.index, out.length), 0, { item: g.item, leaving: true });
  }
  return out;
}

interface DragState {
  id: string;
  pointer: number;
  startX: number;
  /** The pointer's distance from the tab's left edge when it was pressed. */
  grab: number;
  started: boolean;
  from: string[];
}

export function SheetTabs(props: SheetTabsProps) {
  const { sheets, active, readOnly = false } = props;
  const [order, setOrder] = useState<string[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: Point; from: Element } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);
  const list = useRef<HTMLDivElement | null>(null);
  const tabEls = useRef(new Map<string, HTMLElement>());

  // The model's list replaces whatever was assumed: when it says something different, and if it
  // never does (the change was refused) after a second, so a refusal does not leave a lie on screen.
  const signature = sheets.map((s) => `${s.id}\u0001${s.name}\u0001${s.color ?? ''}\u0001${s.hidden ? 1 : 0}`).join('\u0002');
  useEffect(() => {
    setOrder(null);
    setNames({});
  }, [signature]);
  const assumed = useCallback((clear: () => void) => {
    const t = setTimeout(clear, 1000);
    timers.current.add(t);
  }, []);

  const visibleNow = useMemo(() => {
    const v = sheets.filter((s) => !s.hidden).map((s) => (names[s.id] === undefined ? s : { ...s, name: names[s.id]! }));
    if (!order) return v;
    const at = (id: string) => {
      const i = order.indexOf(id);
      return i < 0 ? Infinity : i;
    };
    return [...v].sort((a, b) => at(a.id) - at(b.id));
  }, [sheets, order, names]);

  const hidden = sheets.filter((s) => s.hidden);
  const rows = useLeavers(visibleNow, DUR.fast);

  // Tabs that were not there on the first look rise in, and keep the class until they have.
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    const was = known.current;
    known.current = new Set(visibleNow.map((s) => s.id));
    if (!was) return;
    const added = visibleNow.filter((s) => !was.has(s.id)).map((s) => s.id);
    if (added.length === 0) return;
    setFresh((f) => new Set([...f, ...added]));
    const t = setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !added.includes(id)))), DUR.base + 60);
    timers.current.add(t);
  }, [visibleNow]);

  const indicator = useIndicator<HTMLDivElement>(active, 'x', [visibleNow.map((s) => s.name).join('\u0000'), renaming]);
  const flip = useFlipList(
    rows.map((r) => r.item.id),
    { duration: DUR.base }
  );
  const setList = useCallback(
    (el: HTMLDivElement | null) => {
      list.current = el;
      indicator.current = el;
      flip.container.current = el;
    },
    [indicator, flip.container]
  );

  // Keep the active tab in view when there are more than fit.
  useEffect(() => {
    const el = tabEls.current.get(active);
    const box = list.current;
    if (!el || !box) return;
    if (el.offsetLeft < box.scrollLeft) box.scrollLeft = el.offsetLeft - 8;
    else if (el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = el.offsetLeft + el.offsetWidth - box.clientWidth + 8;
  }, [active, visibleNow.length]);

  const ids = visibleNow.map((s) => s.id);
  const at = ids.indexOf(active);
  const choose = (id: string | undefined) => {
    if (!id || id === active) return;
    setMenu(null);
    props.onSelect(id);
  };

  const beginRename = (id: string) => {
    if (readOnly) return;
    setMenu(null);
    setRenaming(id);
  };

  const finishRename = (id: string, value: string, commit: boolean) => {
    setRenaming(null);
    const name = value.trim().slice(0, SHEET_NAME_MAX);
    const current = sheets.find((s) => s.id === id)?.name;
    if (!commit || name === '' || name === current) return;
    setNames((n) => ({ ...n, [id]: name }));
    assumed(() => setNames((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== id))));
    props.onRename(id, name);
  };

  // ── dragging a tab to a new place ─────────────────────────────────────────

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (readOnly || e.button !== 0 || visibleNow.length < 2 || renaming) return;
    setMenu(null);
    const el = tabEls.current.get(id);
    if (!el) return;
    drag.current = { id, pointer: e.clientX, startX: e.clientX, grab: e.clientX - el.getBoundingClientRect().left, started: false, from: ids };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const box = list.current;
    if (!d || !box) return;
    d.pointer = e.clientX;
    if (!d.started) {
      if (Math.abs(e.clientX - d.startX) < 4) return;
      d.started = true;
      setDragging(d.id);
    }
    const el = tabEls.current.get(d.id);
    if (!el) return;
    // The slot the tab is over: how many of the others its centre has passed.
    const center = e.clientX - d.grab - box.getBoundingClientRect().left + box.scrollLeft + el.offsetWidth / 2;
    const others = (order ?? ids).filter((x) => x !== d.id);
    const passed = others.filter((x) => {
      const o = tabEls.current.get(x);
      return o ? o.offsetLeft + o.offsetWidth / 2 < center : false;
    }).length;
    const next = [...others.slice(0, passed), d.id, ...others.slice(passed)];
    if (next.join() !== (order ?? ids).join()) setOrder(next);
    follow(el, d);
  };

  /** Hold the tab under the pointer, wherever its slot has moved to. */
  const follow = (el: HTMLElement, d: DragState) => {
    const box = list.current!;
    const x = d.pointer - d.grab - box.getBoundingClientRect().left + box.scrollLeft;
    el.style.transform = `translateX(${x - el.offsetLeft}px)`;
  };

  // A reorder moved the slot; the tab under the pointer has to be put back under it.
  useLayoutEffect(() => {
    const d = drag.current;
    const el = d && tabEls.current.get(d.id);
    if (d?.started && el) follow(el, d);
  });

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
    if (!d.started) return;
    setDragging(null);
    const el = tabEls.current.get(d.id);
    const final = order ?? ids;
    if (el) {
      const was = el.style.transform;
      el.style.transform = '';
      if (was) animate(el, [{ transform: was }, { transform: 'none' }], { duration: DUR.base, easing: EASE.out, fill: 'none' });
    }
    if (final.join() !== d.from.join()) {
      setOrder(final);
      assumed(() => setOrder(null));
      props.onReorder(
        d.id,
        reorderTo(
          sheets.map((s) => s.id),
          d.id,
          final
        )
      );
    }
    // The click that follows a drag is not a choice.
    suppress.current = true;
    setTimeout(() => (suppress.current = false), 0);
  };
  const suppress = useRef(false);

  // ── the menu ──────────────────────────────────────────────────────────────

  /** From the pointer where a right click was, else from the tab's own top left corner (the menu key). */
  const openMenu = (id: string, at?: Point) => {
    if (readOnly) return;
    const el = tabEls.current.get(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenu({ id, at: at ?? { x: r.left, y: r.top }, from: el });
  };

  const target = menu ? sheets.find((s) => s.id === menu.id) : undefined;
  const closeMenu = useCallback(() => setMenu(null), []);
  const entries: ContextEntry[] = target
    ? [
        { label: 'Rename', icon: pencilSimpleIcon, shortcut: 'F2', onSelect: () => beginRename(target.id) },
        { label: 'Duplicate', icon: copyIcon, onSelect: () => props.onDuplicate(target.id) },
        { separator: true },
        {
          id: 'colour',
          custom: ({ close }) => (
            <div className="sg-swatches" role="radiogroup" aria-label="Tab colour">
              <button
                type="button"
                role="radio"
                aria-checked={!target.color}
                aria-label="No colour"
                data-none="true"
                className="sg-swatch"
                onClick={() => {
                  props.onColor(target.id, null);
                  close();
                }}
              />
              {TAB_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={target.color === c}
                  aria-label={c}
                  className="sg-swatch"
                  style={{ ['--swatch' as string]: c } as React.CSSProperties}
                  onClick={() => {
                    props.onColor(target.id, c);
                    close();
                  }}
                />
              ))}
            </div>
          )
        },
        { separator: true },
        { label: 'Hide', icon: eyeSlashIcon, disabled: visibleNow.length < 2, onSelect: () => props.onHide(target.id) },
        { label: 'Delete', icon: trashIcon, danger: true, disabled: sheets.length < 2, onSelect: () => props.onDelete(target.id) },
        ...hidden.map((s, i): ContextEntry => ({ label: `Show ${s.name}`, icon: eyeIcon, separated: i === 0, onSelect: () => props.onUnhide(s.id) }))
      ]
    : [];

  const onTabKeys = (e: React.KeyboardEvent<HTMLElement>, id: string) => {
    if (renaming) return;
    const goTo = (to: string | undefined) => {
      if (!to) return;
      e.preventDefault();
      choose(to);
      requestAnimationFrame(() => tabEls.current.get(to)?.focus());
    };
    if (e.key === 'ArrowRight') goTo(ids[ids.indexOf(id) + 1]);
    else if (e.key === 'ArrowLeft') goTo(ids[ids.indexOf(id) - 1]);
    else if (e.key === 'Home') goTo(ids[0]);
    else if (e.key === 'End') goTo(ids[ids.length - 1]);
    else if (e.key === 'F2') {
      e.preventDefault();
      beginRename(id);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      openMenu(id);
    }
  };

  const activeColor = sheets.find((s) => s.id === active)?.color;

  return (
    <div className="sg-tabs">
      <span className="sg-tabs-nav">
        <button type="button" className="sg-tabnav" aria-label="Previous sheet" disabled={at <= 0} onClick={() => choose(ids[at - 1])}>
          <Icon icon={caretLeftIcon} size={13} />
        </button>
        <button type="button" className="sg-tabnav" aria-label="Next sheet" disabled={at < 0 || at >= ids.length - 1} onClick={() => choose(ids[at + 1])}>
          <Icon icon={caretRightIcon} size={13} />
        </button>
      </span>
      <div
        ref={setList}
        role="tablist"
        aria-label="Sheets"
        className="sg-tablist"
        style={activeColor ? ({ ['--ind-color' as string]: activeColor } as React.CSSProperties) : undefined}
      >
        {rows.map(({ item: s, leaving }) => {
          const on = s.id === active;
          if (renaming === s.id) {
            return (
              <input
                key={s.id}
                data-key={s.id}
                className="sg-tabname"
                aria-label="Sheet name"
                maxLength={SHEET_NAME_MAX}
                defaultValue={s.name}
                style={{ width: `${Math.max(s.name.length, 6) + 4}ch` }}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => finishRename(s.id, e.currentTarget.value, true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename(s.id, e.currentTarget.value, true);
                  else if (e.key === 'Escape') {
                    e.stopPropagation();
                    finishRename(s.id, '', false);
                  } else return;
                  e.preventDefault();
                  requestAnimationFrame(() => tabEls.current.get(s.id)?.focus());
                }}
              />
            );
          }
          return (
            <button
              key={s.id}
              ref={(el) => {
                if (el) tabEls.current.set(s.id, el);
                else tabEls.current.delete(s.id);
                // A tab under the pointer is not part of the FLIP list.
                if (dragging !== s.id) flip.item(s.id)(el);
                else flip.item(s.id)(null);
              }}
              type="button"
              role="tab"
              data-key={s.id}
              data-colored={s.color ? 'true' : undefined}
              data-dragging={dragging === s.id ? 'true' : undefined}
              data-state={leaving ? 'closed' : undefined}
              className={leaving ? 'sg-tab oa-fade' : fresh.has(s.id) ? 'sg-tab oa-rise' : 'sg-tab'}
              style={s.color ? ({ ['--tab-color' as string]: s.color } as React.CSSProperties) : undefined}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => !suppress.current && choose(s.id)}
              onDoubleClick={() => beginRename(s.id)}
              onContextMenu={(e) => {
                // Shift asks for the browser's own menu.
                if (readOnly || e.shiftKey) return;
                e.preventDefault();
                choose(s.id);
                openMenu(s.id, { x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => onTabKeys(e, s.id)}
              onPointerDown={(e) => onPointerDown(e, s.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {s.name}
            </button>
          );
        })}
        <span className="oa-ind oa-ind-x" aria-hidden="true" />
      </div>
      <button type="button" className="sg-tabadd" aria-label="New sheet" disabled={readOnly} onClick={() => props.onAdd()}>
        <Icon icon={plusIcon} size={16} />
      </button>
      <ContextMenu
        at={menu && target ? menu.at : null}
        items={entries}
        label="Sheet"
        from={menu?.from ?? null}
        onClose={closeMenu}
        returnFocus={() => {
          if (menu) tabEls.current.get(menu.id)?.focus();
        }}
      />
    </div>
  );
}
