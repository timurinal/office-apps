import { describe, expect, it } from 'vitest';
import { draggedSize, fillTarget, lineRange, MIN_LINE, moveTarget, nearestGap, outside } from './gestures';
import type { Rect } from './types';

const src: Rect = { r1: 3, r2: 4, c1: 2, c2: 3 };

describe('dragging the fill handle', () => {
  it('stays the source while the pointer is inside it', () => {
    expect(fillTarget(src, { row: 4, col: 3 }, { x: 0, y: 0 })).toEqual(src);
  });

  it('grows down, up, right and left, to the cell under the pointer', () => {
    expect(fillTarget(src, { row: 9, col: 3 }, { x: 0, y: 120 })).toEqual({ ...src, r2: 9 });
    expect(fillTarget(src, { row: 0, col: 2 }, { x: 0, y: -50 })).toEqual({ ...src, r1: 0 });
    expect(fillTarget(src, { row: 3, col: 8 }, { x: 200, y: 0 })).toEqual({ ...src, c2: 8 });
    expect(fillTarget(src, { row: 3, col: 0 }, { x: -90, y: 0 })).toEqual({ ...src, c1: 0 });
  });

  it('picks the direction the pointer is furthest outside, in pixels', () => {
    // 60px down and 40px right: down.
    expect(fillTarget(src, { row: 6, col: 5 }, { x: 40, y: 60 })).toEqual({ ...src, r2: 6 });
    // 20px down and 130px right: right.
    expect(fillTarget(src, { row: 5, col: 6 }, { x: 130, y: 20 })).toEqual({ ...src, c2: 6 });
  });

  it('always contains the source', () => {
    for (const out of [{ x: 10, y: 0 }, { x: 0, y: -5 }, { x: -30, y: 29 }]) {
      const t = fillTarget(src, { row: 5, col: 5 }, out);
      expect(t.r1).toBeLessThanOrEqual(src.r1);
      expect(t.r2).toBeGreaterThanOrEqual(src.r2);
      expect(t.c1).toBeLessThanOrEqual(src.c1);
      expect(t.c2).toBeGreaterThanOrEqual(src.c2);
    }
  });

  it('measures how far outside an interval a position is', () => {
    expect(outside(5, 10, 20)).toBe(-5);
    expect(outside(15, 10, 20)).toBe(0);
    expect(outside(27, 10, 20)).toBe(7);
  });
});

describe('resizing a header', () => {
  it('turns pixels moved into a size at 100%, whatever the zoom', () => {
    expect(draggedSize(100, 40, 1)).toBe(140);
    expect(draggedSize(200, 40, 2)).toBe(120);
    expect(draggedSize(130, -20, 1.25)).toBe(88);
  });

  it('never goes below the minimum', () => {
    expect(draggedSize(100, -500, 1)).toBe(MIN_LINE);
  });

  it('applies to the selected run when the edge is of a line inside a whole-line selection', () => {
    const cols: Rect = { r1: 0, r2: 99, c1: 2, c2: 5 };
    expect(lineRange('col', 3, cols, 100, 26)).toEqual({ from: 2, to: 5 });
    expect(lineRange('col', 7, cols, 100, 26)).toEqual({ from: 7, to: 7 });
    const rows: Rect = { r1: 4, r2: 9, c1: 0, c2: 25 };
    expect(lineRange('row', 9, rows, 100, 26)).toEqual({ from: 4, to: 9 });
  });

  it('is one line when the selection is not whole lines, or is a single line', () => {
    expect(lineRange('col', 3, { r1: 0, r2: 10, c1: 2, c2: 5 }, 100, 26)).toEqual({ from: 3, to: 3 });
    expect(lineRange('col', 3, { r1: 0, r2: 99, c1: 3, c2: 3 }, 100, 26)).toEqual({ from: 3, to: 3 });
  });
});

describe('moving whole lines', () => {
  it('is the index of the first moved line once it has moved', () => {
    // Rows 3 and 4 dropped before row 8 end up at 6 and 7.
    expect(moveTarget(3, 2, 8)).toBe(6);
    // Dropped at the top.
    expect(moveTarget(3, 2, 0)).toBe(0);
    // Dropped at the very end of 10 rows.
    expect(moveTarget(3, 2, 10)).toBe(8);
  });

  it('is nothing for a drop onto or beside itself', () => {
    expect(moveTarget(3, 2, 3)).toBeNull();
    expect(moveTarget(3, 2, 4)).toBeNull();
    expect(moveTarget(3, 2, 5)).toBeNull();
    expect(moveTarget(3, 2, 2)).toBe(2);
    expect(moveTarget(3, 2, 6)).toBe(4);
  });

  it('picks the near gap in the first half of a line and the far one in the second', () => {
    expect(nearestGap(7, 4, 26)).toBe(7);
    expect(nearestGap(7, 14, 26)).toBe(8);
  });
});
