/**
 * A right click on the slide: Format shape, and what is done to what was clicked.
 *
 * The canvas has no menu of its own, so this layer hears the browser's `contextmenu` on the desk and
 * answers where an element is under the pointer (the canvas's own hit test): it chooses it, if it was
 * not among what is chosen, and opens the menu at the pointer. A click on the background is left to
 * the browser. A reader has no menu. Over a table the menu also has the table's rows, columns,
 * merge and split, acting on the cell that was clicked.
 *
 * The menu is in a portal, fixed to the window (the desk clips anything wider than the slide), and
 * wears the app's colours itself. It closes on Escape, on a press outside it, on a scroll and when it
 * has run an item; the keyboard moves through it with the arrow keys.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clipboardTextIcon, copyIcon, pencilSimpleIcon, trashIcon } from '../../../core/icons';
import { mod } from '../../../core/keys';
import { usePresence } from '../../../motion/presence';
import { MenuList, useDismiss, type MenuItem } from '../../../core/ui';
import { deleteElements, duplicate } from '../../editor/actions';
import { hitTest } from '../../editor/geometry';
import { ARRANGE_ROWS } from '../../modules/arrange';
import { copyChosen, pasteChosen } from '../../modules/core';
import { scissorsIcon } from '../../modules/icons';
import { cellAtPoint, measureCells } from '../../modules/insert/cellGeometry';
import { arrowsMergeIcon, arrowsSplitIcon, columnsIcon, columnsPlusLeftIcon, columnsPlusRightIcon, rowsIcon, rowsPlusBottomIcon, rowsPlusTopIcon, slidersHorizontalIcon } from '../../modules/insert/icons';
import { addColumn, addRow, mergeable, mergeChosen, removeColumns, removeRows, selectedTable, splittable, splitChosen, type TableHost } from '../../modules/insert/tableActions';
import { chooseCells } from '../../modules/insert/tables';
import type { CanvasFrame, SlidesContext } from '../../modules/types';

/** Screen px around an element that still counts as on it, as the canvas's own. */
const HIT_PX = 4;

/** The rows of the menu for what is chosen now. */
export function contextItems(c: SlidesContext): MenuItem[] {
  const target = { model: c.model, selection: c.selection };
  const sel = c.selection.get();
  const only = sel.slide && sel.els.length === 1 ? c.model.element(sel.slide, sel.els[0]!) : null;
  const host: TableHost = { model: c.model, selection: c.selection, notify: c.notify };
  const items: MenuItem[] = [{ label: 'Format shape', icon: slidersHorizontalIcon, onSelect: () => c.panes.open('format') }];
  if (only?.type === 'shape' && !only.locked) items.push({ label: 'Edit text', icon: pencilSimpleIcon, onSelect: () => c.select.editText(only.id!, 'end') });
  if (c.can.download) {
    items.push({ label: 'Cut', icon: scissorsIcon, shortcut: mod('X'), separated: true, onSelect: () => void copyChosen(c, true) });
    items.push({ label: 'Copy', icon: copyIcon, shortcut: mod('C'), onSelect: () => void copyChosen(c, false) });
  }
  items.push({ label: 'Paste', icon: clipboardTextIcon, shortcut: mod('V'), separated: !c.can.download, onSelect: () => void pasteChosen(c) });
  items.push({ label: 'Duplicate', icon: copyIcon, shortcut: mod('D'), onSelect: () => duplicate(target) });
  items.push({ label: 'Delete', icon: trashIcon, shortcut: 'Del', danger: true, onSelect: () => void deleteElements(target) });
  if (selectedTable(host)) {
    items.push({ label: 'Insert row above', icon: rowsPlusTopIcon, separated: true, onSelect: () => void addRow(host, false) });
    items.push({ label: 'Insert row below', icon: rowsPlusBottomIcon, onSelect: () => void addRow(host, true) });
    items.push({ label: 'Insert column left', icon: columnsPlusLeftIcon, onSelect: () => void addColumn(host, false) });
    items.push({ label: 'Insert column right', icon: columnsPlusRightIcon, onSelect: () => void addColumn(host, true) });
    items.push({ label: 'Delete rows', icon: rowsIcon, onSelect: () => void removeRows(host) });
    items.push({ label: 'Delete columns', icon: columnsIcon, onSelect: () => void removeColumns(host) });
    items.push({ label: 'Merge cells', icon: arrowsMergeIcon, disabled: !mergeable(host), onSelect: () => void mergeChosen(host) });
    items.push({ label: 'Split cell', icon: arrowsSplitIcon, disabled: !splittable(host), onSelect: () => void splitChosen(host) });
  }
  // What the Arrange module does to the chosen objects, below: one menu on a right click, not two.
  const arrange = ARRANGE_ROWS.filter((r) => !r.hide?.(c));
  arrange.forEach((r, i) =>
    items.push({
      label: r.label,
      icon: r.icon,
      ...(r.shortcut ? { shortcut: r.shortcut } : {}),
      disabled: r.off(c),
      separated: i === 0 || arrange[i - 1]!.section !== r.section,
      onSelect: () => void r.run(target)
    })
  );
  return items;
}

function Menu({ c, at, state, onClose }: { c: SlidesContext; at: { x: number; y: number }; state: 'open' | 'closed'; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const items = contextItems(c);
  useDismiss(state === 'open', ref, onClose);

  // Placed once its size is known, kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - el.offsetHeight - 8)) });
  }, [at]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    // A scroll anywhere but in the menu itself, which may be long, closes it.
    const away = (e: Event) => {
      if (e.type === 'wheel' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('wheel', away, { passive: true });
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('wheel', away);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, [onClose]);

  return createPortal(
    <div data-app="slides" data-theme="dark" style={{ display: 'contents' }}>
      <div ref={ref} role="menu" aria-label="Shape" data-state={state} className="oa-popover oa-rise sl-ctx" style={pos ?? { left: -9999, top: -9999, visibility: 'hidden' }}>
        <div style={{ maxHeight: Math.max(240, window.innerHeight - (pos?.top ?? at.y) - 16), overflowY: 'auto' }}>
          <MenuList
            items={items}
            onDone={() => {
              onClose();
              c.actions.focusCanvas();
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ContextMenuLayer({ c, frame }: { c: SlidesContext; frame: CanvasFrame }) {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({ c, frame });
  latest.current = { c, frame };

  useEffect(() => {
    const desk = root.current?.closest('.sl-desk');
    const canvas = root.current?.closest('.sl-canvas');
    if (!desk || !canvas) return;
    const onMenu = (e: Event): void => {
      const ev = e as MouseEvent;
      const { c: ctx, frame: f } = latest.current;
      // A text box being typed in has the browser's own menu: spelling, paste.
      if (!ctx.can.edit || (ev.target instanceof Element && ev.target.closest('[contenteditable="true"]'))) return;
      const base = canvas.getBoundingClientRect();
      const p = { x: (ev.clientX - base.left) / f.scale, y: (ev.clientY - base.top) / f.scale };
      const hit = hitTest(f.slide.elements, p, HIT_PX / f.scale);
      if (!hit) return;
      ev.preventDefault();
      const top = hit.path[0]!;
      if (!ctx.selection.get().els.includes(top)) ctx.select.elements([top]);
      // Over a table, the cell that was clicked is the one the menu acts on.
      const el = f.slide.elements.find((x) => x.id === top);
      if (el?.type === 'table' && ctx.slideId) {
        const cell = cellAtPoint(el, p, measureCells(canvas, top, f.scale));
        if (cell) chooseCells(ctx.model, ctx.slideId, top, cell);
      }
      setAt({ x: ev.clientX, y: ev.clientY });
    };
    desk.addEventListener('contextmenu', onMenu);
    return () => desk.removeEventListener('contextmenu', onMenu);
  }, []);

  const close = useCallback(() => setAt(null), []);
  // The menu is held on screen for the length of its exit, where it was.
  const { present, state } = usePresence(at !== null);
  const last = useRef(at);
  if (at) last.current = at;
  return (
    <div ref={root} hidden>
      {present && last.current && <Menu c={c} at={last.current} state={state} onClose={close} />}
    </div>
  );
}
