import { describe, expect, it } from 'vitest';
import { Axis, EDGE_SLOP, GridLayout, HEADER_H, MAX_ELEMENT, offsetToScroll, rowHeaderWidth, scrollAxis, scrollToOffset } from './geometry';

/** A 1,000 by 26 sheet of 26px rows and 100px columns, in a 1,000 by 600 viewport. */
function layout(o: { zoom?: number; fr?: number; fc?: number; offX?: number; offY?: number; rows?: number; hide?: number[] } = {}) {
  const zoom = o.zoom ?? 1;
  const rows = o.rows ?? 1000;
  const hide = new Set(o.hide ?? []);
  return new GridLayout({
    rows: Axis.build(rows, (r) => (hide.has(r) ? 0 : 26), zoom),
    cols: Axis.build(26, () => 100, zoom),
    zoom,
    frozenRows: o.fr ?? 0,
    frozenCols: o.fc ?? 0,
    viewW: 1000,
    viewH: 600,
    headerW: rowHeaderWidth(rows, zoom),
    headerH: HEADER_H * zoom,
    offsetX: o.offX ?? 0,
    offsetY: o.offY ?? 0
  });
}

describe('Axis', () => {
  const a = Axis.build(5, (i) => [10, 0, 20, 30, 40][i]!, 1);

  it('keeps prefix sums, with a hidden line of no size', () => {
    expect([...a.offsets]).toEqual([0, 10, 10, 30, 60, 100]);
    expect(a.total).toBe(100);
    expect(a.size(1)).toBe(0);
    expect(a.hidden(1)).toBe(true);
  });

  it('finds the line under a position and never answers a hidden one', () => {
    expect(a.indexAt(0)).toBe(0);
    expect(a.indexAt(9.9)).toBe(0);
    expect(a.indexAt(10)).toBe(2);
    expect(a.indexAt(29.9)).toBe(2);
    expect(a.indexAt(99.9)).toBe(4);
    expect(a.indexAt(100)).toBe(-1);
    expect(a.indexAt(-1)).toBe(-1);
  });

  it('clamps for a drag that has left the grid', () => {
    expect(a.clampedIndexAt(-50)).toBe(0);
    expect(a.clampedIndexAt(5000)).toBe(4);
  });

  it('scales every size by the zoom', () => {
    const z = Axis.build(3, () => 26, 2);
    expect(z.total).toBe(156);
    expect(z.indexAt(51.9)).toBe(0);
    expect(z.indexAt(52)).toBe(1);
  });

  it('is fast enough to rebuild on an edit at 100,000 rows', () => {
    const t = performance.now();
    const big = Axis.build(100_000, () => 26, 1);
    expect(big.total).toBe(2_600_000);
    expect(big.indexAt(1_300_013)).toBe(50_000);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe('scrolling a long axis', () => {
  it('maps one to one while the sheet is shorter than an element can be', () => {
    const s = scrollAxis({ content: 2_600_000, pane: 500, client: 600 });
    expect(s.scale).toBe(1);
    expect(s.spacer).toBe(600 + 2_600_000 - 500);
    expect(scrollToOffset(s, 1_000_000)).toBe(1_000_000);
  });

  it('caps the spacer past the limit and scales the scroll up to reach the end', () => {
    const s = scrollAxis({ content: 26_000_000, pane: 500, client: 600 });
    expect(s.spacer).toBe(MAX_ELEMENT);
    expect(s.scale).toBeGreaterThan(2.5);
    // The end of the native range is the end of the content.
    expect(scrollToOffset(s, s.spacer - 600)).toBeCloseTo(s.maxOffset, 3);
    expect(scrollToOffset(s, 0)).toBe(0);
    // And back: a content offset has a native position that maps to it.
    const at = offsetToScroll(s, 13_000_000);
    expect(scrollToOffset(s, at)).toBeCloseTo(13_000_000, 3);
  });

  it('leaves room at the end, for the footer', () => {
    const s = scrollAxis({ content: 1000, pane: 500, client: 600, trailing: 64 });
    expect(s.maxOffset).toBe(564);
  });

  it('has no range when everything fits', () => {
    const s = scrollAxis({ content: 300, pane: 500, client: 600 });
    expect(s.maxOffset).toBe(0);
    expect(s.spacer).toBe(600);
  });
});

describe('the visible range', () => {
  it('starts at the first row and ends where the pane does', () => {
    const L = layout();
    expect(L.scrolledRows()).toEqual([0, 22]);
    expect(L.scrolledCols()?.[0]).toBe(0);
    // 1000 - 46 wide header = 954 of 100px columns
    expect(L.scrolledCols()).toEqual([0, 9]);
  });

  it('follows the scroll offset', () => {
    const L = layout({ offY: 26 * 100 + 5 });
    expect(L.scrolledRows()?.[0]).toBe(100);
  });

  it('is the same at every zoom, in screen pixels', () => {
    for (const zoom of [0.5, 1, 1.25, 2]) {
      const L = layout({ zoom });
      const rows = L.scrolledRows()!;
      const visibleHeight = L.paneH;
      // Every row listed overlaps the pane; the one after the last does not.
      expect(L.rows.start(rows[0])).toBeLessThanOrEqual(0);
      expect(L.rows.start(rows[1])).toBeLessThan(visibleHeight);
      expect(L.rows.end(rows[1])).toBeGreaterThanOrEqual(visibleHeight - 1e-6);
    }
  });

  it('keeps the frozen rows and columns out of the scrolled span', () => {
    const L = layout({ fr: 2, fc: 1, offY: 26 * 40, offX: 250 });
    expect(L.frozenRowSpan()).toEqual([0, 1]);
    expect(L.frozenColSpan()).toEqual([0, 0]);
    expect(L.scrolledRows()?.[0]).toBe(42);
    // Frozen col 0 is 100 wide, so the scrolled pane starts at abs 100 + 250.
    expect(L.scrolledCols()?.[0]).toBe(3);
    expect(L.frozenH).toBe(52);
    expect(L.paneH).toBe(600 - HEADER_H - 52);
  });
});

describe('where a cell is', () => {
  it('places a cell by its row and column and the scroll', () => {
    const L = layout({ offX: 150, offY: 52 });
    const b = L.cellBox(5, 3);
    expect(b).toEqual({ x: L.headerW + 300 - 150, y: HEADER_H + 130 - 52, w: 100, h: 26 });
  });

  it('does not scroll a frozen row or column', () => {
    const L = layout({ fr: 1, fc: 1, offX: 500, offY: 2600 });
    expect(L.cellBox(0, 0)).toEqual({ x: L.headerW, y: HEADER_H, w: 100, h: 26 });
    // A scrolled cell is placed relative to the frozen edge.
    const b = L.cellBox(120, 8);
    expect(b.x).toBe(L.headerW + 800 - 500);
    expect(b.y).toBe(HEADER_H + 26 * 120 - 2600);
  });

  it('answers the right cell for a point at each zoom, and the cell box contains the point', () => {
    for (const zoom of [0.5, 1, 1.25, 2]) {
      for (const [fr, fc] of [[0, 0], [2, 1]] as const) {
        const L = layout({ zoom, fr, fc, offX: 137, offY: 26 * 31 + 9 });
        for (const [x, y] of [[L.headerW + 5, L.headerH + 5], [400, 300], [L.viewW - 3, L.viewH - 3], [L.headerW + 2, L.headerH + L.frozenH + 2]]) {
          const hit = L.hit(x!, y!);
          if (hit.kind !== 'cell') continue;
          const b = L.cellBox(hit.row, hit.col);
          expect(x!).toBeGreaterThanOrEqual(b.x - 1e-6);
          expect(x!).toBeLessThan(b.x + b.w + 1e-6);
          expect(y!).toBeGreaterThanOrEqual(b.y - 1e-6);
          expect(y!).toBeLessThan(b.y + b.h + 1e-6);
        }
      }
    }
  });

  it('tells the headers from the cells', () => {
    const L = layout();
    expect(L.hit(5, 5)).toEqual({ kind: 'corner' });
    expect(L.hit(L.headerW + 150, 5)).toMatchObject({ kind: 'colHeader', col: 1 });
    expect(L.hit(5, HEADER_H + 40)).toMatchObject({ kind: 'rowHeader', row: 1 });
    expect(L.hit(L.headerW + 150, HEADER_H + 40)).toEqual({ kind: 'cell', row: 1, col: 1 });
  });

  it('is the empty ground past the last row or column', () => {
    const L = layout({ rows: 3 });
    expect(L.hit(L.headerW + 50, HEADER_H + 26 * 5).kind).toBe('none');
    const wide = layout();
    expect(wide.hit(990, 100).kind === 'cell' || wide.hit(990, 100).kind === 'none').toBe(true);
  });

  it('reads a frozen column and a scrolled one at the same x', () => {
    const L = layout({ fc: 1, offX: 400 });
    expect(L.hit(L.headerW + 50, 100)).toEqual({ kind: 'cell', row: 2, col: 0 });
    // Just past the frozen edge is the column that is scrolled to it: abs 100 + 400 = col 5.
    expect(L.hit(L.headerW + 100 + 1, 100)).toEqual({ kind: 'cell', row: 2, col: 5 });
  });

  it('skips a hidden row', () => {
    const L = layout({ hide: [1] });
    // Row 1 is hidden, so the second row on screen is row 2.
    expect(L.hit(L.headerW + 10, HEADER_H + 30)).toEqual({ kind: 'cell', row: 2, col: 0 });
  });

  it('nearest() clamps a drag that left the grid', () => {
    const L = layout({ rows: 10 });
    expect(L.nearest(-100, -100)).toEqual({ row: 0, col: 0 });
    expect(L.nearest(5000, 5000)).toEqual({ row: 9, col: 25 });
  });
});

describe('header edges', () => {
  it('finds the line whose far edge is under the pointer', () => {
    const L = layout();
    const edge = L.headerW + 200;
    expect(L.hit(edge, 5)).toMatchObject({ kind: 'colHeader', edge: 1 });
    expect(L.hit(edge + EDGE_SLOP, 5)).toMatchObject({ edge: 1 });
    expect(L.hit(edge - EDGE_SLOP, 5)).toMatchObject({ edge: 1 });
    expect(L.hit(edge + EDGE_SLOP + 2, 5)).toMatchObject({ edge: null });
  });

  it('takes a row edge the same way, and a scrolled one', () => {
    const L = layout({ offY: 13 });
    const y = HEADER_H + 26 * 3 - 13;
    expect(L.hit(5, y)).toMatchObject({ kind: 'rowHeader', edge: 2 });
  });

  it('keeps the slop in screen pixels at any zoom', () => {
    const L = layout({ zoom: 2 });
    expect(L.hit(L.headerW + 400 + 3, 5)).toMatchObject({ edge: 1 });
    expect(L.hit(L.headerW + 400 + 9, 5)).toMatchObject({ edge: null });
  });

  it('gives the last frozen column its edge while the scrolled pane is under it', () => {
    const L = layout({ fc: 1, offX: 400 });
    expect(L.hit(L.headerW + 100, 5)).toMatchObject({ edge: 0 });
  });
});

describe('revealing a cell', () => {
  it('asks for nothing when the cell is on screen', () => {
    const L = layout();
    expect(L.revealOffset('row', 5)).toBeNull();
  });

  it('scrolls the least that shows it, from either side', () => {
    const below = layout();
    // Row 40 begins at 1040 and the pane shows 574px: its end must reach the pane's end.
    expect(below.revealOffset('row', 40)).toBe(26 * 41 - below.paneH);
    const above = layout({ offY: 26 * 50 });
    expect(above.revealOffset('row', 10)).toBe(26 * 10);
  });

  it('never moves for a frozen line', () => {
    const L = layout({ fr: 2, offY: 500 });
    expect(L.revealOffset('row', 1)).toBeNull();
  });
});

describe('overlay pieces', () => {
  it('is one box inside one pane', () => {
    const L = layout();
    const [b, ...rest] = L.pieces({ r1: 2, r2: 3, c1: 1, c2: 2 });
    expect(rest).toHaveLength(0);
    expect(b).toEqual({ x: 100, y: 52, w: 200, h: 52 });
  });

  it('is cut by a frozen edge, each piece in its own pane', () => {
    const L = layout({ fr: 2, fc: 1, offX: 300, offY: 26 * 10 });
    const pieces = L.pieces({ r1: 1, r2: 12, c1: 0, c2: 4 });
    // Frozen rows x frozen col, frozen rows x scrolled cols, scrolled rows x frozen col, scrolled x scrolled.
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const p of pieces) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
  });

  it('keeps a selection of a hundred thousand rows a screen tall', () => {
    const L = layout({ rows: 100_000, offY: 26 * 50_000 });
    const [b] = L.pieces({ r1: 0, r2: 99_999, c1: 0, c2: 25 });
    expect(b!.h).toBeLessThan(700);
    expect(b!.y).toBeLessThanOrEqual(0);
  });

  it('leaves out a rectangle that is not on screen', () => {
    const L = layout();
    expect(L.pieces({ r1: 500, r2: 510, c1: 0, c2: 1 })).toEqual([]);
  });
});

describe('the row header', () => {
  it('widens for more digits, at the zoom', () => {
    expect(rowHeaderWidth(1000, 1)).toBe(46);
    expect(rowHeaderWidth(100_000, 1)).toBe(62);
    expect(rowHeaderWidth(100_000, 2)).toBe(124);
  });
});
