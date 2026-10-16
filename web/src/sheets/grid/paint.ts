/**
 * The canvas painter: the cells on screen and the headers, nothing else. Selections, other
 * people's cursors, the editor and the fill handle are DOM above this (Grid.tsx), so a
 * selection moves on the compositor and the canvas is drawn when the data, the scroll or the
 * zoom changes.
 *
 * Everything here is drawn in device pixels, from the layout's CSS pixels times the device's
 * ratio, with every edge rounded once: two cells that share an edge round it to the same pixel,
 * so there are no gaps and no doubled lines at 110% on a 1.25 screen. A gridline is the
 * bottom and right pixel row of its cell, as the board draws them.
 *
 * A region is a block of cells in one pane. The grid has up to four (the frozen corner, the
 * frozen rows, the frozen columns and the scrolled pane), each drawn clipped to itself in this
 * order: fills, gridlines, borders, then text. Text overflows into empty neighbours and
 * suppresses the gridlines it covers, so a long title in A1 reads as one line across B1 and C1.
 */

import { darkFill, darkInk } from '../../core/darkColors';
import { colToLetters } from './a1';
import { type Axis, GridLayout, type Box, type Span } from './geometry';
import type { MergeIndex } from './merges';
import { alignOf, fontFor, hashes, TextMeter, type Align, type FontSpec } from './text';
import { FONT_FAMILY, type GridTheme } from './theme';
import type { BorderLine, BorderSide, GridCell, GridData, Rect } from './types';

/** The board's cell padding, and the room above and below a line of text. */
export const PAD_X = 8;
const PAD_Y = 3;
/** The tallest a run of overflow reaches, in columns. */
const MAX_OVERFLOW = 60;
/** How far left of the scrolled pane to look for text that reaches into it. */
const LOOKBACK = 14;

export interface PaintState {
  data: GridData;
  /** `data.version`: what is drawn is the same only while this is. */
  version: number;
  layout: GridLayout;
  merges: MergeIndex;
  theme: GridTheme;
  /** Device pixels per CSS pixel. */
  dpr: number;
  /** The selection, for the headers. */
  sel: Rect | null;
  wholeRows: boolean;
  wholeCols: boolean;
  filter: ReturnType<GridData['filter']>;
}

/** The filter button's box inside its cell, in CSS pixels: used to draw it and to hit it. */
export function filterButtonBox(cell: Box, zoom: number): Box | null {
  const size = Math.min(18 * zoom, cell.h - 4 * zoom);
  if (cell.w < 44 * zoom || size < 8) return null;
  return { x: cell.x + cell.w - size - 3 * zoom, y: cell.y + (cell.h - size) / 2, w: size, h: size };
}

interface Op {
  lines: string[];
  font: string;
  px: number;
  color: string;
  align: Align;
  v: 'top' | 'middle' | 'bottom';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** What the text may draw over: the cell, and the empty cells it overflows into. */
  ex1: number;
  ex2: number;
  indent: number;
  underline: boolean;
  strike: boolean;
  clip: boolean;
  width: number;
}

interface Border {
  side: 'top' | 'right' | 'bottom' | 'left';
  b: BorderSide;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The layout in whole device pixels: where each pane begins, and how far the scrolled ones have gone. */
interface Dev {
  L: GridLayout;
  D: number;
  /** The headers' size. */
  hw: number;
  hh: number;
  /** Where the scrolled panes begin. */
  fx: number;
  fy: number;
  /** How far they have scrolled. */
  ox: number;
  oy: number;
  /** The canvas. */
  w: number;
  h: number;
}

/**
 * A column's edges in device pixels: its content position rounded, less the scroll rounded. A
 * frozen column does not scroll, so the right edge of the last one is the pane's edge even
 * though the next column, which does, begins somewhere else.
 */
const colLeft = (g: Dev, c: number): number => g.hw + Math.round(g.L.cols.start(c) * g.D) - (c >= g.L.fc ? g.ox : 0);
const colRight = (g: Dev, c: number): number => g.hw + Math.round(g.L.cols.start(c + 1) * g.D) - (c >= g.L.fc ? g.ox : 0);
const rowTop = (g: Dev, r: number): number => g.hh + Math.round(g.L.rows.start(r) * g.D) - (r >= g.L.fr ? g.oy : 0);
const rowBottom = (g: Dev, r: number): number => g.hh + Math.round(g.L.rows.start(r + 1) * g.D) - (r >= g.L.fr ? g.oy : 0);

const intersect = (a: Box, b: Box): Box => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
};

/** What a person set, as this reader's theme draws it: as set, or mapped for a dark ground (Dark cells). */
const fillOf = (theme: GridTheme, c: string): string => (theme.darkCells ? darkFill(c) : c);
const inkOf = (theme: GridTheme, c: string): string => (theme.darkCells ? darkInk(c) : c);

const THICK: Record<BorderLine, number> = { thin: 1, dashed: 1, dotted: 1, medium: 2, double: 3, thick: 3 };
const HEAVY: Record<BorderLine, number> = { dotted: 0, dashed: 0, thin: 0, medium: 1, double: 1, thick: 2 };

interface Last {
  version: number;
  rows: Axis;
  cols: Axis;
  theme: GridTheme;
  fr: number;
  fc: number;
  hw: number;
  hh: number;
  w: number;
  h: number;
  D: number;
  ox: number;
  oy: number;
}

export class Painter {
  readonly meter: TextMeter;
  private prev: Last | null = null;
  private fonts = new WeakMap<object, FontSpec>();
  private fontScale = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    this.meter = new TextMeter(ctx);
  }

  /**
   * Draw the grid. A frame that only scrolled is not drawn again: the pixels of the last frame are
   * moved by the distance scrolled and only the rows or columns that came into view are drawn,
   * which is what keeps the cost of a frame the same however much text is on the sheet. Anything
   * else (the data, the zoom, the size, the theme) draws every pane from scratch.
   *
   * Edges are rounded from the content position and the scroll offset separately, each to whole
   * device pixels, so every row moves by the same whole number of pixels between frames: a moved
   * pixel is exactly where a fresh draw would have put it.
   */
  paint(s: PaintState): void {
    const { ctx } = this;
    const L = s.layout;
    const D = s.dpr;
    const g: Dev = {
      L,
      D,
      hw: Math.round(L.headerW * D),
      hh: Math.round(L.headerH * D),
      fx: Math.round((L.headerW + L.frozenW) * D),
      fy: Math.round((L.headerH + L.frozenH) * D),
      ox: Math.round(L.offsetX * D),
      oy: Math.round(L.offsetY * D),
      w: ctx.canvas.width,
      h: ctx.canvas.height
    };
    // The frozen panes' edge is the header plus the frozen size, rounded once, whichever way they are added.
    g.fx = g.hw + Math.round(L.frozenW * D);
    g.fy = g.hh + Math.round(L.frozenH * D);

    const prev = this.prev;
    const same =
      prev !== null &&
      prev.version === s.version &&
      prev.rows === L.rows &&
      prev.cols === L.cols &&
      prev.theme === s.theme &&
      prev.fr === L.fr &&
      prev.fc === L.fc &&
      prev.hw === g.hw &&
      prev.hh === g.hh &&
      prev.w === g.w &&
      prev.h === g.h &&
      prev.D === D;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!same) {
      ctx.fillStyle = s.theme.paper;
      ctx.fillRect(0, 0, g.w, g.h);
    }

    const rowSpans: [Span, number, number, boolean][] = [
      [L.frozenRowSpan(), g.hh, g.fy, false],
      [L.scrolledRows(), g.fy, g.h, true]
    ];
    const colSpans: [Span, number, number, boolean][] = [
      [L.frozenColSpan(), g.hw, g.fx, false],
      [L.scrolledCols(), g.fx, g.w, true]
    ];
    for (const [rs, y1, y2, rowScrolls] of rowSpans) {
      for (const [cs, x1, x2, colScrolls] of colSpans) {
        if (!rs || !cs) continue;
        const clip: Box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        if (clip.w <= 0 || clip.h <= 0) continue;
        if (!same) {
          this.region(s, g, rs, cs, clip, null);
          continue;
        }
        const dx = colScrolls ? prev.ox - g.ox : 0;
        const dy = rowScrolls ? prev.oy - g.oy : 0;
        if (dx === 0 && dy === 0) continue;
        if (Math.abs(dx) >= clip.w || Math.abs(dy) >= clip.h) {
          this.region(s, g, rs, cs, clip, clip);
          continue;
        }
        this.blit(clip, dx, dy);
        if (dy !== 0) this.region(s, g, rs, cs, clip, dy < 0 ? { x: clip.x, y: clip.y + clip.h + dy, w: clip.w, h: -dy } : { x: clip.x, y: clip.y, w: clip.w, h: dy });
        if (dx !== 0) this.region(s, g, rs, cs, clip, dx < 0 ? { x: clip.x + clip.w + dx, y: clip.y, w: -dx, h: clip.h } : { x: clip.x, y: clip.y, w: dx, h: clip.h });
      }
    }
    this.headers(s, g);
    this.dividers(s, g);
    this.prev = { version: s.version, rows: L.rows, cols: L.cols, theme: s.theme, fr: L.fr, fc: L.fc, hw: g.hw, hh: g.hh, w: g.w, h: g.h, D, ox: g.ox, oy: g.oy };
  }

  /**
   * `ctx.restore()`, and the font it brings back is not the one the meter last set: the meter
   * would then skip selecting a font the context no longer has, and draw in the wrong one.
   */
  private restore(): void {
    this.ctx.restore();
    this.meter.forgetFont();
  }

  /** The next paint starts from nothing: the canvas was replaced or its meaning changed. */
  forget(): void {
    this.prev = null;
  }

  /** Move what is drawn inside `r` by (dx, dy) pixels. What it leaves uncovered is the caller's to draw. */
  private blit(r: Box, dx: number, dy: number): void {
    const sx = Math.max(r.x, r.x - dx);
    const sy = Math.max(r.y, r.y - dy);
    const w = r.w - Math.abs(dx);
    const h = r.h - Math.abs(dy);
    this.ctx.drawImage(this.ctx.canvas, sx, sy, w, h, sx + dx, sy + dy, w, h);
  }

  // ── cells ─────────────────────────────────────────────────────────────────

  /**
   * Draw a block of cells in one pane. With `band`, only the part of the pane inside it is
   * drawn (cleared first, then every cell that touches it), which is how a scroll draws the
   * rows that have come into view.
   */
  private region(s: PaintState, g: Dev, rows: readonly [number, number], cols: readonly [number, number], clip: Box, band: Box | null): void {
    const { ctx, meter } = this;
    const { data, layout: L, theme, dpr: D } = s;
    const scale = L.zoom * D;

    // The pane's lines and where their edges fall, then only those the band touches.
    const nrAll = rows[1] - rows[0] + 1;
    const ncAll = cols[1] - cols[0] + 1;
    const xsAll = new Float64Array(ncAll + 1);
    const ysAll = new Float64Array(nrAll + 1);
    for (let i = 0; i < ncAll; i++) xsAll[i] = colLeft(g, cols[0] + i);
    for (let i = 0; i < nrAll; i++) ysAll[i] = rowTop(g, rows[0] + i);
    xsAll[ncAll] = colRight(g, cols[1]);
    ysAll[nrAll] = rowBottom(g, rows[1]);

    const win = band ? intersect(clip, band) : clip;
    if (win.w <= 0 || win.h <= 0) return;
    let i0 = 0;
    let i1 = nrAll - 1;
    let j0 = 0;
    let j1 = ncAll - 1;
    while (i0 <= i1 && ysAll[i0 + 1]! <= win.y) i0++;
    while (i1 >= i0 && ysAll[i1]! >= win.y + win.h) i1--;
    while (j0 <= j1 && xsAll[j0 + 1]! <= win.x) j0++;
    while (j1 >= j0 && xsAll[j1]! >= win.x + win.w) j1--;
    if (i0 > i1 || j0 > j1) return;

    const r0 = rows[0] + i0;
    const r1 = rows[0] + i1;
    const c0 = cols[0] + j0;
    const c1 = cols[0] + j1;
    const nr = r1 - r0 + 1;
    const nc = c1 - c0 + 1;
    const xs = xsAll.subarray(j0, j1 + 2);
    const ys = ysAll.subarray(i0, i1 + 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(win.x, win.y, win.w, win.h);
    ctx.clip();
    if (band) {
      ctx.fillStyle = theme.paper;
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }

    // Merged areas first: the window's cells they cover are not drawn on their own.
    const ms = s.merges.within({ r1: r0, r2: r1, c1: c0, c2: c1 });
    const cover = new Int32Array(nr * nc);
    const mbox: Box[] = [];
    const mcell: (GridCell | null)[] = [];
    ms.forEach((m, k) => {
      for (let r = Math.max(m.r1, r0); r <= Math.min(m.r2, r1); r++) {
        for (let c = Math.max(m.c1, c0); c <= Math.min(m.c2, c1); c++) cover[(r - r0) * nc + (c - c0)] = k + 1;
      }
      const x1 = colLeft(g, m.c1);
      const y1 = rowTop(g, m.r1);
      mbox.push({ x: x1, y: y1, w: colRight(g, m.c2) - x1, h: rowBottom(g, m.r2) - y1 });
      mcell.push(data.cell(m.r1, m.c1));
    });

    const cells = new Array<GridCell | null>(nr * nc);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = (r - r0) * nc + (c - c0);
        cells[i] = cover[i] ? null : data.cell(r, c);
      }
    }

    // 1. fills
    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < nc; j++) {
        const cell = cells[i * nc + j];
        const fill = cell && (cell.conditional?.fill ?? cell.style.fill);
        const bar = cell?.conditional?.bar;
        if (fill) {
          ctx.fillStyle = fillOf(theme, fill);
          ctx.fillRect(xs[j]!, ys[i]!, xs[j + 1]! - xs[j]!, ys[i + 1]! - ys[i]!);
        }
        if (bar) {
          // A data bar sits under the text, inset from the cell's edges so neighbours' bars do not join.
          const w = xs[j + 1]! - xs[j]!;
          const inset = Math.max(1, Math.round(2 * D));
          ctx.fillStyle = fillOf(theme, bar.color);
          ctx.fillRect(Math.round(xs[j]! + w * bar.from), ys[i]! + inset, Math.max(1, Math.round(w * (bar.to - bar.from))), ys[i + 1]! - ys[i]! - 2 * inset);
        }
      }
    }
    ms.forEach((_, k) => {
      const c = mcell[k];
      const fill = c && (c.conditional?.fill ?? c.style.fill);
      if (!fill) return;
      const b = mbox[k]!;
      ctx.fillStyle = fillOf(theme, fill);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    });

    // 2. text, laid out before the gridlines so that the lines under overflow can be left out
    const noRight = new Uint8Array(nr * nc);
    const noBottom = new Uint8Array(nr * nc);
    for (const m of ms) {
      for (let r = Math.max(m.r1, r0); r <= Math.min(m.r2, r1); r++) {
        for (let c = Math.max(m.c1, c0); c <= Math.min(m.c2, c1); c++) {
          const i = (r - r0) * nc + (c - c0);
          if (c < m.c2) noRight[i] = 1;
          if (r < m.r2) noBottom[i] = 1;
        }
      }
    }

    const blank = (r: number, c: number): boolean => {
      if (r >= r0 && r <= r1 && c >= c0 && c <= c1) {
        const i = (r - r0) * nc + (c - c0);
        if (cover[i]) return false;
        const x = cells[i];
        return !x || x.text === '';
      }
      if (s.merges.at(r, c)) return false;
      const x = data.cell(r, c);
      return !x || x.text === '';
    };

    const ops: Op[] = [];
    const tri: { x: number; y: number; dir: 'tl' | 'tr'; color: string }[] = [];
    const padX = PAD_X * scale;

    const layOut = (cell: GridCell, r: number, c: number, x1: number, y1: number, x2: number, y2: number, lastCol: number): void => {
      const style = cell.style;
      if (cell.note) tri.push({ x: x1, y: y1, dir: 'tl', color: theme.danger });
      if (cell.commented) tri.push({ x: x2, y: y1, dir: 'tr', color: theme.comment });
      if (cell.text === '') return;
      const spec = this.specFor(cell, scale);
      const align = alignOf(cell);
      const indent = style.indent ? style.indent * meter.width(spec.css, '   ') : 0;
      const wrap = style.wrap === true;
      let text = !wrap && cell.text.includes('\n') ? cell.text.replace(/\n/g, ' ') : cell.text;
      const avail = x2 - x1 - 2 * padX - indent;
      let lines: string[];
      let width: number;
      let ex1 = x1;
      let ex2 = x2;
      let clipIt = false;

      if (wrap) {
        lines = meter.wrap(spec.css, text, Math.max(1, avail));
        width = Math.min(avail, Math.max(...lines.map((l) => meter.width(spec.css, l))));
        clipIt = true;
      } else {
        width = meter.width(spec.css, text);
        if (width > avail && cell.kind === 'number') {
          text = hashes(avail, meter.width(spec.css, '#'));
          width = meter.width(spec.css, text);
        } else if (width > avail && cell.kind === 'text') {
          const need = width + 2 * padX + indent - (x2 - x1);
          const reachRight = align !== 'right';
          const reachLeft = align !== 'left';
          const each = align === 'center' ? need / 2 : need;
          let right = 0;
          let left = 0;
          let cr = lastCol;
          if (reachRight) {
            for (let k = 1; k <= MAX_OVERFLOW && right < each && c + k < L.cols.count; k++) {
              const wpx = L.cols.size(c + k) * D;
              if (wpx === 0) continue;
              if (!blank(r, c + k)) break;
              right += wpx;
              cr = c + k;
            }
          }
          let cl = c;
          if (reachLeft) {
            for (let k = 1; k <= MAX_OVERFLOW && left < each && c - k >= 0; k++) {
              const wpx = L.cols.size(c - k) * D;
              if (wpx === 0) continue;
              if (!blank(r, c - k)) break;
              left += wpx;
              cl = c - k;
            }
          }
          ex2 = x2 + Math.min(right, each);
          ex1 = x1 - Math.min(left, each);
          // The lines inside the run are not drawn.
          if (r >= r0 && r <= r1) {
            for (let k = Math.max(cl, c0); k <= Math.min(cr - 1, c1); k++) noRight[(r - r0) * nc + (k - c0)] = 1;
          }
          clipIt = width > avail + (ex2 - x2) + (x1 - ex1);
        }
        lines = [text];
      }

      const lineH = spec.px * 1.25;
      if (lines.length * lineH > y2 - y1 + 1) clipIt = true;
      // Automatic text is the theme's own; only a colour a person set is mapped for Dark cells.
      const set = cell.color ?? cell.conditional?.color ?? style.color;
      ops.push({
        lines,
        font: spec.css,
        px: spec.px,
        color: set ? inkOf(theme, set) : theme.ink,
        align,
        v: style.v ?? 'middle',
        x1,
        y1,
        x2,
        y2,
        ex1,
        ex2,
        indent,
        underline: style.underline === true,
        strike: cell.conditional?.strike ?? style.strike === true,
        clip: clipIt,
        width
      });
    };

    const borders: Border[] = [];
    const collectBorders = (style: GridCell['style'], x1: number, y1: number, x2: number, y2: number): void => {
      if (style.borderTop) borders.push({ side: 'top', b: style.borderTop, x1, y1, x2, y2 });
      if (style.borderRight) borders.push({ side: 'right', b: style.borderRight, x1, y1, x2, y2 });
      if (style.borderBottom) borders.push({ side: 'bottom', b: style.borderBottom, x1, y1, x2, y2 });
      if (style.borderLeft) borders.push({ side: 'left', b: style.borderLeft, x1, y1, x2, y2 });
    };

    // Text from cells left of the pane that runs into it.
    if (c0 > L.fc) {
      for (let r = r0; r <= r1; r++) {
        for (let k = 1; k <= LOOKBACK && c0 - k >= 0; k++) {
          const c = c0 - k;
          if (L.cols.size(c) === 0) continue;
          if (s.merges.at(r, c)) break;
          const cell = data.cell(r, c);
          if (!cell || cell.text === '') {
            continue;
          }
          if (cell.kind === 'text' && !cell.style.wrap && alignOf(cell) === 'left') {
            const x1 = colLeft(g, c);
            const x2 = colRight(g, c);
            if (this.reaches(cell, x1, x2, xs[0]!, scale, padX)) layOut(cell, r, c, x1, ys[r - r0]!, x2, ys[r - r0 + 1]!, c);
          }
          break;
        }
      }
    }

    for (let i = 0; i < nr; i++) {
      for (let j = 0; j < nc; j++) {
        const cell = cells[i * nc + j];
        if (!cell) continue;
        if (cell.style.borderTop || cell.style.borderRight || cell.style.borderBottom || cell.style.borderLeft) {
          collectBorders(cell.style, xs[j]!, ys[i]!, xs[j + 1]!, ys[i + 1]!);
        }
        if (cell.text !== '' || cell.note || cell.commented) layOut(cell, r0 + i, c0 + j, xs[j]!, ys[i]!, xs[j + 1]!, ys[i + 1]!, c0 + j);
      }
    }
    ms.forEach((m, k) => {
      const cell = mcell[k];
      const b = mbox[k]!;
      if (!cell) return;
      collectBorders(cell.style, b.x, b.y, b.x + b.w, b.y + b.h);
      if (cell.text !== '' || cell.note || cell.commented) layOut(cell, m.r1, m.c1, b.x, b.y, b.x + b.w, b.y + b.h, m.c2);
    });

    // 3. gridlines: one rectangle for each run of lines nothing interrupts
    ctx.fillStyle = theme.line;
    ctx.beginPath();
    const thin = Math.max(1, Math.round(D));
    for (let j = 0; j < nc; j++) {
      if (xs[j + 1]! === xs[j]!) continue;
      let start = -1;
      for (let i = 0; i <= nr; i++) {
        const on = i < nr && ys[i + 1]! !== ys[i]! && !noRight[i * nc + j];
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          ctx.rect(xs[j + 1]! - thin, ys[start]!, thin, ys[i]! - ys[start]!);
          start = -1;
        }
      }
    }
    for (let i = 0; i < nr; i++) {
      if (ys[i + 1]! === ys[i]!) continue;
      let start = -1;
      for (let j = 0; j <= nc; j++) {
        const on = j < nc && xs[j + 1]! !== xs[j]! && !noBottom[i * nc + j];
        if (on && start < 0) start = j;
        if (!on && start >= 0) {
          ctx.rect(xs[start]!, ys[i + 1]! - thin, xs[j]! - xs[start]!, thin);
          start = -1;
        }
      }
    }
    ctx.fill();

    // 4. borders, the heaviest last so that it wins a shared edge
    if (borders.length > 0) {
      for (let weight = 0; weight <= 2; weight++) {
        for (const bd of borders) if (HEAVY[bd.b.line] === weight) this.border(bd, D, theme);
      }
    }

    // 5. text, then the corners
    ctx.textBaseline = 'alphabetic';
    for (const op of ops) this.text(op, scale);
    for (const t of tri) {
      const size = 6 * scale;
      ctx.fillStyle = t.color;
      ctx.beginPath();
      if (t.dir === 'tl') {
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x + size, t.y);
        ctx.lineTo(t.x, t.y + size);
      } else {
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x - size, t.y);
        ctx.lineTo(t.x, t.y + size);
      }
      ctx.fill();
    }

    // 6. filter buttons, in the header row
    const f = s.filter;
    if (f && f.headerRow >= r0 && f.headerRow <= r1) {
      for (const col of f.cols) {
        if (col < c0 || col > c1) continue;
        const box = filterButtonBox({ x: xs[col - c0]! / D, y: ys[f.headerRow - r0]! / D, w: (xs[col - c0 + 1]! - xs[col - c0]!) / D, h: (ys[f.headerRow - r0 + 1]! - ys[f.headerRow - r0]!) / D }, L.zoom);
        if (box) this.filterButton(box, f.active.includes(col), D, theme);
      }
    }
    this.restore();
  }

  /** A cell's font. The model hands out interned styles, so one object is looked up and never rebuilt. */
  private specFor(cell: GridCell, scale: number): FontSpec {
    const c = cell.conditional;
    if (c && (c.bold !== undefined || c.italic !== undefined)) return fontFor(cell.style, c, scale);
    if (scale !== this.fontScale) {
      this.fontScale = scale;
      this.fonts = new WeakMap();
    }
    let spec = this.fonts.get(cell.style);
    if (!spec) {
      spec = fontFor(cell.style, undefined, scale);
      this.fonts.set(cell.style, spec);
    }
    return spec;
  }

  /** Whether left-aligned text in a cell to the left runs as far as `edge`. */
  private reaches(cell: GridCell, x1: number, x2: number, edge: number, scale: number, padX: number): boolean {
    const w = this.meter.width(this.specFor(cell, scale).css, cell.text) + 2 * padX;
    return x1 + w > edge && x1 + w > x2;
  }

  private text(op: Op, scale: number): void {
    const { ctx } = this;
    this.meter.setFont(op.font);
    ctx.fillStyle = op.color;
    ctx.textAlign = op.align;
    const padX = PAD_X * scale;
    const lineH = op.px * 1.25;
    const block = op.lines.length * lineH;
    const top =
      op.v === 'top' ? op.y1 + PAD_Y * scale : op.v === 'bottom' ? op.y2 - PAD_Y * scale - block : op.y1 + (op.y2 - op.y1 - block) / 2;
    const x = op.align === 'left' ? op.x1 + padX + op.indent : op.align === 'right' ? op.x2 - padX - op.indent : (op.x1 + op.x2) / 2;
    if (op.clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(op.ex1, op.y1, op.ex2 - op.ex1, op.y2 - op.y1);
      ctx.clip();
    }
    const stroke = Math.max(1, Math.round(op.px / 13));
    for (let i = 0; i < op.lines.length; i++) {
      const line = op.lines[i]!;
      const base = Math.round(top + i * lineH + lineH / 2 + op.px * 0.36);
      ctx.fillText(line, Math.round(x), base);
      if ((op.underline || op.strike) && line !== '') {
        const w = op.lines.length === 1 ? op.width : this.meter.width(op.font, line);
        const left = op.align === 'left' ? x : op.align === 'right' ? x - w : x - w / 2;
        if (op.underline) ctx.fillRect(Math.round(left), base + Math.round(op.px * 0.12), Math.round(w), stroke);
        if (op.strike) ctx.fillRect(Math.round(left), base - Math.round(op.px * 0.3), Math.round(w), stroke);
      }
    }
    if (op.clip) this.restore();
  }

  private border(bd: Border, D: number, theme: GridTheme): void {
    const { ctx } = this;
    const line = bd.b.line;
    const thin = Math.max(1, Math.round(D));
    const t = Math.max(1, Math.round(THICK[line] * D));
    const color = bd.b.color ? inkOf(theme, bd.b.color) : theme.ink;
    // The line is centred on the cell's edge; a thin one is the gridline's own pixel row.
    const at = (edge: number) => edge - Math.ceil(t / 2);
    const horizontal = bd.side === 'top' || bd.side === 'bottom';
    const edge = bd.side === 'top' ? bd.y1 : bd.side === 'bottom' ? bd.y2 : bd.side === 'left' ? bd.x1 : bd.x2;
    const from = horizontal ? bd.x1 : bd.y1;
    const to = horizontal ? bd.x2 : bd.y2;

    if (line === 'dashed' || line === 'dotted') {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = thin;
      ctx.setLineDash(line === 'dashed' ? [4 * D, 3 * D] : [D, 2 * D]);
      ctx.beginPath();
      const mid = at(edge) + t / 2;
      if (horizontal) {
        ctx.moveTo(from, mid);
        ctx.lineTo(to, mid);
      } else {
        ctx.moveTo(mid, from);
        ctx.lineTo(mid, to);
      }
      ctx.stroke();
      this.restore();
      return;
    }
    ctx.fillStyle = color;
    const rect = (e: number, w: number) => {
      if (horizontal) ctx.fillRect(from, e, to - from, w);
      else ctx.fillRect(e, from, w, to - from);
    };
    if (line === 'double') {
      rect(at(edge), thin);
      rect(at(edge) + 2 * thin, thin);
    } else rect(at(edge), t);
  }

  private filterButton(b: Box, active: boolean, D: number, theme: GridTheme): void {
    const { ctx } = this;
    const x = b.x * D;
    const y = b.y * D;
    const w = b.w * D;
    const h = b.h * D;
    ctx.fillStyle = active ? theme.headOnBg : theme.headBg;
    ctx.strokeStyle = active ? theme.accent : theme.headLine;
    ctx.lineWidth = Math.max(1, Math.round(D));
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3 * D);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? theme.accent : theme.headInk;
    ctx.beginPath();
    if (active) {
      // A funnel.
      ctx.moveTo(x + w * 0.24, y + h * 0.3);
      ctx.lineTo(x + w * 0.76, y + h * 0.3);
      ctx.lineTo(x + w * 0.56, y + h * 0.54);
      ctx.lineTo(x + w * 0.56, y + h * 0.74);
      ctx.lineTo(x + w * 0.44, y + h * 0.68);
      ctx.lineTo(x + w * 0.44, y + h * 0.54);
    } else {
      ctx.moveTo(x + w * 0.3, y + h * 0.42);
      ctx.lineTo(x + w * 0.7, y + h * 0.42);
      ctx.lineTo(x + w * 0.5, y + h * 0.64);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ── headers ───────────────────────────────────────────────────────────────

  private headers(s: PaintState, g: Dev): void {
    const { ctx, meter } = this;
    const { layout: L, theme, dpr: D, sel } = s;
    const thin = Math.max(1, Math.round(D));
    const accent = Math.max(2, Math.round(2 * D));
    const { hw, hh, w: W, h: H } = g;
    const font = `500 ${12 * L.zoom * D}px ${FONT_FAMILY}`;

    ctx.save();
    ctx.fillStyle = theme.headBg;
    ctx.fillRect(0, 0, W, hh);
    ctx.fillRect(0, 0, hw, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    meter.setFont(font);

    const draw = (axis: 'col' | 'row', span: Span, from: number, to: number) => {
      if (!span) return;
      ctx.save();
      ctx.beginPath();
      if (axis === 'col') ctx.rect(from, 0, to - from, hh);
      else ctx.rect(0, from, hw, to - from);
      ctx.clip();
      for (let i = span[0]; i <= span[1]; i++) {
        const size = axis === 'col' ? L.cols.size(i) : L.rows.size(i);
        if (size === 0) continue;
        const a = axis === 'col' ? colLeft(g, i) : rowTop(g, i);
        const b = axis === 'col' ? colRight(g, i) : rowBottom(g, i);
        const on = sel ? (axis === 'col' ? i >= sel.c1 && i <= sel.c2 : i >= sel.r1 && i <= sel.r2) : false;
        const solid = on && (axis === 'col' ? s.wholeCols : s.wholeRows);
        if (on) {
          ctx.fillStyle = solid ? theme.headSolid : theme.headOnBg;
          if (axis === 'col') ctx.fillRect(a, 0, b - a, hh);
          else ctx.fillRect(0, a, hw, b - a);
        }
        // The rule after it
        ctx.fillStyle = theme.headLine;
        if (axis === 'col') ctx.fillRect(b - thin, 0, thin, hh);
        else ctx.fillRect(0, b - thin, hw, thin);
        if (on && !solid) {
          ctx.fillStyle = theme.accent;
          if (axis === 'col') ctx.fillRect(a, hh - accent, b - a, accent);
          else ctx.fillRect(hw - accent, a, accent, b - a);
        }
        ctx.fillStyle = on ? (solid ? theme.headSolidInk : theme.headOnInk) : theme.headInk;
        const label = axis === 'col' ? colToLetters(i) : String(i + 1);
        const cx = axis === 'col' ? (a + b) / 2 : hw / 2 - (on && !solid ? accent / 2 : 0);
        const cy = axis === 'col' ? hh / 2 : (a + b) / 2;
        ctx.fillText(label, Math.round(cx), Math.round(cy + 12 * L.zoom * D * 0.36));
      }
      this.restore();
    };
    draw('col', L.frozenColSpan(), hw, g.fx);
    draw('col', L.scrolledCols(), g.fx, W);
    draw('row', L.frozenRowSpan(), hh, g.fy);
    draw('row', L.scrolledRows(), g.fy, H);

    // The strips' own edges.
    ctx.fillStyle = theme.headLine;
    ctx.fillRect(0, hh - thin, W, thin);
    ctx.fillRect(hw - thin, 0, thin, H);
    this.restore();
  }

  /** The line where the frozen panes end. */
  private dividers(s: PaintState, g: Dev): void {
    const { ctx } = this;
    const { layout: L, theme, dpr: D } = s;
    const t = Math.max(2, Math.round(2 * D));
    ctx.fillStyle = theme.frozen;
    if (L.fc > 0) ctx.fillRect(g.fx - t, g.hh, t, g.h - g.hh);
    if (L.fr > 0) ctx.fillRect(g.hw, g.fy - t, g.w - g.hw, t);
  }
}
