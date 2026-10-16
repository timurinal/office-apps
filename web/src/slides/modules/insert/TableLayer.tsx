/**
 * A table's cells on the canvas: click one to type in it, Tab to the next, and see which cells are
 * chosen for a merge.
 *
 * The canvas edits the text of a shape and knows nothing of a table's cells, so this layer does, the
 * way the canvas does for a shape: a Tiptap editor bound to the cell's own Yjs fragment, made when the
 * cell is entered and destroyed when it is left, drawn over the cell in the slide's coordinates with
 * the cascade the renderer draws it with (the header row's white bold included), while the rendered
 * text of that cell is hidden under it. Typing goes to the deck's one undo history (the binding is
 * the shape editor's: editor/textExtensions.ts), and two people typing in two cells both land.
 *
 * ── Getting into a cell ─────────────────────────────────────────────────────
 * The first click on a table chooses it, and the canvas moves it if the pointer drags. A click on a
 * table that is already the only thing chosen, with no drag, puts the caret in the cell under the
 * pointer, as a click on a chosen shape puts it in the shape. The canvas keeps its own pointer
 * handling; this layer hears the press on the canvas element and the release on the window, and
 * ignores a press that was on a handle or in the editor.
 *
 * Tab goes to the next cell that is not covered by a merge, and past the last one adds a row;
 * Shift+Tab goes back; Escape leaves the cell. A table that is turned is not typed in.
 *
 * Where a cell is comes from the browser (`cellGeometry.ts`), because a row grows to hold its text.
 */

import { Editor, Extension } from '@tiptap/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { themeVars } from '../../model/color';
import { paragraphStyle } from '../../model/styles';
import { DRAG_THRESHOLD } from '../../editor/drag';
import { useSelection } from '../../editor/selection';
import { editorExtensions } from '../../editor/textExtensions';
import { anchorCss } from '../../render/paint';
import type { TableElement } from '../../model/deck';
import type { Box } from '../../model/model';
import type { CanvasFrame, SlidesContext } from '../types';
import { cellAtPoint, cellBox, cellElement, measureCells, rangeBox, sameMeasure, type MeasuredCell } from './cellGeometry';
import { expandRange, insertRows, nextCell } from './tableOps';
import { chosenRange, clearCells, enterCell, leaveCell, noteCellActivity, setCellEditor, tablesFor, useTables, type CellEditing } from './tables';
import './insert.css';

type Start = 'end' | 'all' | { x: number; y: number };

interface EditorProps {
  c: SlidesContext;
  table: TableElement;
  pos: CellEditing;
  box: Box;
  scale: number;
  start: Start;
  /** The caret is in; the next entry starts at the end again. */
  started: () => void;
  enter: (r: number, c: number, start: Start) => void;
}

/** The text of one cell being typed in. */
function CellEditor({ c, table, pos, box, scale, start, started, enter }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ c, table, start, started, enter });
  latest.current = { c, table, start, started, enter };

  useLayoutEffect(() => {
    const { c: ctx, table: t, start: from } = latest.current;
    const model = ctx.model;
    const fragment = model.cellFragment(pos.slideId, pos.elId, pos.r, pos.c);
    if (!fragment || !host.current) {
      leaveCell(model);
      return;
    }
    const header = !!t.firstRow && pos.r === 0;
    const base = (level: number) => {
      const s = model.styleAt(pos.slideId, null, level);
      // The header row is white and bold, as the renderer draws it.
      return header ? { ...s, color: { theme: 'lt1' as const }, bold: true } : s;
    };
    const exit = () => {
      leaveCell(model);
      ctx.actions.focusCanvas();
    };
    const go = (back: boolean): boolean => {
      const now = latest.current;
      const el = now.c.model.element(pos.slideId, pos.elId);
      if (el?.type !== 'table') return true;
      const next = nextCell(el, pos, back);
      if (next) now.enter(next.r, next.c, 'all');
      else if (!back) {
        const res = insertRows(now.c.model, pos.slideId, pos.elId, el.rows.length);
        if (res.ok) now.enter(el.rows.length, 0, 'all');
        else now.c.notify({ text: res.message, tone: 'danger' });
      }
      return true;
    };
    // Above the text editor's own Tab, which changes a paragraph's level.
    const cells = Extension.create({
      name: 'tableCellKeys',
      priority: 2000,
      addKeyboardShortcuts: () => ({ Tab: () => go(false), 'Shift-Tab': () => go(true) })
    });
    const editor = new Editor({
      element: host.current,
      extensions: [
        ...editorExtensions({
          fragment,
          model,
          styleOf: (attrs) => paragraphStyle(base, attrs),
          theme: model.design().theme,
          awareness: ctx.awareness,
          textKey: null,
          onEscape: exit,
          cascade: true
        }),
        cells
      ],
      editable: true,
      injectCSS: false,
      editorProps: { attributes: { class: 'sl-pm', 'aria-label': 'Cell', spellcheck: 'true' } },
      onTransaction: noteCellActivity
    });
    if (from === 'all') editor.commands.setTextSelection({ from: 1, to: Math.max(1, editor.state.doc.content.size - 1) });
    else if (from === 'end') editor.commands.setTextSelection(editor.state.doc.content.size);
    else {
      const at = editor.view.posAtCoords({ left: from.x, top: from.y });
      editor.commands.setTextSelection(at ? at.pos : editor.state.doc.content.size);
    }
    editor.view.focus();
    latest.current.started();
    setCellEditor(editor);
    return () => {
      setCellEditor(null);
      editor.destroy();
      model.breakTyping();
    };
  }, [pos.slideId, pos.elId, pos.r, pos.c]);

  const cell = table.rows[pos.r]?.cells[pos.c];
  return (
    <div className="sl-logical" style={{ width: c.model.width, height: c.model.height, transform: `scale(${scale})`, ['--sl-scale' as string]: scale }}>
      <div
        className="sl-edit-box"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, ...themeVars(c.design.theme) }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="sl-frame" style={{ padding: '7.2px 14.4px', justifyContent: anchorCss(cell?.anchor) }}>
          <div ref={host} className="sl-text" />
        </div>
      </div>
    </div>
  );
}

export function TableLayer({ c, frame }: { c: SlidesContext; frame: CanvasFrame }) {
  const sel = useSelection(c.selection);
  const tables = useTables(c.model);
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<Start>('end');
  const [measured, setMeasured] = useState<MeasuredCell[] | null>(null);

  const chosen = sel.els.length === 1 ? frame.slide.elements.find((e) => e.id === sel.els[0]) : undefined;
  const table = chosen?.type === 'table' ? chosen : null;
  const id = table?.id ?? null;
  const editable = c.can.edit && !!table && !table.locked && !table.rot;
  const editing = tables.editing && tables.editing.elId === id && tables.editing.slideId === c.slideId && editable ? tables.editing : null;

  // Leaving the canvas forgets the cells.
  useEffect(() => () => clearCells(c.model), [c.model]);

  // What was chosen in a table that is no longer the one chosen on the slide, or no longer editable, goes.
  useEffect(() => {
    const now = tablesFor(c.model);
    if (!now.editing && !now.chosen) return;
    if (!table || (now.chosen && now.chosen.elId !== table.id)) clearCells(c.model);
    else if (now.editing && !editable) leaveCell(c.model);
  }, [c.model, table, editable, tables]);

  // The cells as drawn, after every render: a row grows as it is typed in.
  useLayoutEffect(() => {
    const canvas = root.current?.closest('.sl-canvas');
    const next = canvas && id ? measureCells(canvas, id, frame.scale) : null;
    setMeasured((prev) => (sameMeasure(prev, next) ? prev : next));
  });

  // The drawn text of the cell with the caret is hidden under the editor's.
  useLayoutEffect(() => {
    const canvas = root.current?.closest('.sl-canvas');
    if (!canvas || !id || !editing) return;
    const el = cellElement(canvas, id, editing.r, editing.c);
    el?.setAttribute('data-cell-editing', '');
    return () => {
      el?.removeAttribute('data-cell-editing');
    };
  });

  const enter = (r: number, col: number, from: Start): void => {
    if (!id || !c.slideId) return;
    start.current = from;
    c.model.breakTyping();
    enterCell(c.model, c.slideId, id, r, col);
    c.selection.set({ focus: 'canvas' });
  };
  const latest = useRef({ table, c, scale: frame.scale, enter });
  latest.current = { table, c, scale: frame.scale, enter };

  // A click on a table that is already chosen, with no drag, goes into the cell it landed on.
  useEffect(() => {
    const canvas = root.current?.closest('.sl-canvas');
    if (!canvas || !id || !editable) return;
    let press: { x: number; y: number; pointer: number } | null = null;
    const up = (e: PointerEvent): void => {
      const p = press;
      press = null;
      const { table: t, scale, enter: go } = latest.current;
      if (!p || !t || e.pointerId !== p.pointer || Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) return;
      const base = canvas.getBoundingClientRect();
      const at = { x: (e.clientX - base.left) / scale, y: (e.clientY - base.top) / scale };
      const cell = cellAtPoint(t, at, measureCells(canvas, t.id!, scale));
      if (cell) go(cell.r, cell.c, { x: e.clientX, y: e.clientY });
    };
    const down = (e: Event): void => {
      const ev = e as PointerEvent;
      if (ev.button !== 0 || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.target instanceof Element && ev.target.closest('[data-handle], .sl-edit-box')) return;
      // The canvas has not yet chosen what was pressed, so this is the choice from before the press.
      const s = latest.current.c.selection.get();
      if (s.els.length !== 1 || s.els[0] !== id) return;
      press = { x: ev.clientX, y: ev.clientY, pointer: ev.pointerId };
      window.addEventListener('pointerup', up, { once: true });
    };
    canvas.addEventListener('pointerdown', down);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [id, editable]);

  if (!table) return null;
  const s = frame.scale;
  const range = editable ? chosenRange(tables, table.id!) : null;
  const shown = range ? expandRange(table, range) : null;
  const outline = shown ? rangeBox(table, { r: shown.r1, c: shown.c1 }, { r: shown.r2, c: shown.c2 }, measured) : null;
  return (
    <div ref={root} className="sl-tbl">
      {outline && shown && (
        <div
          className="sl-cellsel"
          data-single={shown.r1 === shown.r2 && shown.c1 === shown.c2 ? '' : undefined}
          style={{ left: outline.x * s, top: outline.y * s, width: outline.w * s, height: outline.h * s }}
        />
      )}
      {editing && (
        <CellEditor
          key={`${editing.slideId}/${editing.elId}/${editing.r}.${editing.c}`}
          c={c}
          table={table}
          pos={editing}
          box={cellBox(table, editing, measured)}
          scale={s}
          start={start.current}
          started={() => {
            start.current = 'end';
          }}
          enter={enter}
        />
      )}
    </div>
  );
}
