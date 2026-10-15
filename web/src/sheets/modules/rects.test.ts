import { describe, expect, it } from 'vitest';
import { cellCount, currentRegion, overlaps, subtract, subtractAll, within } from './rects';

const R = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });

describe('subtracting a block', () => {
  it('leaves the block alone when they do not meet', () => {
    expect(subtract(R(0, 0, 2, 2), R(5, 5, 6, 6))).toEqual([R(0, 0, 2, 2)]);
  });

  it('leaves nothing when the cut covers it', () => {
    expect(subtract(R(1, 1, 2, 2), R(0, 0, 5, 5))).toEqual([]);
  });

  it('leaves four blocks around a hole, and every cell exactly once', () => {
    const a = R(0, 0, 9, 9);
    const cut = R(3, 3, 5, 5);
    const parts = subtract(a, cut);
    expect(parts).toHaveLength(4);
    expect(parts.reduce((n, p) => n + cellCount(p), 0)).toBe(100 - 9);
    for (let i = 0; i < parts.length; i++) {
      expect(overlaps(parts[i]!, cut)).toBe(false);
      expect(within(parts[i]!, a)).toBe(true);
      for (let j = i + 1; j < parts.length; j++) expect(overlaps(parts[i]!, parts[j]!)).toBe(false);
    }
  });

  it('cuts a column from a block to the left and right of it', () => {
    expect(subtractAll([R(0, 0, 4, 4)], R(0, 2, 4, 2))).toEqual(expect.arrayContaining([R(0, 0, 4, 1), R(0, 3, 4, 4)]));
  });
});

describe('the current region', () => {
  const grid = ['..........', '.XXX......', '.XXX..X...', '.X.X......', '..........'];
  const filled = (r: number, c: number) => grid[r]?.[c] === 'X';

  it('grows to the nearest empty row and column on every side', () => {
    expect(currentRegion({ row: 1, col: 2 }, 5, 10, filled)).toEqual(R(1, 1, 3, 3));
  });

  it('is the cell itself where nothing is next to it', () => {
    expect(currentRegion({ row: 2, col: 6 }, 5, 10, filled)).toEqual(R(2, 6, 2, 6));
  });

  it('joins a cell that touches only at a corner', () => {
    const diag = (r: number, c: number) => (r === 0 && c === 0) || (r === 1 && c === 1);
    expect(currentRegion({ row: 0, col: 0 }, 3, 3, diag)).toEqual(R(0, 0, 1, 1));
  });

  it('takes a long column without rescanning it for every row', () => {
    const rows = 1_000_000;
    let reads = 0;
    const tall = (r: number, c: number) => {
      reads++;
      return r < 500_000 && c < 3;
    };
    expect(currentRegion({ row: 10, col: 1 }, rows, 8, tall)).toEqual(R(0, 0, 499_999, 2));
    // A few reads for each row and column, not one for every row at every step.
    expect(reads).toBeLessThan(6_000_000);
  });
});
