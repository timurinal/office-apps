import { describe, expect, it } from 'vitest';
import { modelOf, testDeck } from '../model/testing';
import { columnsOf, dropAt, nudgeTarget, rowsOf, stepIndex, thumbWidth, SORTER_WIDTH, type Rect } from './sorter';

/** `n` thumbnails 100 by 60, `cols` to a row, a 20 px gap between them. */
const grid = (n: number, cols: number): Rect[] =>
  Array.from({ length: n }, (_, i) => ({ left: (i % cols) * 120, top: Math.floor(i / cols) * 80, width: 100, height: 60 }));

describe('thumbnail size', () => {
  it('follows the zoom between its limits, and has a size of its own on fit', () => {
    expect(thumbWidth(100, false)).toBe(320);
    expect(thumbWidth(50, false)).toBe(160);
    expect(thumbWidth(10, false)).toBe(SORTER_WIDTH.min);
    expect(thumbWidth(200, false)).toBe(SORTER_WIDTH.max);
    expect(thumbWidth(62, true)).toBe(SORTER_WIDTH.fit);
    expect(thumbWidth(150, false)).toBeGreaterThan(thumbWidth(100, false));
  });
});

describe('rows', () => {
  it('splits thumbnails into rows by where they sit', () => {
    expect(rowsOf(grid(7, 3))).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(columnsOf(grid(7, 3))).toBe(3);
    expect(columnsOf(grid(2, 5))).toBe(2);
    expect(columnsOf([])).toBe(1);
  });
});

describe('where a drop lands', () => {
  const rects = grid(7, 3);

  it('goes before the first thumbnail the pointer is left of the middle of', () => {
    expect(dropAt(rects, 10, 30).index).toBe(0);
    expect(dropAt(rects, 130, 30).index).toBe(1);
    // Past the middle of the second thumbnail (170): before the third.
    expect(dropAt(rects, 175, 30).index).toBe(2);
    expect(dropAt(rects, 130, 110).index).toBe(4);
  });

  it('goes after the last of a row when the pointer is past it', () => {
    const r = dropAt(rects, 500, 30);
    expect(r.index).toBe(3);
    // The line is in the gap after the third thumbnail, the row’s height.
    expect(r.line).toEqual({ x: 240 + 100 + 10, y: 0, height: 60 });
    // And after the last thumbnail of the last row.
    expect(dropAt(rects, 500, 170).index).toBe(7);
  });

  it('draws the line in the gap before the thumbnail it lands before', () => {
    expect(dropAt(rects, 130, 30).line).toEqual({ x: 120 - 10, y: 0, height: 60 });
    // The first column: the line stays inside the list.
    expect(dropAt(rects, 10, 30).line.x).toBe(1);
  });

  it('picks the nearest row when the pointer is between two or outside them', () => {
    expect(dropAt(rects, 130, 68).index).toBe(1);
    expect(dropAt(rects, 130, 75).index).toBe(4);
    expect(dropAt(rects, 130, -50).index).toBe(1);
    // The last row has one thumbnail; the pointer is past its middle.
    expect(dropAt(rects, 130, 900).index).toBe(7);
    expect(dropAt(rects, 30, 900).index).toBe(6);
  });

  it('has somewhere to put the first slide in an empty list', () => {
    expect(dropAt([], 5, 5).index).toBe(0);
  });
});

describe('arrow keys', () => {
  it('step by one across a row, by a row up and down, and stay in the list', () => {
    expect(stepIndex(4, 'ArrowRight', 3, 7)).toBe(5);
    expect(stepIndex(4, 'ArrowLeft', 3, 7)).toBe(3);
    expect(stepIndex(4, 'ArrowDown', 3, 7)).toBe(6);
    expect(stepIndex(4, 'ArrowUp', 3, 7)).toBe(1);
    expect(stepIndex(0, 'ArrowLeft', 3, 7)).toBe(0);
    expect(stepIndex(5, 'ArrowDown', 3, 7)).toBe(6);
    expect(stepIndex(2, 'ArrowUp', 3, 7)).toBe(0);
    expect(stepIndex(3, 'Home', 3, 7)).toBe(0);
    expect(stepIndex(3, 'End', 3, 7)).toBe(6);
    expect(stepIndex(0, 'PageDown', 3, 7)).toBe(6);
  });
});

describe('moving with the keyboard', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('puts the chosen slides one place earlier or later, and says when they cannot go', () => {
    expect(nudgeTarget(order, ['c'], -1)).toBe(1);
    expect(nudgeTarget(order, ['c'], 1)).toBe(4);
    expect(nudgeTarget(order, ['a'], -1)).toBeNull();
    expect(nudgeTarget(order, ['e'], 1)).toBeNull();
    expect(nudgeTarget(order, ['b', 'c'], 1)).toBe(4);
    expect(nudgeTarget(order, [], 1)).toBeNull();
  });

  it('is what the model needs: one step, and one undo puts it back', () => {
    const m = modelOf(testDeck(order.map((id) => ({ id, layout: 'blank', elements: [] }))));
    expect(m.moveSlides(['c'], nudgeTarget(order, ['c'], -1)!)).toBe(true);
    expect(m.order()).toEqual(['a', 'c', 'b', 'd', 'e']);
    m.undo();
    expect(m.order()).toEqual(order);
    expect(m.moveSlides(['b', 'c'], nudgeTarget(order, ['b', 'c'], 1)!)).toBe(true);
    expect(m.order()).toEqual(['a', 'd', 'b', 'c', 'e']);
    m.undo();
    expect(m.canUndo()).toBe(false);
  });
});

describe('a drop through the model', () => {
  it('is one move step whatever was dragged, and one undo takes it back', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const m = modelOf(testDeck(order.map((id) => ({ id, layout: 'blank', elements: [] }))));
    const rects = grid(7, 3);
    // Drag the first two, with the pointer past the end of the second row.
    const drop = dropAt(rects, 500, 110);
    expect(drop.index).toBe(6);
    expect(m.moveSlides(['a', 'b'], drop.index)).toBe(true);
    expect(m.order()).toEqual(['c', 'd', 'e', 'f', 'a', 'b', 'g']);
    expect(m.undo()).toBe(true);
    expect(m.order()).toEqual(order);
    expect(m.canUndo()).toBe(false);
  });

  it('is nothing at all when the slides are dropped where they were', () => {
    const m = modelOf(testDeck(['a', 'b', 'c'].map((id) => ({ id, layout: 'blank', elements: [] }))));
    expect(m.moveSlides(['b'], 1)).toBe(false);
    expect(m.moveSlides(['b'], 2)).toBe(false);
    expect(m.canUndo()).toBe(false);
  });
});
