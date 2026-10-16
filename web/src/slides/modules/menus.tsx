/**
 * The right-click menus of Slides: over a shape, over the slide's own ground, over a thumbnail in the
 * rail or the sorter. See types.ts, "The right-click menu", for the slots.
 *
 * Two parts. **The rows** (`contextItems`) are what each target offers, as groups placed by `order`; every
 * row calls what the ribbon, the keys and the command box call (`editor/actions.ts`, `arrangeActions.ts`,
 * `insert/tableActions.ts`), so a row here is a label, an icon and a call. **The canvas layer** hears the
 * browser's `contextmenu` on the desk, because the canvas has no menu of its own, and works out what was
 * under the pointer with the canvas's own hit test: a click on an object chooses it (unless it is already
 * among those chosen) and asks for the shape menu; a click on the slide's ground asks for the canvas menu;
 * the grey around the slide is the browser's. The rail and the sorter ask for theirs themselves.
 *
 * The browser's menu stays over text being typed in (spelling and paste are its), and with Shift held.
 * Over a table the menu acts on the cell that was clicked.
 */

import { useEffect, useRef } from 'react';
import type { ContextEntry, ContextGroup } from '../../core/ContextMenu';
import { clipboardTextIcon, copyIcon, eyeIcon, eyeSlashIcon, linkIcon, notePencilIcon, paintBucketIcon, pencilSimpleIcon, plusIcon, trashIcon } from '../../core/icons';
import { mod } from '../../core/keys';
import type { Command } from '../../core/shell/types';
import { chosenHidden, chosenLayout, deleteElements, deleteSlides, duplicate, duplicateSlides, newSlide, setLayout, toggleHidden, type Target } from '../editor/actions';
import { hitTest } from '../editor/geometry';
import { hasText, shapesIn } from '../editor/linkText';
import { emptyText } from '../model/schema';
import { layoutIcon, scissorsIcon } from './icons';
import { ARRANGE_ROWS } from './arrange';
import { copyChosen, pasteChosen } from './core';
import { cellAtPoint, measureCells } from './insert/cellGeometry';
import { arrowsMergeIcon, arrowsSplitIcon, columnsIcon, columnsPlusLeftIcon, columnsPlusRightIcon, rowsIcon, rowsPlusBottomIcon, rowsPlusTopIcon, slidersHorizontalIcon } from './insert/icons';
import { addColumn, addRow, mergeable, mergeChosen, removeColumns, removeRows, selectedTable, splittable, splitChosen, type TableHost } from './insert/tableActions';
import { chooseCells } from './insert/tables';
import { openSlideDialog, SlideDialogs } from './menuDialogs';
import type { CanvasFrame, SlidesContext, SlidesMenuTarget, SlidesModule } from './types';

/** Screen px around an object that still counts as on it, as the canvas's own. */
const HIT_PX = 4;

const target = (c: SlidesContext): Target => ({ model: c.model, selection: c.selection });
const FORMAT_PANE = 'format';

/** "Slide" or "Slides" to say what a thumbnail menu acts on. */
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// ── the rows ────────────────────────────────────────────────────────────────

function layoutRows(c: SlidesContext): ContextEntry[] {
  const now = chosenLayout(target(c));
  return c.design.layouts.map((l): ContextEntry => ({ label: l.name, checked: now === l.id, onSelect: () => void setLayout(target(c), l.id) }));
}

/** Arrange's rows, as the ribbon's Arrange menu lists them, less Group and Ungroup, which are the menu's own. */
function arrangeRows(c: SlidesContext): ContextEntry[] {
  const rows = ARRANGE_ROWS.filter((r) => r.section !== 'group' && !r.hide?.(c));
  return rows.map(
    (r, i): ContextEntry => ({
      label: r.label,
      icon: r.icon,
      ...(r.shortcut ? { shortcut: r.shortcut } : {}),
      disabled: r.off(c),
      separated: i > 0 && rows[i - 1]!.section !== r.section,
      onSelect: () => void r.run(target(c))
    })
  );
}

function shapeMenu(c: SlidesContext, ids: readonly string[]): ContextGroup[] {
  const slide = c.selection.get().slide;
  const els = slide ? ids.map((id) => c.model.element(slide, id)).filter((e) => e !== null) : [];
  const groups: ContextGroup[] = [];
  const clip: ContextEntry[] = [];
  if (c.can.edit && c.can.download) clip.push({ label: 'Cut', icon: scissorsIcon, shortcut: mod('X'), onSelect: () => void copyChosen(c, true) });
  if (c.can.download) clip.push({ label: 'Copy', icon: copyIcon, shortcut: mod('C'), onSelect: () => void copyChosen(c, false) });
  if (c.can.edit) clip.push({ label: 'Paste', icon: clipboardTextIcon, shortcut: mod('V'), onSelect: () => void pasteChosen(c) });
  groups.push({ id: 'menu.clipboard', order: 100, items: clip });
  if (!c.can.edit) return groups;

  const only = els.length === 1 ? els[0]! : null;
  const shapes = shapesIn(els);
  const text: ContextEntry[] = [];
  if (only?.type === 'shape' && !only.locked) text.push({ label: 'Edit text', icon: pencilSimpleIcon, onSelect: () => c.select.editText(only.id!, 'end') });
  if (shapes.some((s) => hasText(s.text ?? emptyText()))) text.push({ label: 'Link…', icon: linkIcon, onSelect: () => openSlideDialog('link') });
  if (els.length) text.push({ label: 'Alt text…', icon: notePencilIcon, onSelect: () => openSlideDialog('alt') });
  groups.push({ id: 'menu.text', order: 200, items: text });

  const arrange: ContextEntry[] = [];
  for (const r of ARRANGE_ROWS.filter((x) => x.section === 'group' && !x.hide?.(c))) {
    arrange.push({ label: r.label, icon: r.icon, ...(r.shortcut ? { shortcut: r.shortcut } : {}), disabled: r.off(c), onSelect: () => void r.run(target(c)) });
  }
  arrange.push({ label: 'Arrange', submenu: arrangeRows(c) });
  groups.push({ id: 'menu.arrange', order: 300, items: arrange });

  groups.push({ id: 'menu.format', order: 400, items: [{ label: 'Format shape…', icon: slidersHorizontalIcon, onSelect: () => c.panes.open(FORMAT_PANE) }] });

  const host: TableHost = { model: c.model, selection: c.selection, notify: c.notify };
  if (selectedTable(host)) {
    groups.push({
      id: 'menu.table',
      order: 450,
      items: [
        { label: 'Insert row above', icon: rowsPlusTopIcon, onSelect: () => void addRow(host, false) },
        { label: 'Insert row below', icon: rowsPlusBottomIcon, onSelect: () => void addRow(host, true) },
        { label: 'Insert column left', icon: columnsPlusLeftIcon, onSelect: () => void addColumn(host, false) },
        { label: 'Insert column right', icon: columnsPlusRightIcon, onSelect: () => void addColumn(host, true) },
        { label: 'Delete rows', icon: rowsIcon, onSelect: () => void removeRows(host) },
        { label: 'Delete columns', icon: columnsIcon, onSelect: () => void removeColumns(host) },
        { label: 'Merge cells', icon: arrowsMergeIcon, separated: true, disabled: !mergeable(host), onSelect: () => void mergeChosen(host) },
        { label: 'Split cell', icon: arrowsSplitIcon, disabled: !splittable(host), onSelect: () => void splitChosen(host) }
      ]
    });
  }
  groups.push({
    id: 'menu.object',
    order: 500,
    items: [
      { label: 'Duplicate', icon: copyIcon, shortcut: mod('D'), onSelect: () => duplicate(target(c)) },
      { label: 'Delete', icon: trashIcon, shortcut: 'Del', danger: true, onSelect: () => void deleteElements(target(c)) }
    ]
  });
  return groups;
}

function canvasMenu(c: SlidesContext): ContextGroup[] {
  if (!c.can.edit) return [];
  return [
    { id: 'menu.clipboard', order: 100, items: [{ label: 'Paste', icon: clipboardTextIcon, shortcut: mod('V'), onSelect: () => void pasteChosen(c) }] },
    {
      id: 'menu.slide',
      order: 200,
      items: [
        { label: 'Layout', icon: layoutIcon, submenu: layoutRows(c) },
        { label: 'Format background…', icon: paintBucketIcon, onSelect: () => openSlideDialog('background') }
      ]
    }
  ];
}

function slidesMenu(c: SlidesContext, ids: readonly string[]): ContextGroup[] {
  if (!c.can.edit) return [];
  const t = target(c);
  const n = ids.length;
  const hidden = chosenHidden(t);
  return [
    { id: 'menu.new', order: 100, items: [{ label: 'New slide', icon: plusIcon, onSelect: () => void newSlide(t) }] },
    {
      id: 'menu.edit',
      order: 200,
      items: [
        { label: plural(n, 'Duplicate slide', 'Duplicate slides'), icon: copyIcon, onSelect: () => void duplicateSlides(t) },
        { label: plural(n, 'Delete slide', 'Delete slides'), icon: trashIcon, danger: true, disabled: n >= c.model.order().length, onSelect: () => void deleteSlides(t) }
      ]
    },
    {
      id: 'menu.slide',
      order: 300,
      items: [
        { label: hidden ? plural(n, 'Show slide', 'Show slides') : plural(n, 'Hide slide', 'Hide slides'), icon: hidden ? eyeIcon : eyeSlashIcon, onSelect: () => void toggleHidden(t) },
        { label: 'Layout', icon: layoutIcon, submenu: layoutRows(c) }
      ]
    }
  ];
}

export function contextItems(t: SlidesMenuTarget, c: SlidesContext): ContextGroup[] {
  switch (t.kind) {
    case 'shape':
      return shapeMenu(c, t.ids);
    case 'canvas':
      return canvasMenu(c);
    case 'slides':
      return slidesMenu(c, t.ids);
  }
}

// ── the canvas ──────────────────────────────────────────────────────────────

/** Hears the browser's `contextmenu` on the desk and asks for the menu for what is under the pointer. */
export function CanvasMenuLayer({ c, frame }: { c: SlidesContext; frame: CanvasFrame }) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef({ c, frame });
  latest.current = { c, frame };

  useEffect(() => {
    const desk = root.current?.closest('.sl-desk');
    const canvas = root.current?.closest('.sl-canvas');
    if (!desk || !canvas) return;
    const onMenu = (e: Event): void => {
      const ev = e as MouseEvent;
      // A text box being typed in has the browser's own menu (spelling, paste), and Shift asks for it.
      if (ev.shiftKey || (ev.target instanceof Element && ev.target.closest('[contenteditable="true"]'))) return;
      const { c: ctx, frame: f } = latest.current;
      const base = canvas.getBoundingClientRect();
      const p = { x: (ev.clientX - base.left) / f.scale, y: (ev.clientY - base.top) / f.scale };
      const at = { x: ev.clientX, y: ev.clientY };
      const hit = hitTest(f.slide.elements, p, HIT_PX / f.scale);
      if (!hit) {
        // The slide's own ground; the grey around it is the browser's.
        if (p.x < 0 || p.y < 0 || p.x > f.width || p.y > f.height) return;
        if (ctx.contextMenu({ kind: 'canvas' }, at, canvas)) ev.preventDefault();
        return;
      }
      const top = hit.path[0]!;
      if (!ctx.selection.get().els.includes(top)) ctx.select.elements([top]);
      // Over a table, the cell that was clicked is the one the menu acts on.
      const el = f.slide.elements.find((x) => x.id === top);
      if (el?.type === 'table' && ctx.slideId) {
        const cell = cellAtPoint(el, p, measureCells(canvas, top, f.scale));
        if (cell) chooseCells(ctx.model, ctx.slideId, top, cell);
      }
      if (ctx.contextMenu({ kind: 'shape', ids: ctx.selection.get().els }, at, canvas)) ev.preventDefault();
    };
    desk.addEventListener('contextmenu', onMenu);
    return () => desk.removeEventListener('contextmenu', onMenu);
  }, []);

  return <div ref={root} hidden />;
}

// ── the command box ─────────────────────────────────────────────────────────

const hasShapeText = (c: SlidesContext): boolean => {
  const slide = c.selection.get().slide;
  if (!slide) return false;
  return shapesIn(c.selection.get().els.map((id) => c.model.element(slide, id))).some((s) => hasText(s.text ?? emptyText()));
};

const commands: Command<SlidesContext>[] = [
  { id: 'format.link', title: 'Link', section: 'Insert', icon: linkIcon, keywords: ['hyperlink', 'address', 'url'], visible: (c) => c.can.edit, disabled: (c) => !hasShapeText(c), run: () => openSlideDialog('link') },
  { id: 'format.alt-text', title: 'Alt text', section: 'Format', icon: notePencilIcon, keywords: ['accessibility', 'description', 'screen reader'], visible: (c) => c.can.edit, disabled: (c) => c.selection.get().els.length === 0, run: () => openSlideDialog('alt') },
  { id: 'format.background', title: 'Format background', section: 'Format', icon: paintBucketIcon, keywords: ['colour', 'gradient', 'picture', 'design'], visible: (c) => c.can.edit && !!c.slideId, run: () => openSlideDialog('background') }
];

export const menusModule: SlidesModule = {
  id: 'menus',
  ribbon: [],
  commands,
  contextItems,
  canvas: [{ id: 'menus.canvas', render: (c, frame) => <CanvasMenuLayer c={c} frame={frame} /> }],
  overlays: [{ id: 'menus.dialogs', render: (c) => <SlideDialogs ctx={c} /> }]
};
