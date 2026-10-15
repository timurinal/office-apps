import { describe, expect, it } from 'vitest';
import { SHAPE_KINDS } from '../../render/geometry';
import type { ElementJSON, ShapeKind } from '../../model/deck';
import { SelectionStore } from '../../editor/selection';
import { plainText } from '../../model/schema';
import { box, modelOf, testDeck, THEME } from '../../model/testing';
import { contrast, resolveColor } from '../../themes/color';
import { THEMES } from '../../themes';
import { tonesOf } from '../../themes/themes';
import {
  altFromName,
  CHART_KINDS,
  defaultSize,
  fitPicture,
  isDrag,
  lineFor,
  newLine,
  newShape,
  newTable,
  rectBetween,
  rectFor,
  sampleChart,
  shapeStyle,
  snapAngle,
  within
} from './defaults';
import { addPictures, type PictureSteps } from './picture';
import { insertChart, insertLine, insertPicture, insertShape, insertTable, insertTextBoxAt } from './place';
import { GALLERY_KINDS, SHAPE_GROUPS, SHAPE_NAMES } from './ShapeGallery';
import { addColumn, addRow, mergeable, mergeChosen, removeColumns, removeRows, selectedTable, splittable, splitChosen, setTableLook, type TableHost } from './tableActions';
import { validateTable } from './tableOps';
import { arm, armedFor, disarm, sameTool } from './tool';
import { chooseCells, clearCells, enterCell, leaveCell, tablesFor } from './tables';

/** A deck of one blank slide, chosen as the canvas has it. */
function open(elements: ElementJSON[] = []) {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  return { model, selection, t: { model, selection } };
}

const els = (m: ReturnType<typeof open>): ElementJSON[] => m.model.slide('s1')!.elements;

describe('inserting', () => {
  it.each(SHAPE_KINDS.map((k) => [k]))('a %s lands one element, chosen, in one undo entry', (kind) => {
    const m = open();
    const id = insertShape(m.t, kind);
    expect(id).toBeTruthy();
    expect(els(m)).toHaveLength(1);
    expect(els(m)[0]).toMatchObject({ type: 'shape', shape: kind });
    expect(m.selection.get().els).toEqual([id]);
    expect(m.model.undo()).toBe(true);
    expect(els(m)).toHaveLength(0);
    expect(m.model.canUndo()).toBe(false);
  });

  it('a text box has the caret in it, and no fill or outline', () => {
    const m = open();
    const id = insertTextBoxAt(m.t)!;
    expect(m.selection.get()).toMatchObject({ els: [id], editing: id });
    expect(els(m)[0]).toMatchObject({ type: 'shape', shape: 'rect', textBox: { wrap: true } });
    expect(els(m)[0]).not.toHaveProperty('fill');
    expect(els(m)[0]).not.toHaveProperty('line');
    m.model.undo();
    expect(els(m)).toHaveLength(0);
  });

  it('a line and an arrow are one element each; the arrow has its head at the end', () => {
    const m = open();
    insertLine(m.t, false);
    insertLine(m.t, true);
    expect(els(m)).toHaveLength(2);
    expect(els(m)[0]).toMatchObject({ type: 'line', line: { width: 4 } });
    expect(els(m)[0]).not.toHaveProperty('line.tail');
    expect(els(m)[1]).toMatchObject({ type: 'line', line: { tail: 'arrow' } });
    m.model.undo();
    expect(els(m)).toHaveLength(1);
  });

  it.each(CHART_KINDS.map((k) => [k]))('a %s chart lands with its sample data in one step', (kind) => {
    const m = open();
    insertChart(m.t, kind);
    const chart = els(m)[0]!;
    expect(chart).toMatchObject({ type: 'chart', chart: kind });
    if (chart.type !== 'chart') throw new Error('not a chart');
    expect(chart.categories.length).toBeGreaterThan(1);
    expect(chart.series.every((s) => s.values.length === chart.categories.length)).toBe(true);
    m.model.undo();
    expect(els(m)).toHaveLength(0);
  });

  it('a table lands with a cell in every position, in one step', () => {
    const m = open();
    const id = insertTable(m.t, 4, 5)!;
    const t = m.model.element('s1', id)!;
    expect(t).toMatchObject({ type: 'table', firstRow: true, bandRows: true });
    if (t.type !== 'table') throw new Error('not a table');
    expect(t.rows).toHaveLength(4);
    expect(t.rows.every((r) => r.cells.length === 5)).toBe(true);
    expect(validateTable(t)).toEqual([]);
    expect(t.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(t.w, 1);
    m.model.undo();
    expect(els(m)).toHaveLength(0);
  });

  it('a picture is an element holding the asset, in proportion, with alt text from its name and its aspect locked', () => {
    const m = open();
    const id = insertPicture(m.t, { id: 'a1', name: 'team-photo_2026.jpg' }, { w: 4000, h: 2000 })!;
    const img = m.model.element('s1', id)!;
    expect(img).toMatchObject({ type: 'image', asset: { id: 'a1' }, alt: 'team photo 2026', lockAspect: true });
    expect(img.w / img.h).toBeCloseTo(2, 1);
    m.model.undo();
    expect(els(m)).toHaveLength(0);
  });

  it('a text box drawn thin is still tall enough for a line of type', () => {
    const m = open();
    insertTextBoxAt(m.t, { kind: 'drag', rect: { x: 100, y: 100, w: 500, h: 20 } });
    expect(els(m)[0]).toMatchObject({ x: 100, y: 100, w: 500, h: 64 });
  });

  it('does nothing in a deck with no slide chosen', () => {
    const m = open();
    m.selection.set({ slide: null, slides: [] });
    expect(insertShape(m.t, 'rect')).toBeNull();
    expect(els(m)).toHaveLength(0);
  });

  it('is refused for a reader, with the model saying so and nothing written', () => {
    const model = modelOf(testDeck(), { readOnly: true });
    const selection = new SelectionStore();
    selection.set({ slide: 's1', slides: ['s1'] });
    const notices: string[] = [];
    model.onNotice((n) => notices.push(n.message));
    expect(insertShape({ model, selection }, 'rect')).toBeNull();
    expect(notices).toHaveLength(1);
    expect(model.slide('s1')!.elements).toHaveLength(0);
  });

  it('a picture that finished uploading after the person moved on lands on the slide it was asked for and leaves the selection', () => {
    const model = modelOf(
      testDeck([
        { id: 's1', layout: 'blank', elements: [] },
        { id: 's2', layout: 'blank', elements: [] }
      ])
    );
    const selection = new SelectionStore();
    selection.set({ slide: 's1', slides: ['s1'] });
    selection.set({ slide: 's2', slides: ['s2'], els: [] });
    insertPicture({ model, selection }, { id: 'a', name: 'x.png' }, { w: 100, h: 100 }, 's1');
    expect(model.slide('s1')!.elements).toHaveLength(1);
    expect(model.slide('s2')!.elements).toHaveLength(0);
    expect(selection.get().els).toEqual([]);
  });
});

describe('where it goes', () => {
  const slide = { w: 1920, h: 1080 };

  it('in the middle by default, and centred on a click, kept on the slide', () => {
    expect(rectFor({ kind: 'centre' }, { w: 400, h: 200 }, slide)).toEqual({ x: 760, y: 440, w: 400, h: 200 });
    expect(rectFor({ kind: 'click', at: { x: 500, y: 300 } }, { w: 400, h: 200 }, slide)).toEqual({ x: 300, y: 200, w: 400, h: 200 });
    expect(rectFor({ kind: 'click', at: { x: 10, y: 1075 } }, { w: 400, h: 200 }, slide)).toEqual({ x: 0, y: 880, w: 400, h: 200 });
  });

  it('a drag is the rectangle between its corners, whichever way it went, and Shift makes it square', () => {
    expect(rectBetween({ x: 500, y: 400 }, { x: 300, y: 250 })).toEqual({ x: 300, y: 250, w: 200, h: 150 });
    expect(rectBetween({ x: 100, y: 100 }, { x: 300, y: 150 }, true)).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    expect(rectBetween({ x: 300, y: 300 }, { x: 250, y: 100 }, true)).toEqual({ x: 100, y: 100, w: 200, h: 200 });
  });

  it('a dragged shape is never a sliver, and never off the slide', () => {
    const r = rectFor({ kind: 'drag', rect: { x: 100, y: 100, w: 400, h: 2 } }, { w: 1, h: 1 }, slide);
    expect(r.h).toBeGreaterThanOrEqual(16);
    expect(within({ x: -50, y: 2000, w: 100, h: 100 }, slide)).toEqual({ x: 0, y: 980, w: 100, h: 100 });
  });

  it('a press is a drag only once it has gone far enough', () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 30, y: 0 })).toBe(true);
  });

  it('a line drawn right to left, or bottom to top, is flipped so its end is where the pointer was', () => {
    const l = newLine({ from: { x: 500, y: 400 }, to: { x: 300, y: 200 } }, true);
    expect(l).toMatchObject({ x: 300, y: 200, w: 200, h: 200, flipH: true, flipV: true });
    const level = newLine({ from: { x: 100, y: 100 }, to: { x: 400, y: 100 } }, false);
    expect(level).toMatchObject({ x: 100, y: 100, w: 300, h: 0 });
    expect(level).not.toHaveProperty('flipH');
  });

  it('a click puts down a level line through the point; Shift pulls a drawn one onto 15 degrees', () => {
    expect(lineFor({ kind: 'click', at: { x: 960, y: 300 } }, { w: 1920, h: 1080 })).toEqual({ from: { x: 760, y: 300 }, to: { x: 1160, y: 300 } });
    const p = snapAngle({ x: 0, y: 0 }, { x: 100, y: 3 });
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.x).toBeCloseTo(Math.hypot(100, 3), 5);
    const q = snapAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    expect(Math.atan2(q.y, q.x) * (180 / Math.PI)).toBeCloseTo(45, 5);
  });

  it('a picture is as large as it is up to 70 per cent of the slide each way, and centred', () => {
    expect(fitPicture({ w: 400, h: 300 }, { w: 1920, h: 1080 })).toEqual({ x: 760, y: 390, w: 400, h: 300 });
    const big = fitPicture({ w: 4000, h: 3000 }, { w: 1920, h: 1080 });
    expect(big.h).toBe(756);
    expect(big.w / big.h).toBeCloseTo(4 / 3, 2);
    expect(big.x + big.w / 2).toBeCloseTo(960, 0);
    expect(altFromName('IMG_0042.JPEG')).toBe('IMG 0042');
  });

  it('a table is as wide as the layouts and its columns add up to it', () => {
    const t = newTable(3, 3, { w: 1920, h: 1080 });
    expect(t.w).toBeCloseTo(1612, 0);
    expect(t.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(t.w, 1);
    expect(t.h).toBe(192);
    const clamped = newTable(99, 99, { w: 1920, h: 1080 });
    expect(clamped.rows).toHaveLength(8);
    expect(clamped.cols).toHaveLength(10);
  });

  it('sample data has a value for every category', () => {
    for (const kind of CHART_KINDS) {
      const d = sampleChart(kind);
      expect(d.series.every((s) => s.values.length === d.categories.length)).toBe(true);
    }
    // A scatter's categories are its x values.
    expect(sampleChart('scatter').categories.every((c) => Number.isFinite(Number(c)))).toBe(true);
  });
});

describe('a new shape', () => {
  it('can be read in every theme: the master\'s ink has 4.5 to 1 on its fill', () => {
    for (const theme of [...THEMES, THEME]) {
      const { fill } = shapeStyle(theme);
      if (fill.kind !== 'solid') throw new Error('not solid');
      // What a paragraph in a shape inherits is the master's `other` style: the theme's own ink.
      const ink = resolveColor(tonesOf(theme).ink, theme);
      expect(contrast(ink, resolveColor(fill.color, theme)), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws from the theme, so a theme change recolours it', () => {
    const s = newShape('rect', { x: 0, y: 0, w: 10, h: 10 }, THEME);
    expect(s.fill).toMatchObject({ kind: 'solid', color: { theme: 'accent1' } });
    expect(s.line).toMatchObject({ color: { theme: 'accent1' } });
    expect(s.textBox).toMatchObject({ anchor: 'middle' });
  });

  it('has a size for every kind', () => {
    for (const kind of SHAPE_KINDS) {
      const d = defaultSize(kind);
      expect(d.w).toBeGreaterThan(100);
      expect(d.h).toBeGreaterThan(100);
    }
  });
});

describe('the shape gallery', () => {
  it('shows every shape the renderer can draw, once each', () => {
    expect([...GALLERY_KINDS].sort()).toEqual([...SHAPE_KINDS].sort());
    expect(new Set(GALLERY_KINDS).size).toBe(GALLERY_KINDS.length);
    expect(SHAPE_GROUPS.every((g) => g.kinds.length > 0)).toBe(true);
  });

  it('names each one in words', () => {
    for (const kind of SHAPE_KINDS as readonly ShapeKind[]) expect(SHAPE_NAMES[kind].length).toBeGreaterThan(2);
    expect(new Set(Object.values(SHAPE_NAMES)).size).toBe(SHAPE_KINDS.length);
  });
});

describe('the drawing tool', () => {
  it('is armed for one model, put away by a second press on the same button, and not carried to another model', () => {
    const a = open();
    const b = open();
    arm(a.model, { kind: 'shape', shape: 'ellipse' });
    expect(armedFor(a.model)).toEqual({ kind: 'shape', shape: 'ellipse' });
    expect(armedFor(b.model)).toBeNull();
    arm(a.model, { kind: 'shape', shape: 'rect' });
    expect(armedFor(a.model)).toEqual({ kind: 'shape', shape: 'rect' });
    arm(a.model, { kind: 'shape', shape: 'rect' });
    expect(armedFor(a.model)).toBeNull();
    arm(a.model, { kind: 'line', arrow: true });
    expect(sameTool(armedFor(a.model), { kind: 'line', arrow: true })).toBe(true);
    expect(sameTool(armedFor(a.model), { kind: 'line', arrow: false })).toBe(false);
    disarm();
    expect(armedFor(a.model)).toBeNull();
  });
});

describe('pictures from files', () => {
  const file = (name: string, type = 'image/png'): File => new File([new Uint8Array([1, 2, 3])], name, { type });
  const steps = (over: Partial<PictureSteps> = {}): PictureSteps => ({
    prepare: async (f) => ({ blob: f, mime: f.type, name: f.name, width: 800, height: 600 }),
    upload: async (_doc, image) => ({ id: `asset-${image.name}`, name: image.name }),
    ...over
  });

  it('puts each file on the slide, one element and one undo entry apiece, and says it is adding', async () => {
    const m = open();
    const said: string[] = [];
    const n = await addPictures({ target: m.t, documentId: 'd1', notify: (t) => said.push(t.text) }, [file('a.png'), file('b.jpg', 'image/jpeg')], steps());
    expect(n).toBe(2);
    expect(els(m).map((e) => (e.type === 'image' ? e.asset.id : null))).toEqual(['asset-a.png', 'asset-b.jpg']);
    expect(said).toEqual(['Adding a.png.', 'Adding b.jpg.']);
    m.model.undo();
    expect(els(m)).toHaveLength(1);
  });

  it('leaves out what is not a raster picture, and says why for one that cannot be stored, going on with the rest', async () => {
    const m = open();
    const said: { text: string; tone?: string }[] = [];
    const n = await addPictures(
      { target: m.t, documentId: 'd1', notify: (t) => said.push(t) },
      [file('doc.svg', 'image/svg+xml'), file('bad.png'), file('ok.png')],
      steps({
        upload: async (_d, image) => {
          if (image.name === 'bad.png') throw new Error('nope');
          return { id: 'ok', name: image.name };
        }
      })
    );
    expect(n).toBe(1);
    expect(els(m)).toHaveLength(1);
    expect(said.some((t) => t.tone === 'danger' && t.text.includes('bad.png'))).toBe(true);
    expect(said.some((t) => t.text.includes('doc.svg'))).toBe(false);
  });
});

// ── the table buttons ───────────────────────────────────────────────────────

function withTable(rows = 3, cols = 3) {
  const m = open();
  const id = insertTable(m.t, rows, cols)!;
  const said: string[] = [];
  const host: TableHost = { model: m.model, selection: m.selection, notify: (t) => said.push(t.text) };
  return { ...m, id, said, host };
}
const table = (m: ReturnType<typeof withTable>) => m.model.element('s1', m.id) as Extract<ElementJSON, { type: 'table' }>;

describe('the table buttons', () => {
  it('act on the table that is the only thing chosen', () => {
    const m = open([{ ...box(0, 0), id: 'a' }]);
    const host: TableHost = { model: m.model, selection: m.selection, notify: () => undefined };
    m.selection.set({ els: ['a'] });
    expect(selectedTable(host)).toBeNull();
    expect(addRow(host, true)).toBe(false);
    const t = withTable();
    expect(selectedTable(t.host)?.id).toBe(t.id);
    t.selection.set({ els: [t.id, 'x'] });
    expect(selectedTable(t.host)).toBeNull();
  });

  it('insert a row above and below the chosen cells, the choice following its cell', () => {
    const m = withTable();
    chooseCells(m.model, 's1', m.id, { r: 1, c: 1 });
    expect(addRow(m.host, false)).toBe(true);
    expect(table(m).rows).toHaveLength(4);
    expect(tablesFor(m.model).chosen).toMatchObject({ a: { r: 2, c: 1 }, b: { r: 2, c: 1 } });
    expect(addRow(m.host, true)).toBe(true);
    expect(table(m).rows).toHaveLength(5);
    expect(tablesFor(m.model).chosen).toMatchObject({ a: { r: 2, c: 1 } });
    // Each was one entry.
    m.model.undo();
    expect(table(m).rows).toHaveLength(4);
  });

  it('with no cell chosen, act on the first', () => {
    const m = withTable();
    clearCells(m.model);
    expect(addRow(m.host, false)).toBe(true);
    expect(table(m).rows).toHaveLength(4);
    expect(addColumn(m.host, true)).toBe(true);
    expect(table(m).cols).toHaveLength(4);
  });

  it('delete the rows or columns the chosen cells are in, and leave the choice on a cell that is there', () => {
    const m = withTable(3, 3);
    chooseCells(m.model, 's1', m.id, { r: 1, c: 0 }, { r: 2, c: 2 });
    expect(removeRows(m.host)).toBe(true);
    expect(table(m).rows).toHaveLength(1);
    expect(tablesFor(m.model).chosen).toMatchObject({ a: { r: 0, c: 0 } });
    chooseCells(m.model, 's1', m.id, { r: 0, c: 1 }, { r: 0, c: 2 });
    expect(removeColumns(m.host)).toBe(true);
    expect(table(m).cols).toHaveLength(1);
    expect(validateTable(table(m))).toEqual([]);
  });

  it('say so, in a toast, when a step is refused', () => {
    const m = withTable(1, 1);
    expect(removeRows(m.host)).toBe(false);
    expect(m.said).toEqual(['A table needs at least one row.']);
  });

  it('merge and split the chosen cells', () => {
    const m = withTable();
    chooseCells(m.model, 's1', m.id, { r: 0, c: 0 });
    expect(mergeable(m.host)).toBe(false);
    expect(splittable(m.host)).toBe(false);
    chooseCells(m.model, 's1', m.id, { r: 0, c: 0 }, { r: 1, c: 1 });
    expect(mergeable(m.host)).toBe(true);
    expect(mergeChosen(m.host)).toBe(true);
    expect(table(m).rows[0]!.cells[0]).toMatchObject({ rowSpan: 2, colSpan: 2 });
    expect(tablesFor(m.model).chosen).toMatchObject({ a: { r: 0, c: 0 }, b: { r: 0, c: 0 } });
    expect(splittable(m.host)).toBe(true);
    expect(splitChosen(m.host)).toBe(true);
    expect(tablesFor(m.model).chosen).toMatchObject({ a: { r: 0, c: 0 }, b: { r: 1, c: 1 } });
    expect(validateTable(table(m))).toEqual([]);
  });

  it('turn the header row and the bands on and off', () => {
    const m = withTable();
    expect(setTableLook(m.host, 'firstRow', false)).toBe(true);
    expect(table(m).firstRow).toBe(false);
    expect(setTableLook(m.host, 'bandRows', false)).toBe(true);
    expect(table(m).bandRows).toBe(false);
  });
});

describe('which cell has the caret', () => {
  it('is entered, left, and forgotten with the model it was made for', () => {
    const a = withTable();
    const b = withTable();
    enterCell(a.model, 's1', a.id, 1, 2);
    expect(tablesFor(a.model).editing).toMatchObject({ elId: a.id, r: 1, c: 2 });
    expect(tablesFor(a.model).chosen).toMatchObject({ a: { r: 1, c: 2 } });
    expect(tablesFor(b.model).editing).toBeNull();
    leaveCell(a.model);
    expect(tablesFor(a.model).editing).toBeNull();
    expect(tablesFor(a.model).chosen).not.toBeNull();
    clearCells(a.model);
    expect(tablesFor(a.model).chosen).toBeNull();
  });
});

describe('text the table is made of', () => {
  it('starts empty in every cell', () => {
    const m = withTable(2, 2);
    expect(table(m).rows.flatMap((r) => r.cells.map((c) => plainText(c.text)))).toEqual(['', '', '', '']);
  });
});
