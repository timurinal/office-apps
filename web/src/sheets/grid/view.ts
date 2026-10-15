/**
 * The grid's engine room, outside React: it owns the canvas, the scroll container, the cached
 * row and column sizes and the overlay pool, and draws on `requestAnimationFrame` when
 * something asks it to.
 *
 * React renders the elements and hands the view its inputs on every render (the data, the
 * session, the zoom). From there a scroll never touches React: the scroll event invalidates,
 * the next frame reads `scrollTop` and `scrollLeft`, paints the canvas and moves the overlays,
 * all in one task, so the rectangle and the cell under it are never a frame apart.
 *
 * Row and column sizes are cached as prefix sums and rebuilt only when `data.version` or the
 * zoom changes, which costs a pass over the lines and is measured in the harness.
 */

import { Axis, GridLayout, HEADER_H, offsetToScroll, rowHeaderWidth, scrollAxis, scrollToOffset, type Box, type ScrollAxis } from './geometry';
import { cellsIn, isWholeCols, isWholeRows } from './selection';
import { OverlayPool, type OverlayItem } from './overlays';
import { Painter } from './paint';
import type { GridSession } from './session';
import { FALLBACK_THEME, readTheme, type GridTheme } from './theme';
import type { Cellpos, GridData, Rect } from './types';
import { REF_COLORS } from './refs';

export interface ViewElements {
  root: HTMLElement;
  scroller: HTMLElement;
  canvas: HTMLCanvasElement;
  spacer: HTMLElement;
  pool: HTMLElement;
}

export interface ViewInputs {
  data: GridData;
  session: GridSession;
  /** A factor: 1 is 100%. */
  zoom: number;
  /** Room kept free at the bottom, so the last row can scroll clear of the footer. */
  insetBottom: number;
  readOnly: boolean;
}

/** Two axes that put every line in the same place. */
function sameAxis(a: Axis, b: Axis): boolean {
  if (a.count !== b.count) return false;
  const x = a.offsets;
  const y = b.offsets;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

export type Reason = 'scroll' | 'data' | 'select' | 'size' | 'drag';

export class GridView {
  layout: GridLayout | null = null;
  /** Drawn rows and columns are not the whole story: what a drag in progress shows. */
  transient: OverlayItem[] = [];
  /** True while the pointer is held: nothing glides. */
  dragging = false;
  /** Elements the component renders that follow a cell (the editor, a dropdown). */
  readonly anchors = new Map<HTMLElement, () => Box | null>();

  private inputs: ViewInputs | null = null;
  private painter: Painter | null = null;
  private pool: OverlayPool;
  private theme: GridTheme = FALLBACK_THEME;
  private rows: Axis = Axis.build(0, () => 0, 1);
  private cols: Axis = Axis.build(0, () => 0, 1);
  private axesKey = '';
  /** Bumped whenever a rebuild of the sizes found a different sheet, and what the last frame drew. */
  private sizesVersion = 0;
  private drawnSizes = 0;
  private dataVersion = -1;
  private frozen = { rows: 0, cols: 0 };
  private headerW = 0;
  private headerH = 0;
  private sx: ScrollAxis = { spacer: 0, scale: 1, maxOffset: 0 };
  private sy: ScrollAxis = { spacer: 0, scale: 1, maxOffset: 0 };
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  private raf = 0;
  private reasons = new Set<Reason>();
  private spacerSize = '';
  private disposed = false;
  /** How long the last frame took, for the harness. */
  lastFrameMs = 0;
  /** How long the last rebuild of the row and column sizes took. */
  lastAxesMs = 0;
  frames = 0;

  constructor(private readonly els: ViewElements) {
    this.pool = new OverlayPool(els.pool);
    const ctx = els.canvas.getContext('2d', { alpha: false });
    this.painter = ctx ? new Painter(ctx) : null;
    // The harness lists the views it has made, to compare a scrolled frame with a fresh one.
    (globalThis as { __sgViews?: GridView[] }).__sgViews?.push(this);
  }

  setInputs(inputs: ViewInputs): void {
    const prev = this.inputs;
    this.inputs = inputs;
    if (prev && prev.zoom !== inputs.zoom) this.keepTopLeft();
    const changed = !prev || prev.data !== inputs.data || this.dataVersion !== inputs.data.version || prev.zoom !== inputs.zoom || prev.readOnly !== inputs.readOnly;
    this.dataVersion = inputs.data.version;
    this.invalidate(changed ? 'data' : 'select');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.pool.clear();
  }

  /** Read the size and the pixel ratio again: the element resized, or the browser zoomed. */
  measure(): void {
    const { scroller, canvas } = this.els;
    this.viewW = scroller.clientWidth;
    this.viewH = scroller.clientHeight;
    this.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(this.viewW * this.dpr));
    canvas.height = Math.max(1, Math.round(this.viewH * this.dpr));
    canvas.style.width = `${this.viewW}px`;
    canvas.style.height = `${this.viewH}px`;
    // The scrollbars take room from the cells, and the overlay layer stops where they begin.
    this.els.root.style.setProperty('--sg-sbw', `${scroller.offsetWidth - scroller.clientWidth}px`);
    this.els.root.style.setProperty('--sg-sbh', `${scroller.offsetHeight - scroller.clientHeight}px`);
    this.painter?.meter.reset();
    this.painter?.forget();
    this.theme = readTheme(this.els.root);
    this.invalidate('size');
  }

  /** Fonts arrived, or the theme changed: widths are stale. */
  restyle(): void {
    this.painter?.meter.reset();
    this.painter?.forget();
    this.theme = readTheme(this.els.root);
    this.invalidate('data');
  }

  invalidate(reason: Reason): void {
    this.reasons.add(reason);
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.frame();
    });
  }

  /** Draw now, without waiting for a frame (a test, or a caller that has just scrolled). */
  flush(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.frame();
  }

  // ── sizes ─────────────────────────────────────────────────────────────────

  /** Rebuild the prefix sums if the data or the zoom changed. True if it did. */
  private ensureAxes(): boolean {
    const i = this.inputs;
    if (!i) return false;
    const d = i.data;
    const key = `${d.layoutVersion ?? d.version}|${i.zoom}|${d.rowCount()}|${d.colCount()}`;
    if (key === this.axesKey) return false;
    const t0 = performance.now();
    this.axesKey = key;
    const rows = Axis.build(d.rowCount(), (r) => d.rowHeight(r), i.zoom);
    const cols = Axis.build(d.colCount(), (c) => d.colWidth(c), i.zoom);
    // Whether anything moved: a rectangle only glides to a place that the sheet did not change under it.
    if (!sameAxis(this.rows, rows) || !sameAxis(this.cols, cols)) this.sizesVersion++;
    this.rows = rows;
    this.cols = cols;
    this.frozen = d.frozen();
    this.headerW = rowHeaderWidth(d.rowCount(), i.zoom);
    this.headerH = HEADER_H * i.zoom;
    this.lastAxesMs = performance.now() - t0;
    return true;
  }

  private buildLayout(): GridLayout | null {
    const i = this.inputs;
    if (!i) return null;
    this.ensureAxes();
    const { scroller, spacer } = this.els;
    const fr = Math.min(this.frozen.rows, this.rows.count);
    const fc = Math.min(this.frozen.cols, this.cols.count);
    const frozenH = this.rows.start(fr);
    const frozenW = this.cols.start(fc);
    this.sx = scrollAxis({
      content: this.cols.total - frozenW,
      pane: Math.max(0, this.viewW - this.headerW - frozenW),
      client: this.viewW
    });
    this.sy = scrollAxis({
      content: this.rows.total - frozenH,
      pane: Math.max(0, this.viewH - this.headerH - frozenH),
      client: this.viewH,
      trailing: i.insetBottom
    });
    const size = `${this.sx.spacer}x${this.sy.spacer}`;
    if (size !== this.spacerSize) {
      this.spacerSize = size;
      spacer.style.width = `${Math.ceil(this.sx.spacer)}px`;
      spacer.style.height = `${Math.ceil(this.sy.spacer)}px`;
    }
    this.layout = new GridLayout({
      rows: this.rows,
      cols: this.cols,
      zoom: i.zoom,
      frozenRows: this.frozen.rows,
      frozenCols: this.frozen.cols,
      viewW: this.viewW,
      viewH: this.viewH,
      headerW: this.headerW,
      headerH: this.headerH,
      offsetX: scrollToOffset(this.sx, scroller.scrollLeft),
      offsetY: scrollToOffset(this.sy, scroller.scrollTop)
    });
    return this.layout;
  }

  /** The layout as of the last frame, or a fresh one. */
  current(): GridLayout | null {
    return this.layout ?? this.buildLayout();
  }

  /** The layout for the scroll position right now, not the last frame's. */
  fresh(): GridLayout | null {
    return this.buildLayout();
  }

  /** Scroll so that a line begins at the pane's origin, in content pixels. */
  scrollOffsetTo(axis: 'row' | 'col', offset: number): void {
    const { scroller } = this.els;
    if (axis === 'row') scroller.scrollTop = offsetToScroll(this.sy, offset);
    else scroller.scrollLeft = offsetToScroll(this.sx, offset);
  }

  /** Scroll by native pixels. */
  scrollBy(dx: number, dy: number): void {
    this.els.scroller.scrollBy(dx, dy);
  }

  /** The scale between a native scroll pixel and a content pixel, for a page key. */
  scrollScale(): { x: number; y: number } {
    return { x: this.sx.scale, y: this.sy.scale };
  }

  /** Bring a cell fully into view, by the least scrolling. */
  reveal(at: Cellpos): void {
    const L = this.fresh();
    if (!L) return;
    const y = L.revealOffset('row', at.row);
    const x = L.revealOffset('col', at.col);
    if (y !== null) this.scrollOffsetTo('row', y);
    if (x !== null) this.scrollOffsetTo('col', x);
    if (x !== null || y !== null) this.invalidate('scroll');
  }

  /** Keep the first visible row and column where they are when the zoom changes. */
  private keepTopLeft(): void {
    const was = this.layout;
    if (!was) return;
    const row = was.scrolledRows()?.[0];
    const col = was.scrolledCols()?.[0];
    this.axesKey = '';
    const now = this.buildLayout();
    if (!now) return;
    if (row !== undefined) this.scrollOffsetTo('row', this.rows.start(row) - now.frozenH);
    if (col !== undefined) this.scrollOffsetTo('col', this.cols.start(col) - now.frozenW);
  }

  // ── the frame ─────────────────────────────────────────────────────────────

  private frame(): void {
    const i = this.inputs;
    if (!i || this.disposed || this.viewW === 0) {
      this.reasons.clear();
      return;
    }
    // The window moved to a screen with another pixel ratio: the canvas has to be the right size.
    if ((window.devicePixelRatio || 1) !== this.dpr) this.measure();
    const t0 = performance.now();
    const reasons = this.reasons;
    this.reasons = new Set();
    const L = this.buildLayout();
    if (!L) return;

    const { data, session } = i;
    const rect = session.rect();
    // Without a 2D context (a test's DOM) there is nothing to draw on, and everything above it still is.
    this.painter?.paint({
      data,
      version: data.version,
      layout: L,
      merges: session.merges(),
      theme: this.theme,
      dpr: this.dpr,
      sel: rect,
      wholeRows: isWholeRows(rect, data.colCount()),
      wholeCols: isWholeCols(rect, data.rowCount()),
      filter: data.filter()
    });

    // A selection, or a person's, that moved by itself glides. Scrolling, a drag, a resize and a
    // zoom set the rectangle down where it belongs at once, or it would trail the cells under it.
    const sheetMoved = this.sizesVersion !== this.drawnSizes;
    this.drawnSizes = this.sizesVersion;
    const glide = !sheetMoved && !this.dragging && !reasons.has('scroll') && !reasons.has('size') && !reasons.has('drag');
    this.pool.update(this.items(L, session, i), glide);
    this.placeAnchors(L);

    session.scroll = { x: this.els.scroller.scrollLeft, y: this.els.scroller.scrollTop };
    this.lastFrameMs = performance.now() - t0;
    this.frames++;
    // The harness reads these to put a number on a frame; nothing else sets the probe.
    (globalThis as { __sgProbe?: number[] }).__sgProbe?.push(this.lastFrameMs);
  }

  /** The rectangle of the grid, clamped to it. */
  private clamp(r: Rect): Rect | null {
    const rows = this.rows.count;
    const cols = this.cols.count;
    if (rows === 0 || cols === 0) return null;
    return { r1: Math.max(0, r.r1), r2: Math.min(rows - 1, r.r2), c1: Math.max(0, r.c1), c2: Math.min(cols - 1, r.c2) };
  }

  private items(L: GridLayout, session: GridSession, i: ViewInputs): OverlayItem[] {
    const out: OverlayItem[] = [];
    const sel = session.rect();
    const editing = session.edit !== null;
    const one = cellsIn(sel) === 1 || session.merges().at(sel.r1, sel.c1) !== null;
    out.push({ key: 'sel', boxes: L.pieces(sel), cls: `sg-sel${one ? ' sg-sel-one' : ''}${editing ? ' sg-sel-editing' : ''}`, glide: true });

    if (!editing && !i.readOnly) {
      const h = this.handleBox(L, sel);
      if (h) out.push({ key: 'handle', boxes: [h], cls: 'sg-handle', glide: true });
    }

    for (const p of i.data.peers()) {
      const r = this.clamp(p.rect);
      if (!r) continue;
      out.push({
        key: `peer:${p.clientId}`,
        boxes: L.pieces(r),
        cls: 'sg-peer',
        vars: { '--peer': p.color },
        glide: true,
        fade: true,
        label: p.name
      });
    }

    session.refs().forEach((t, n) => {
      if (t.foreign) return;
      const r = this.clamp(t.rect);
      if (!r) return;
      const c = REF_COLORS[t.color % REF_COLORS.length]!;
      out.push({ key: `ref:${n}`, boxes: L.pieces(r), cls: 'sg-ref', vars: { '--ref': c.line }, fade: true });
    });

    if (session.clip) {
      const r = this.clamp(session.clip.rect);
      if (r) out.push({ key: 'clip', boxes: L.pieces(r), cls: 'sg-clip', fade: true });
    }
    return out.concat(this.transient);
  }

  /** The fill handle: a small square on the selection's bottom right corner, if that is on screen. */
  handleBox(L: GridLayout, sel: Rect): Box | null {
    const x = L.colX(sel.c2) + L.cols.size(sel.c2);
    const y = L.rowY(sel.r2) + L.rows.size(sel.r2);
    const inX = sel.c2 < L.fc ? x <= L.headerW + L.frozenW : x >= L.headerW + L.frozenW && x <= L.viewW + 4;
    const inY = sel.r2 < L.fr ? y <= L.headerH + L.frozenH : y >= L.headerH + L.frozenH && y <= L.viewH + 4;
    if (!inX || !inY) return null;
    // 7 pixels, centred a little outside the corner, in the overlay's own coordinates.
    return { x: x - L.headerW - 4, y: y - L.headerH - 4, w: 7, h: 7 };
  }

  private placeAnchors(L: GridLayout): void {
    for (const [el, at] of this.anchors) {
      const b = at();
      if (!b) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = '';
      el.style.transform = `translate(${b.x - L.headerW}px, ${b.y - L.headerH}px)`;
      el.style.setProperty('--cw', `${b.w}px`);
      el.style.setProperty('--ch', `${b.h}px`);
    }
  }

  /** Whether a frame is waiting. */
  get pending(): boolean {
    return this.raf !== 0;
  }

  /** The viewport's size as last measured. */
  size(): { w: number; h: number; dpr: number } {
    return { w: this.viewW, h: this.viewH, dpr: this.dpr };
  }
}
