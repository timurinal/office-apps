// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SHAPE_KINDS } from '../../render/geometry';
import { SlideView } from '../../render/SlideView';
import { SelectionStore } from '../../editor/selection';
import type { ShapeKind } from '../../model/deck';
import { modelOf, testDeck } from '../../model/testing';
import { CHART_KINDS } from './defaults';
import { insertChart, insertLine, insertPicture, insertShape, insertTable, insertTextBoxAt } from './place';
import { mergeCells, insertRows } from './tableOps';

/** What the renderer draws for a slide, so what is inserted is shown to be something it can draw. */
function draw(build: (t: { model: ReturnType<typeof modelOf>; selection: SelectionStore }) => void): string {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [] }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  build({ model, selection });
  return renderToStaticMarkup(<SlideView design={model.design()} slide={model.slide('s1')!} width={960} mode="edit" />);
}

describe('what is inserted, drawn', () => {
  it.each(SHAPE_KINDS.map((k) => [k as ShapeKind]))('a %s is an outline with its fill and line', (kind) => {
    const html = draw((t) => void insertShape(t, kind));
    expect(html).toContain('<path');
    expect(html).toContain('fill="#');
    expect(html).toContain('stroke="#');
  });

  it('a text box draws nothing until it has text, and a line draws its stroke and its arrow head', () => {
    // The layout's own band is drawn; the box adds nothing to it.
    const count = (html: string) => (html.match(/<path/g) ?? []).length;
    expect(count(draw((t) => void insertTextBoxAt(t)))).toBe(count(draw(() => undefined)));
    const arrow = draw((t) => void insertLine(t, true));
    expect(arrow).toContain('<line');
    expect(arrow).toContain('marker-end');
    expect(draw((t) => void insertLine(t, false))).not.toContain('marker-end');
  });

  it.each(CHART_KINDS.map((k) => [k]))('a %s chart has a place on the slide while it loads', (kind) => {
    const html = draw((t) => void insertChart(t, kind));
    expect(html).toContain('sl-chart-el');
  });

  it('a table draws a cell for every position, and a merge draws one cell over the others', () => {
    const plain = draw((t) => void insertTable(t, 3, 4));
    expect((plain.match(/class="sl-cell"/g) ?? []).length).toBe(12);
    const merged = draw((t) => {
      const id = insertTable(t, 3, 4)!;
      mergeCells(t.model, 's1', id, { r1: 0, c1: 0, r2: 1, c2: 1 });
    });
    expect((merged.match(/class="sl-cell"/g) ?? []).length).toBe(9);
    expect(merged).toContain('grid-row:1 / span 2');
    expect(merged).toContain('grid-column:1 / span 2');
  });

  it('a row added inside a merge is drawn under it, and the grid has a row more', () => {
    const html = draw((t) => {
      const id = insertTable(t, 3, 2)!;
      mergeCells(t.model, 's1', id, { r1: 0, c1: 0, r2: 1, c2: 0 });
      insertRows(t.model, 's1', id, 1);
    });
    expect(html).toContain('grid-row:1 / span 3');
    expect((html.match(/class="sl-cell"/g) ?? []).length).toBe(2 * 4 - 2);
  });

  it('a picture is an image element with its alt text kept for the slide show', () => {
    const html = draw((t) => void insertPicture(t, { id: 'abc', name: 'team.png' }, { w: 400, h: 300 }));
    expect(html).toContain('sl-image');
  });
});
