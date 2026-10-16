/**
 * The Sheets grid: a view over `GridData` that says what the person did as `GridIntent`s.
 *
 * What is on the page, bottom to top:
 *
 *   a canvas             the cells and the headers, drawn by `view.ts` on rAF
 *   a scroll container   transparent, with a spacer inside it as big as the sheet; native
 *                        scrolling, so the wheel, the touch, the keyboard and the scrollbars
 *                        are the browser's own and nothing here intercepts them
 *   an overlay layer     the selection, other people's cursors, reference outlines and
 *                        guides (imperative, `overlays.ts`), and the pieces that are React:
 *                        the editor over the active cell, the validation arrow and its list,
 *                        an error's note
 *
 * Every pointer event lands on the scroll container and is answered from the layout's geometry
 * (`geometry.ts`), so there is one place that knows where a cell is. State that is the
 * person's (the selection, the edit) lives in a `GridSession`, shared with the formula bar.
 * What would change the sheet leaves as an intent; nothing is applied here.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { cellAddress, rectAddress } from './a1';
import { CellEditor } from './CellEditor';
import { ChoiceDropdown } from './ChoiceDropdown';
import { pasteFrom, writeClipboard } from './clipboard';
import { draggedSize, fillTarget, lineRange, moveTarget, nearestGap, outside } from './gestures';
import { HEADER_H, rowHeaderWidth } from './geometry';
import type { GridLayer } from './layer';
import { filterButtonBox } from './paint';
import { cellsIn, isWholeCols, isWholeRows, rectContains, sameRect } from './selection';
import { useSession, type GridSession } from './session';
import { GridView } from './view';
import type { Cellpos, GridContextTarget, GridData, GridIntent, Rect } from './types';
import './grid.css';

export interface GridProps {
  session: GridSession;
  data: GridData;
  /** Every change the person makes, as data. The grid applies none of them. */
  onIntent: (intent: GridIntent) => void;
  /** The shell's zoom as a percentage, 50 to 200. */
  zoom: number;
  /** Refuse edits even where the data allows them (a viewing mode); the data's own flag always applies. */
  readOnly?: boolean;
  /** Told when a key or a paste tried to change a sheet that cannot be changed. */
  onReadOnlyEdit?: () => void;
  /** Room kept free at the bottom of the scroll range, so the last row can clear the footer. */
  insetBottom?: number;
  /** The lines between cells. On unless this says otherwise (View > Gridlines). */
  gridlines?: boolean;
  /** Draw what a person set as a dark ground would (View > Dark cells). Only has an effect in the dark theme. */
  darkCells?: boolean;
  label?: string;
  /**
   * A right click, or the menu key, on what the selection now is. The grid has moved the selection to
   * what was clicked and keeps the browser's own menu from opening; with Shift held it does neither,
   * and with this prop absent the browser's menu is left alone. `x` and `y` are window coordinates;
   * `from` is the grid, whose app colour and theme the menu wears.
   */
  onContextMenu?: (target: GridContextTarget, at: { x: number; y: number }, from: Element) => void;
}

type Drag =
  | { kind: 'select' }
  | { kind: 'point' }
  | { kind: 'lines'; axis: 'row' | 'col'; anchor: number }
  | { kind: 'resize'; axis: 'row' | 'col'; line: number; from: number; to: number; start: number; startSize: number; size: number }
  | { kind: 'fill'; source: Rect; target: Rect }
  | { kind: 'move'; axis: 'row' | 'col'; from: number; count: number; start: number; started: boolean; gap: number | null }
  | { kind: 'touch'; x: number; y: number; moved: boolean };

const THRESHOLD = 4;

/** The size a pasted block covers, for selecting it afterwards. */
export function pastedRect(text: string, at: Cellpos, rows: number, cols: number): Rect | null {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const w = Math.max(...lines.map((l) => l.split('\t').length));
  if (lines.length * w <= 1) return null;
  return { r1: at.row, r2: Math.min(rows - 1, at.row + lines.length - 1), c1: at.col, c2: Math.min(cols - 1, at.col + w - 1) };
}

export function Grid(props: GridProps) {
  const { session, data, onIntent, onReadOnlyEdit, insetBottom = 0, gridlines = true, darkCells = false, label = 'Spreadsheet' } = props;
  const zoom = Math.max(0.5, Math.min(2, props.zoom / 100));
  const readOnly = data.readOnly() || props.readOnly === true;
  useSession(session);

  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const pool = useRef<HTMLDivElement>(null);
  const cells = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<GridView | null>(null);
  const viewRef = useRef<GridView | null>(null);
  const [, bump] = useState(0);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; key: string } | null>(null);

  // What the session's callbacks read: always the latest props, never a stale render's.
  const live = useRef({ data, onIntent, readOnly, onReadOnlyEdit, zoom });
  live.current = { data, onIntent, readOnly, onReadOnlyEdit, zoom };
  const drag = useRef<Drag | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const autoScroll = useRef(0);
  const cursor = useRef('');

  // ── mounting the view ─────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const v = new GridView({ root: root.current!, scroller: scroller.current!, canvas: canvas.current!, spacer: spacer.current!, pool: pool.current! });
    v.measure();
    viewRef.current = v;
    setView(v);
    const el = scroller.current!;
    const ro = new ResizeObserver(() => v.measure());
    ro.observe(el);
    const onWindow = () => v.measure();
    window.addEventListener('resize', onWindow);
    const fonts = document.fonts;
    const onFonts = () => v.restyle();
    fonts?.addEventListener?.('loadingdone', onFonts);
    void fonts?.ready.then(onFonts);
    const mo = new MutationObserver(() => v.restyle());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-app'] });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWindow);
      fonts?.removeEventListener?.('loadingdone', onFonts);
      mo.disconnect();
      v.dispose();
    };
  }, []);

  // The canvas reads its colours from the root's custom properties, so a line that is not wanted
  // is one the colour of the paper, and the view reads them again.
  useLayoutEffect(() => {
    if (!view) return;
    const el = root.current!;
    if (gridlines) el.style.removeProperty('--sg-line');
    else el.style.setProperty('--sg-line', 'var(--sg-paper)');
    view.restyle();
  }, [view, gridlines]);

  // Dark cells is a reader's choice about how what is set is drawn; the stylesheet turns it into
  // `--sg-dark-cells` for the dark theme, and the view reads the colours again.
  useLayoutEffect(() => {
    if (!view) return;
    root.current!.dataset.darkCells = darkCells ? 'on' : 'off';
    view.restyle();
  }, [view, darkCells]);

  // Inputs go to the session and the view after every render.
  useLayoutEffect(() => {
    session.bind({
      get data() {
        return live.current.data;
      },
      onIntent: (i) => live.current.onIntent(i),
      readOnly: () => live.current.readOnly,
      onReadOnlyEdit: () => live.current.onReadOnlyEdit?.(),
      layout: () => viewRef.current?.current() ?? null,
      focusGrid: () => root.current?.focus({ preventScroll: true })
    });
    view?.setInputs({ data, session, zoom, insetBottom, readOnly });
  });

  // What a chart over the cells follows them with, for as long as this grid is mounted.
  useLayoutEffect(() => {
    if (!view || !cells.current) return;
    const layer: GridLayer = {
      el: cells.current,
      follow: (el, at) => {
        view.anchors.set(el, at);
        view.invalidate('size');
        return () => void view.anchors.delete(el);
      },
      layout: () => view.current(),
      refresh: () => view.invalidate('size'),
      scrollBy: (dx, dy) => view.scrollBy(dx, dy)
    };
    session.setLayer(layer);
    return () => session.setLayer(null);
  }, [view, session]);

  // A first paint at the scroll position the sheet was left at.
  useLayoutEffect(() => {
    if (!view) return;
    view.fresh();
    scroller.current!.scrollLeft = session.scroll.x;
    scroller.current!.scrollTop = session.scroll.y;
    view.invalidate('scroll');
    // The view is new once per mount; the session is the sheet's.
  }, [view, session]);

  // The model told us it changed.
  useEffect(() => {
    if (!view || !data.subscribe) return;
    return data.subscribe(() => {
      view.invalidate('data');
      bump((n) => n + 1);
    });
  }, [view, data]);

  // A request to bring a cell into view.
  const revealSeq = session.reveal?.seq;
  useLayoutEffect(() => {
    if (view && session.reveal) view.reveal(session.reveal.at);
  }, [view, revealSeq, session]);

  // ── geometry helpers ──────────────────────────────────────────────────────

  const local = (e: { clientX: number; clientY: number }) => {
    const r = scroller.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onScrollbar = (x: number, y: number) => x >= scroller.current!.clientWidth || y >= scroller.current!.clientHeight;

  const setCursor = (c: string) => {
    if (cursor.current === c) return;
    cursor.current = c;
    scroller.current!.style.cursor = c;
  };

  // ── pointer ───────────────────────────────────────────────────────────────

  const capture = (e: React.PointerEvent) => {
    try {
      scroller.current!.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone.
    }
  };

  const refuse = () => live.current.onReadOnlyEdit?.();

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!view || (e.button !== 0 && e.button !== 2)) return;
    const { x, y } = local(e);
    if (onScrollbar(x, y)) return;
    const L = view.fresh();
    if (!L) return;
    const hit = L.hit(x, y);
    const ro = live.current.readOnly;
    last.current = { x, y };

    if (e.pointerType === 'touch') {
      drag.current = { kind: 'touch', x, y, moved: false };
      return;
    }
    if (e.button === 2) {
      if (session.edit) return;
      root.current?.focus({ preventScroll: true });
      if (hit.kind === 'cell' && !rectContains(session.rect(), hit)) session.selectCell(hit, false);
      // A header that is not among the chosen lines chooses its line, as the menu is for what was clicked.
      else if ((hit.kind === 'colHeader' || hit.kind === 'rowHeader') && hit.edge === null) {
        const sel = session.rect();
        if (hit.kind === 'colHeader') {
          if (!(isWholeCols(sel, data.rowCount()) && hit.col >= sel.c1 && hit.col <= sel.c2)) session.selectCols(hit.col, hit.col);
        } else if (!(isWholeRows(sel, data.colCount()) && hit.row >= sel.r1 && hit.row <= sel.r2)) session.selectRows(hit.row, hit.row);
      }
      return;
    }

    // Focus stays where it is while editing, and comes to the grid otherwise.
    if (!session.edit) root.current?.focus({ preventScroll: true });
    view.dragging = true;

    if (hit.kind === 'cell' && session.edit) {
      if (session.pointClick(hit, e.shiftKey)) {
        drag.current = { kind: 'point' };
        capture(e);
        return;
      }
    }
    if (session.edit) session.commit('none');

    switch (hit.kind) {
      case 'corner':
        session.selectEverything();
        break;
      case 'cell': {
        const sel = session.rect();
        const h = !ro ? view.handleBox(L, sel) : null;
        if (h && Math.abs(x - (h.x + L.headerW + 3.5)) <= 7 && Math.abs(y - (h.y + L.headerH + 3.5)) <= 7) {
          drag.current = { kind: 'fill', source: sel, target: sel };
          capture(e);
          return;
        }
        const f = data.filter();
        if (f && hit.row === f.headerRow && f.cols.includes(hit.col)) {
          const b = filterButtonBox(L.cellBox(hit.row, hit.col), L.zoom);
          if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            live.current.onIntent({ type: 'filterMenu', col: hit.col });
            view.dragging = false;
            return;
          }
        }
        session.selectCell(hit, e.shiftKey);
        drag.current = { kind: 'select' };
        capture(e);
        return;
      }
      case 'colHeader':
      case 'rowHeader': {
        const axis = hit.kind === 'colHeader' ? 'col' : 'row';
        const line = hit.kind === 'colHeader' ? hit.col : hit.row;
        const sel = session.rect();
        const rows = data.rowCount();
        const cols = data.colCount();
        if (hit.edge !== null) {
          if (ro) {
            refuse();
            view.dragging = false;
            return;
          }
          const range = lineRange(axis, hit.edge, sel, rows, cols);
          const size = axis === 'col' ? L.cols.size(hit.edge) : L.rows.size(hit.edge);
          drag.current = { kind: 'resize', axis, line: hit.edge, ...range, start: axis === 'col' ? x : y, startSize: size, size: Math.round(size / L.zoom) };
          capture(e);
          return;
        }
        const whole = axis === 'col' ? isWholeCols(sel, rows) : isWholeRows(sel, cols);
        const lo = axis === 'col' ? sel.c1 : sel.r1;
        const hi = axis === 'col' ? sel.c2 : sel.r2;
        if (whole && line >= lo && line <= hi && !e.shiftKey && !ro) {
          drag.current = { kind: 'move', axis, from: lo, count: hi - lo + 1, start: axis === 'col' ? x : y, started: false, gap: null };
          capture(e);
          return;
        }
        const anchor = e.shiftKey ? (axis === 'col' ? session.sel.anchor.col : session.sel.anchor.row) : line;
        if (axis === 'col') session.selectCols(anchor, line);
        else session.selectRows(anchor, line);
        drag.current = { kind: 'lines', axis, anchor };
        capture(e);
        return;
      }
      case 'none':
        break;
    }
    view.dragging = false;
  };

  /** Re-evaluate whatever the drag is doing for a pointer at (x, y). */
  const updateDrag = (x: number, y: number) => {
    const d = drag.current;
    if (!d || !view) return;
    const L = view.fresh();
    if (!L) return;
    switch (d.kind) {
      case 'select':
        session.dragTo(L.nearest(x, y));
        break;
      case 'point':
        session.pointDrag(L.nearest(x, y));
        break;
      case 'lines': {
        const at = L.nearest(x, y);
        if (d.axis === 'col') session.selectCols(d.anchor, at.col);
        else session.selectRows(d.anchor, at.row);
        break;
      }
      case 'resize': {
        const delta = (d.axis === 'col' ? x : y) - d.start;
        d.size = draggedSize(d.startSize, delta, L.zoom);
        const edge = d.axis === 'col' ? L.colX(d.line) + d.startSize + delta : L.rowY(d.line) + d.startSize + delta;
        const min = (d.axis === 'col' ? L.headerW : L.headerH) + 1;
        const pos = Math.max(min, edge);
        view.transient = [
          {
            key: 'guide',
            boxes: [d.axis === 'col' ? { x: pos - L.headerW, y: -L.headerH, w: 1, h: L.viewH } : { x: -L.headerW, y: pos - L.headerH, w: L.viewW, h: 1 }],
            cls: `sg-guide sg-guide-${d.axis}`,
            label: `${d.size} px`
          }
        ];
        break;
      }
      case 'fill': {
        const at = L.nearest(x, y);
        const b = L.rectBox(d.source);
        d.target = fillTarget(d.source, at, { x: outside(x, b.x, b.x + b.w), y: outside(y, b.y, b.y + b.h) });
        view.transient = sameRect(d.target, d.source) ? [] : [{ key: 'fill', boxes: L.pieces(d.target), cls: 'sg-fillprev' }];
        break;
      }
      case 'move': {
        const along = d.axis === 'col' ? x : y;
        if (!d.started && Math.abs(along - d.start) < THRESHOLD) return;
        d.started = true;
        const at = L.nearest(x, y);
        const line = d.axis === 'col' ? at.col : at.row;
        const a = d.axis === 'col' ? L.cols : L.rows;
        const within = (d.axis === 'col' ? x - L.colX(line) : y - L.rowY(line));
        d.gap = nearestGap(line, within, a.size(line));
        const to = moveTarget(d.from, d.count, d.gap);
        if (to === null) {
          view.transient = [];
          break;
        }
        const g = d.axis === 'col' ? L.colX(d.gap) : L.rowY(d.gap);
        view.transient = [
          {
            key: 'guide',
            boxes: [d.axis === 'col' ? { x: g - L.headerW - 1, y: -L.headerH, w: 3, h: L.viewH } : { x: -L.headerW, y: g - L.headerH - 1, w: L.viewW, h: 3 }],
            cls: 'sg-guide sg-guide-move'
          }
        ];
        break;
      }
      case 'touch':
        if (Math.hypot(x - d.x, y - d.y) > 8) d.moved = true;
        return;
    }
    view.invalidate('drag');
  };

  /** While a drag is held past the edge of the cells, the pane scrolls and the drag goes on. */
  const tick = useCallback(() => {
    const d = drag.current;
    if (!d || !view || d.kind === 'resize' || d.kind === 'touch') {
      autoScroll.current = 0;
      return;
    }
    const L = view.current();
    if (L) {
      const { x, y } = last.current;
      const edge = (v: number, lo: number, hi: number) => (v < lo ? v - lo : v > hi ? v - hi : 0);
      const dx = d.kind === 'lines' && d.axis === 'row' ? 0 : edge(x, L.headerW + L.frozenW, L.viewW);
      const dy = d.kind === 'lines' && d.axis === 'col' ? 0 : edge(y, L.headerH + L.frozenH, L.viewH);
      if (dx !== 0 || dy !== 0) {
        const step = (n: number) => (n === 0 ? 0 : Math.sign(n) * Math.min(48, Math.abs(n) / 3 + 2));
        view.scrollBy(step(dx), step(dy));
        updateDrag(x, y);
      }
    }
    autoScroll.current = requestAnimationFrame(tick);
    // `updateDrag` reads the latest refs; the loop must not be rebuilt per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!view) return;
    const { x, y } = local(e);
    last.current = { x, y };
    if (drag.current) {
      updateDrag(x, y);
      if (!autoScroll.current && drag.current.kind !== 'touch') autoScroll.current = requestAnimationFrame(tick);
      return;
    }
    if (onScrollbar(x, y)) return;
    const L = view.current();
    if (!L) return;
    const hit = L.hit(x, y);
    let c = '';
    if (hit.kind === 'colHeader' && hit.edge !== null && !live.current.readOnly) c = 'col-resize';
    else if (hit.kind === 'rowHeader' && hit.edge !== null && !live.current.readOnly) c = 'row-resize';
    else if (hit.kind === 'cell') {
      const h = !live.current.readOnly && !session.edit ? view.handleBox(L, session.rect()) : null;
      if (h && Math.abs(x - (h.x + L.headerW + 3.5)) <= 7 && Math.abs(y - (h.y + L.headerH + 3.5)) <= 7) c = 'crosshair';
      const hovered = data.cell(hit.row, hit.col);
      const note = hovered?.note ?? hovered?.tip;
      const key = note ? `${hit.row}:${hit.col}` : '';
      if (note && tip?.key !== key) setTip({ text: note, x: x - L.headerW + 12, y: y - L.headerH + 18, key });
      else if (!note && tip) setTip(null);
    } else if (tip) setTip(null);
    setCursor(c);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(autoScroll.current);
    autoScroll.current = 0;
    if (!view) return;
    view.dragging = false;
    view.transient = [];
    try {
      scroller.current!.releasePointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
    if (d && !cancelled) {
      const send = live.current.onIntent;
      switch (d.kind) {
        case 'resize':
          if (d.size !== Math.round(d.startSize / live.current.zoom)) send({ type: 'resize', axis: d.axis, from: d.from, to: d.to, size: d.size });
          break;
        case 'fill':
          if (!sameRect(d.target, d.source)) {
            send({ type: 'fill', source: d.source, target: d.target });
            session.selectRect(d.target);
          }
          break;
        case 'move': {
          if (!d.started) {
            // A press without a drag on a selected header: it selects that line alone.
            const L = view.fresh();
            const hit = L?.hit(last.current.x, last.current.y);
            if (hit?.kind === 'colHeader' && d.axis === 'col') session.selectCols(hit.col, hit.col);
            else if (hit?.kind === 'rowHeader' && d.axis === 'row') session.selectRows(hit.row, hit.row);
            break;
          }
          const to = d.gap === null ? null : moveTarget(d.from, d.count, d.gap);
          if (to !== null) {
            send({ type: 'move', axis: d.axis, from: d.from, to, count: d.count });
            if (d.axis === 'row') session.selectRows(to, to + d.count - 1);
            else session.selectCols(to, to + d.count - 1);
          }
          break;
        }
        case 'touch': {
          if (d.moved) break;
          const L = view.fresh();
          const hit = L?.hit(d.x, d.y);
          if (hit?.kind === 'cell') {
            if (session.edit) session.commit('none');
            session.selectCell(hit, false);
            root.current?.focus({ preventScroll: true });
          } else if (hit?.kind === 'colHeader') session.selectCols(hit.col, hit.col);
          else if (hit?.kind === 'rowHeader') session.selectRows(hit.row, hit.row);
          break;
        }
        default:
          break;
      }
    }
    view.invalidate('data');
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!view || session.edit) return;
    const { x, y } = local(e);
    if (onScrollbar(x, y)) return;
    const L = view.fresh();
    const hit = L?.hit(x, y);
    if (!hit) return;
    if ((hit.kind === 'colHeader' || hit.kind === 'rowHeader') && hit.edge !== null) {
      if (live.current.readOnly) return refuse();
      const axis = hit.kind === 'colHeader' ? 'col' : 'row';
      const range = lineRange(axis, hit.edge, session.rect(), data.rowCount(), data.colCount());
      live.current.onIntent({ type: 'autofit', axis, ...range });
      return;
    }
    if (hit.kind === 'cell') {
      const f = data.filter();
      if (f && hit.row === f.headerRow && f.cols.includes(hit.col)) return;
      if (session.beginEdit('dblclick')) editor.current?.focus({ preventScroll: true });
    }
  };

  // ── the menu ──────────────────────────────────────────────────────────────

  /** What the selection is, as a menu target: whole columns or rows when that is what is chosen. */
  const menuTarget = (where: 'cell' | 'colHeader' | 'rowHeader'): GridContextTarget => {
    const sel = session.rect();
    if (where === 'colHeader') return { kind: 'col', from: sel.c1, to: sel.c2 };
    if (where === 'rowHeader') return { kind: 'row', from: sel.r1, to: sel.r2 };
    return { kind: 'cell', rect: sel, active: session.sel.active };
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    // Shift asks for the browser's own menu, and a cell being edited has it for spelling and paste.
    if (!props.onContextMenu || e.shiftKey || session.edit || !view) return;
    const { x, y } = local(e);
    if (onScrollbar(x, y)) return;
    const hit = view.fresh()?.hit(x, y);
    if (!hit || (hit.kind !== 'cell' && hit.kind !== 'colHeader' && hit.kind !== 'rowHeader')) return;
    if ((hit.kind === 'colHeader' || hit.kind === 'rowHeader') && hit.edge !== null) return;
    e.preventDefault();
    props.onContextMenu(menuTarget(hit.kind), { x: e.clientX, y: e.clientY }, root.current!);
  };

  /** The menu key, or Shift+F10: at the active cell, or at the header of the chosen lines. */
  const openMenuFromKeyboard = (): void => {
    const L = view?.fresh();
    const box = scroller.current?.getBoundingClientRect();
    if (!props.onContextMenu || !L || !box) return;
    const sel = session.rect();
    const wholeCols = isWholeCols(sel, data.rowCount());
    const wholeRows = isWholeRows(sel, data.colCount());
    const target = menuTarget(wholeCols && !wholeRows ? 'colHeader' : wholeRows && !wholeCols ? 'rowHeader' : 'cell');
    const b = L.cellBox(session.sel.active.row, session.sel.active.col);
    const x = box.left + Math.max(L.headerW, Math.min(b.x + 8, L.viewW - 8));
    const y = box.top + Math.max(L.headerH, Math.min(b.y + b.h, L.viewH - 8));
    props.onContextMenu(target, { x, y }, root.current!);
  };

  // ── keyboard ──────────────────────────────────────────────────────────────

  const startTyping = (): boolean => {
    if (!session.beginEdit('type')) return false;
    // Focus moves now, inside the key's own handler, so the browser types into the editor.
    editor.current?.focus({ preventScroll: true });
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || session.edit || !view) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const mods = { shift: e.shiftKey, ctrl, alt: e.altKey };
    const key = e.key;
    const handled = () => e.preventDefault();

    if (ctrl && !e.altKey) {
      const k = key.toLowerCase();
      if (k === 'a') {
        handled();
        session.selectEverything();
        return;
      }
      if (key === ' ') {
        handled();
        const r = session.rect();
        session.selectCols(r.c1, r.c2);
        return;
      }
      // Copy, cut, paste, undo and the rest are the browser's and the host's.
      if (key.length === 1) return;
    }
    if (key === ' ' && e.shiftKey && !ctrl) {
      handled();
      const r = session.rect();
      session.selectRows(r.r1, r.r2);
      return;
    }
    if (props.onContextMenu && (key === 'ContextMenu' || (key === 'F10' && e.shiftKey))) {
      handled();
      openMenuFromKeyboard();
      return;
    }

    switch (key) {
      case 'Tab':
        handled();
        session.move(e.shiftKey ? 'left' : 'right');
        return;
      case 'Enter': {
        handled();
        const r = session.rect();
        const merged = session.merges().at(r.r1, r.c1);
        const many = cellsIn(r) > 1 && !(merged && sameRect(merged, r));
        if (many || e.shiftKey) session.move(e.shiftKey ? 'up' : 'down');
        else if (session.beginEdit('enter')) editor.current?.focus({ preventScroll: true });
        return;
      }
      case 'F2':
        handled();
        if (session.beginEdit('f2')) editor.current?.focus({ preventScroll: true });
        return;
      case 'Delete':
      case 'Backspace':
        handled();
        if (live.current.readOnly) return refuse();
        live.current.onIntent({ type: 'clear', rect: session.rect() });
        return;
      case 'Escape':
        if (session.clip) {
          handled();
          session.setClip(null);
        }
        return;
      case 'ArrowDown':
        if (e.altKey) {
          const { row, col } = session.sel.active;
          const f = data.filter();
          if (f && row === f.headerRow && f.cols.includes(col)) {
            handled();
            live.current.onIntent({ type: 'filterMenu', col });
            return;
          }
          if (data.cell(row, col)?.hasList) {
            handled();
            setChoicesOpen(true);
            return;
          }
        }
        break;
      default:
        break;
    }

    const moved = session.key(key, mods);
    if (moved) {
      handled();
      if (moved.page) {
        const L = view.fresh();
        if (L) {
          const s = view.scrollScale();
          if (moved.page.axis === 'row') view.scrollBy(0, (moved.page.dir * L.paneH) / s.y);
          else view.scrollBy((moved.page.dir * L.paneW) / s.x, 0);
        }
      }
      return;
    }

    if (e.nativeEvent.isComposing || key === 'Process' || key === 'Dead') {
      startTyping();
      return;
    }
    if (key.length === 1 && (!ctrl || e.getModifierState('AltGraph'))) {
      // Not prevented: the character is typed into the editor, which has the focus by now.
      if (!startTyping()) handled();
    }
  };

  // ── clipboard ─────────────────────────────────────────────────────────────

  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if (session.edit || e.target !== e.currentTarget || !e.clipboardData) return;
    e.preventDefault();
    session.setClip(writeClipboard(e.clipboardData, data, session.rect(), cut && !live.current.readOnly));
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (session.edit || e.target !== e.currentTarget || !e.clipboardData) return;
    e.preventDefault();
    if (live.current.readOnly) return refuse();
    const r = session.rect();
    const at = { row: r.r1, col: r.c1 };
    const intent = pasteFrom(e.clipboardData, at, session.clip);
    if (!intent || intent.type !== 'paste') return;
    live.current.onIntent(intent);
    if (intent.cut) session.setClip(null);
    const block = pastedRect(intent.text, at, data.rowCount(), data.colCount());
    if (block) session.selectRect(block);
  };

  // ── what the screen reader hears ──────────────────────────────────────────

  const active = session.sel.active;
  const sel = session.rect();
  const activeCell = data.cell(active.row, active.col);
  const spoken = `${cellAddress(active.row, active.col)}, ${activeCell?.text || 'empty'}${cellsIn(sel) > 1 ? `, selection ${rectAddress(sel)}` : ''}`;
  const cellId = `${session.id}-active`;
  const header = { w: rowHeaderWidth(data.rowCount(), zoom), h: HEADER_H * zoom };

  return (
    <div
      ref={root}
      className="sg-root"
      role="grid"
      tabIndex={0}
      aria-label={label}
      aria-rowcount={data.rowCount()}
      aria-colcount={data.colCount()}
      aria-activedescendant={session.edit ? undefined : cellId}
      aria-multiselectable={true}
      aria-readonly={readOnly || undefined}
      data-readonly={readOnly ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onCopy={(e) => onCopy(e, false)}
      onCut={(e) => onCopy(e, true)}
      onPaste={onPaste}
    >
      <canvas ref={canvas} className="sg-canvas" aria-hidden="true" />
      <div
        ref={scroller}
        className="sg-scroller"
        onScroll={() => {
          view?.invalidate('scroll');
          if (tip) setTip(null);
        }}
        onMouseDown={(e) => {
          const { x, y } = local(e);
          if (!onScrollbar(x, y)) e.preventDefault();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={() => tip && !drag.current && setTip(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <div ref={spacer} className="sg-spacer" />
      </div>
      <div ref={cells} className="sg-cells" style={{ left: header.w, top: header.h }}>
        <div ref={pool} className="sg-pool" aria-hidden="true" />
        {view && <CellEditor session={session} data={data} view={view} zoom={zoom} inputRef={editor} />}
        {view && (
          <ChoiceDropdown
            session={session}
            data={data}
            view={view}
            zoom={zoom}
            open={choicesOpen}
            readOnly={readOnly}
            onOpen={setChoicesOpen}
            onChoose={(at, value) => live.current.onIntent({ type: 'choose', at, value })}
            focusGrid={() => root.current?.focus({ preventScroll: true })}
          />
        )}
        {tip && (
          <div className="sg-tip oa-rise" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.text}
          </div>
        )}
      </div>
      <div className="sg-sr" role="row" aria-rowindex={active.row + 1}>
        <div id={cellId} role="gridcell" aria-colindex={active.col + 1} aria-selected={true}>
          {spoken}
        </div>
      </div>
    </div>
  );
}
