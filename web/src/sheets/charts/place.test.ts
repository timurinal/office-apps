import { describe, expect, it } from 'vitest';
import { Axis, GridLayout } from '../grid/geometry';
import type { SheetModel } from '../model';
import { room } from '../model/test/helpers';
import { dragBox } from './ChartCard';
import { MAX_H, MAX_W, anchorCell, anchorFor, boxOf, clampSize, defaultAnchor } from './place';
import type { ChartSpec } from './types';

const make = () => {
  const r = room((b) => b.addSheet('Data', { rows: 100, cols: 10 }));
  return { ...r, model: r.people[0]!.model };
};

/** A layout over a sheet of 26px rows and 100px columns, scrolled by (ox, oy), at a zoom. */
const layout = (model: SheetModel, sheet: string, o: { zoom?: number; ox?: number; oy?: number; fr?: number; fc?: number; w?: number; h?: number } = {}): GridLayout => {
  const v = model.view(sheet);
  const zoom = o.zoom ?? 1;
  return new GridLayout({
    rows: Axis.build(v.rowCount(), () => 26, zoom),
    cols: Axis.build(v.colCount(), () => 100, zoom),
    zoom,
    frozenRows: o.fr ?? 0,
    frozenCols: o.fc ?? 0,
    viewW: o.w ?? 1000,
    viewH: o.h ?? 600,
    headerW: 46 * zoom,
    headerH: 26 * zoom,
    offsetX: o.ox ?? 0,
    offsetY: o.oy ?? 0
  });
};

const spec = (m: SheetModel, sheet: string, over: Partial<ChartSpec> = {}): ChartSpec => {
  const sh = m.engine.sheet(sheet)!;
  return {
    type: 'column',
    sheet,
    data: { r1: sh.rowOrder[0]!, c1: sh.colOrder[0]!, r2: sh.rowOrder[4]!, c2: sh.colOrder[2]! },
    anchor: { row: sh.rowOrder[10]!, col: sh.colOrder[3]!, dx: 10, dy: 5 },
    w: 420,
    h: 280,
    ...over
  };
};

describe('boxOf', () => {
  it('is the anchor cell\'s corner plus the offset, with the stored size', () => {
    const { model, sheet } = make();
    const L = layout(model, sheet);
    // Column 3 starts at 46 + 300, row 10 at 26 + 260.
    expect(boxOf(model, sheet, spec(model, sheet), L)).toEqual({ x: 46 + 300 + 10, y: 26 + 260 + 5, w: 420, h: 280 });
  });

  it('scales with the zoom, offset and size alike', () => {
    const { model, sheet } = make();
    const L = layout(model, sheet, { zoom: 1.5 });
    expect(boxOf(model, sheet, spec(model, sheet), L)).toEqual({ x: 69 + 450 + 15, y: 39 + 390 + 7.5, w: 630, h: 420 });
  });

  it('moves with the scroll', () => {
    const { model, sheet } = make();
    const L = layout(model, sheet, { ox: 120, oy: 78 });
    const b = boxOf(model, sheet, spec(model, sheet), L)!;
    expect(b.x).toBe(46 + 300 - 120 + 10);
    expect(b.y).toBe(26 + 260 - 78 + 5);
  });

  it('stays put in a frozen pane', () => {
    const { model, sheet } = make();
    const sh = model.engine.sheet(sheet)!;
    const s = spec(model, sheet, { anchor: { row: sh.rowOrder[1]!, col: sh.colOrder[1]!, dx: 0, dy: 0 } });
    const a = boxOf(model, sheet, s, layout(model, sheet, { fr: 2, fc: 2 }))!;
    const b = boxOf(model, sheet, s, layout(model, sheet, { fr: 2, fc: 2, ox: 300, oy: 500 }))!;
    expect(b).toEqual(a);
  });

  it('follows an insert above it: the same ids, a lower row', () => {
    const { model, sheet } = make();
    const s = spec(model, sheet);
    const before = boxOf(model, sheet, s, layout(model, sheet))!;
    model.insertRows(sheet, 0, 3);
    const after = boxOf(model, sheet, s, layout(model, sheet))!;
    expect(after.y - before.y).toBe(78);
    expect(after.x).toBe(before.x);
  });

  it('is null for a sheet that is not there', () => {
    const { model, sheet } = make();
    expect(boxOf(model, 'nope', spec(model, sheet), layout(model, sheet))).toBeNull();
  });
});

describe('anchorCell', () => {
  it('falls back to the data\'s own corner when the anchor\'s line is gone, for data on the same sheet', () => {
    const { model, sheet } = make();
    const sh = model.engine.sheet(sheet)!;
    const s = spec(model, sheet, { anchor: { row: 'gone', col: sh.colOrder[3]!, dx: 40, dy: 40 } });
    expect(anchorCell(model, sheet, s)).toEqual({ row: 0, col: 0, dx: 0, dy: 0 });
  });

  it('is null when there is nowhere to sit: the data is on another sheet and the anchor is gone', () => {
    const { model, sheet } = make();
    const other = model.addSheet('Other')!;
    const s = spec(model, sheet, { anchor: { row: 'gone', col: 'gone', dx: 0, dy: 0 } });
    expect(anchorCell(model, other, s)).toBeNull();
  });
});

describe('anchorFor', () => {
  it('is the cell under the corner and the offset into it, the inverse of boxOf', () => {
    const { model, sheet } = make();
    const L = layout(model, sheet, { ox: 120, oy: 78 });
    const s = spec(model, sheet);
    const b = boxOf(model, sheet, s, L)!;
    const a = anchorFor(model, sheet, L, b.x, b.y)!;
    const sh = model.engine.sheet(sheet)!;
    expect([a.row, a.col, a.dx, a.dy]).toEqual([s.anchor.row, s.anchor.col, 10, 5]);
    expect(sh.rowIndex().get(a.row)).toBe(10);
  });

  it('holds at the zoom: the offset is stored at 100%', () => {
    const { model, sheet } = make();
    const L = layout(model, sheet, { zoom: 2 });
    const x = L.colX(2) + 40;
    const y = L.rowY(4) + 30;
    const a = anchorFor(model, sheet, L, x, y)!;
    expect([a.dx, a.dy]).toEqual([20, 15]);
  });

  it('puts a corner dragged over the headers on the first cell, and one past the last on the last', () => {
    const { model, sheet } = make();
    const sh = model.engine.sheet(sheet)!;
    const L = layout(model, sheet);
    const first = anchorFor(model, sheet, L, -50, -50)!;
    expect(first).toEqual({ row: sh.rowOrder[0]!, col: sh.colOrder[0]!, dx: 0, dy: 0 });
    const far = anchorFor(model, sheet, layout(model, sheet, { oy: 0 }), 46 + 5000, 26 + 99999)!;
    expect(far.row).toBe(sh.rowOrder.at(-1));
    expect(far.col).toBe(sh.colOrder.at(-1));
    expect(far.dy).toBeGreaterThan(0);
  });
});

describe('defaultAnchor', () => {
  const region = { r1: 2, r2: 8, c1: 0, c2: 3 };
  const size = { w: 420, h: 280 };

  it('goes to the right of the data, one column clear, when it fits on screen', () => {
    const { model, sheet } = make();
    const L = layout(model, sheet, { w: 1400 });
    const a = defaultAnchor(model, sheet, region, size, L, [])!;
    const sh = model.engine.sheet(sheet)!;
    expect([sh.rowIndex().get(a.row), sh.colIndex().get(a.col), a.dx, a.dy]).toEqual([2, 5, 0, 0]);
  });

  it('goes below the data when the right is off screen, and to the top left of the view when below is too', () => {
    const { model, sheet } = make();
    const sh = model.engine.sheet(sheet)!;
    const narrow = defaultAnchor(model, sheet, region, size, layout(model, sheet, { w: 700, h: 700 }), [])!;
    expect([sh.rowIndex().get(narrow.row), sh.colIndex().get(narrow.col)]).toEqual([10, 0]);
    const tiny = defaultAnchor(model, sheet, region, size, layout(model, sheet, { w: 700, h: 400, ox: 0, oy: 130 }), [])!;
    // The first row on screen, the first column.
    expect([sh.rowIndex().get(tiny.row), sh.colIndex().get(tiny.col)]).toEqual([5, 0]);
  });

  it('is to the right of the data where there is no layout to ask, and never past the last column', () => {
    const { model, sheet } = make();
    const sh = model.engine.sheet(sheet)!;
    const a = defaultAnchor(model, sheet, region, size, null, [])!;
    expect(sh.colIndex().get(a.col)).toBe(5);
    const edge = defaultAnchor(model, sheet, { ...region, c2: 9 }, size, null, [])!;
    expect(sh.colIndex().get(edge.col)).toBe(9);
  });

  it('steps down and right from a chart that is already on the spot', () => {
    const { model, sheet } = make();
    const L = layout(model, sheet, { w: 1400 });
    const first = defaultAnchor(model, sheet, region, size, L, [])!;
    const second = defaultAnchor(model, sheet, region, size, L, [first])!;
    const third = defaultAnchor(model, sheet, region, size, L, [first, second])!;
    expect([first, second, third].map((a) => [a.dx, a.dy])).toEqual([
      [0, 0],
      [24, 24],
      [48, 48]
    ]);
  });
});

describe('clampSize', () => {
  it('keeps a chart between the smallest that can be read and the largest that makes sense, in whole pixels', () => {
    expect(clampSize(10, 10)).toEqual({ w: 180, h: 130 });
    expect(clampSize(99_999, 99_999)).toEqual({ w: MAX_W, h: MAX_H });
    expect(clampSize(300.4, 200.6)).toEqual({ w: 300, h: 201 });
  });
});

describe('dragBox', () => {
  const box0 = { x: 400, y: 200, w: 420, h: 280 };
  const origin = { x: 46, y: 26 };

  it('moves by the pointer, and not past the headers', () => {
    expect(dragBox('move', box0, 30, -20, 1, origin)).toEqual({ x: 430, y: 180, w: 420, h: 280 });
    expect(dragBox('move', box0, -999, -999, 1, origin)).toEqual({ x: 46, y: 26, w: 420, h: 280 });
  });

  it('grows from the south east and shrinks from the north west, the other corner staying where it is', () => {
    expect(dragBox('se', box0, 50, 30, 1, origin)).toEqual({ x: 400, y: 200, w: 470, h: 310 });
    const nw = dragBox('nw', box0, 20, 10, 1, origin);
    expect(nw).toEqual({ x: 420, y: 210, w: 400, h: 270 });
    expect([nw.x + nw.w, nw.y + nw.h]).toEqual([820, 480]);
  });

  it('moves one edge for an edge handle', () => {
    expect(dragBox('e', box0, 40, 99, 1, origin)).toEqual({ x: 400, y: 200, w: 460, h: 280 });
    expect(dragBox('n', box0, 99, -40, 1, origin)).toEqual({ x: 400, y: 160, w: 420, h: 320 });
    expect(dragBox('w', box0, -40, 99, 1, origin)).toEqual({ x: 360, y: 200, w: 460, h: 280 });
    expect(dragBox('s', box0, 99, 40, 1, origin)).toEqual({ x: 400, y: 200, w: 420, h: 320 });
  });

  it('stops at the smallest chart, from either side, at the zoom', () => {
    expect(dragBox('se', box0, -999, -999, 1, origin)).toMatchObject({ w: 180, h: 130 });
    const nw = dragBox('nw', box0, 999, 999, 1, origin);
    expect([nw.w, nw.h, nw.x + nw.w, nw.y + nw.h]).toEqual([180, 130, 820, 480]);
    expect(dragBox('se', { ...box0, w: 630, h: 420 }, -999, -999, 1.5, origin)).toMatchObject({ w: 270, h: 195 });
  });

  it('stops at the largest chart', () => {
    expect(dragBox('se', box0, 99_999, 99_999, 1, origin)).toMatchObject({ w: MAX_W, h: MAX_H });
  });

  it('does not take a corner over the headers by growing north west', () => {
    const b = dragBox('nw', { x: 60, y: 40, w: 300, h: 200 }, -500, -500, 1, origin);
    expect([b.x, b.y]).toEqual([46, 26]);
  });
});
